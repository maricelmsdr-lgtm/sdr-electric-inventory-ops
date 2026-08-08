import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getValidAccessToken,
  fetchJobs,
  fetchJobMaterialsForJobs,
  fetchCompanies,
} from "@/lib/servicem8";

// Retrying through a rate limit can take a while.
export const maxDuration = 60;

const JOB_BATCH_SIZE = 10;
const SYNC_WINDOW_DAYS = 14;

/*
|--------------------------------------------------------------------------
| NON-INVENTORY SERVICE / LABOR DETECTION
|--------------------------------------------------------------------------
|
| ServiceM8 calls many things "materials", but not every line is an
| inventory part.
|
| These MUST NEVER:
|   - match against parts
|   - deduct inventory
|   - create unmatched/Needs Review records
|
| Examples:
|   Technician Labour
|   Technician Labor
|   Labour Technician Travis + Apprentice Justin 2026-08-06
|   Technician Labour After Hours (2Hr minimum)
|   Labour Technician and Apprentice
|   SERVICE CALL FEE / TRUCK CHARGE
|   SERVICE RATE
|   TRUCK CHARGE
|   SERVICE CALL FEE
|   After-installation callback...
|--------------------------------------------------------------------------
*/

function isNonInventoryCharge(name) {
  const value = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ");

  if (!value) return false;

  if (/\blabou?r\b/i.test(value)) {
    return true;
  }

  if (/\bhours?\b/i.test(value)) {
    return true;
  }

  if (/\b(?:\d+(?:\.\d+)?\s*)?hrs?\b/i.test(value)) {
    return true;
  }

  if (/\bafter\s+hours?\b/i.test(value)) {
    return true;
  }

  if (
    /\btechnician\b.*\b(?:apprentice|hours?|hrs?|hr)\b/i.test(
      value
    )
  ) {
    return true;
  }

  if (
    /\bapprentice\b.*\b(?:technician|hours?|hrs?|hr)\b/i.test(
      value
    )
  ) {
    return true;
  }

  if (/\bservice\s+call\s+fee\b/i.test(value)) {
    return true;
  }

  if (/\bservice\s+fee\b/i.test(value)) {
    return true;
  }

  if (/\bservice\s+rate\b/i.test(value)) {
    return true;
  }

  if (/\bservice\s+charge\b/i.test(value)) {
    return true;
  }

  if (/\btruck\s+charge\b/i.test(value)) {
    return true;
  }

  if (
    /\bcall\s*-?\s*out\s+(?:fee|charge|rate)\b/i.test(
      value
    )
  ) {
    return true;
  }

  if (
    /\btravel\s+(?:fee|charge)\b/i.test(value)
  ) {
    return true;
  }

  if (
    /\b(?:after[- ]installation|post[- ]installation)\b.*\bcallback\b/i.test(
      value
    )
  ) {
    return true;
  }

  if (
    /\bwarranty\b/i.test(value) &&
    /\b(?:service|callback|labor|labour|charge|fee)\b/i.test(
      value
    )
  ) {
    return true;
  }

  return false;
}

/*
|--------------------------------------------------------------------------
| POST
|--------------------------------------------------------------------------
*/

export async function POST(request) {
  const t0 = Date.now();

  const elapsed = () =>
    `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  const body = await request
    .json()
    .catch(() => ({}));

  const requestedOrgId = body?.org_id;

  if (!requestedOrgId) {
    return NextResponse.json(
      {
        error: "Missing org_id.",
      },
      { status: 400 }
    );
  }

  let admin;

  try {
    admin = supabaseAdmin();
  } catch {
    return NextResponse.json(
      {
        error:
          "Server isn't configured yet (missing Supabase service key).",
      },
      { status: 500 }
    );
  }

  const orgId = requestedOrgId;

  const {
    data: orgCheck,
    error: orgCheckError,
  } = await admin
    .from("parts")
    .select("org_id")
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle();

  if (orgCheckError) {
    return NextResponse.json(
      {
        error: `Could not verify organization: ${orgCheckError.message}`,
      },
      { status: 500 }
    );
  }

  if (!orgCheck?.org_id) {
    return NextResponse.json(
      {
        error:
          "The supplied organization does not have any inventory parts.",
      },
      { status: 400 }
    );
  }

  const {
    data: integration,
    error: integrationError,
  } = await admin
    .from("integrations")
    .select("id, connected")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .single();

  if (integrationError) {
    return NextResponse.json(
      {
        error: `Could not load ServiceM8 integration: ${integrationError.message}`,
      },
      { status: 500 }
    );
  }

  if (!integration?.connected) {
    return NextResponse.json(
      {
        error: "ServiceM8 isn't connected.",
      },
      { status: 400 }
    );
  }

  let sm8Token;

  try {
    sm8Token = await getValidAccessToken(
      admin,
      integration.id
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e?.message ||
          "Unable to obtain ServiceM8 access token.",
      },
      { status: 400 }
    );
  }

  const {
    data: mainLoc,
    error: mainLocError,
  } = await admin
    .from("locations")
    .select("id")
    .eq("org_id", orgId)
    .eq("code", "MAIN")
    .single();

  if (mainLocError) {
    return NextResponse.json(
      {
        error: `Could not load Main Warehouse: ${mainLocError.message}`,
      },
      { status: 500 }
    );
  }

  if (!mainLoc?.id) {
    return NextResponse.json(
      {
        error:
          "No Main Warehouse location found for this org — set one up before syncing.",
      },
      { status: 400 }
    );
  }

  const cutoff = new Date();

  cutoff.setDate(
    cutoff.getDate() - SYNC_WINDOW_DAYS
  );

  const cutoffStr = cutoff
    .toISOString()
    .slice(0, 10);

  let sm8Jobs;
  let sm8Companies;

  try {
    [sm8Jobs, sm8Companies] =
      await Promise.all([
        fetchJobs(sm8Token, cutoffStr),
        fetchCompanies(sm8Token),
      ]);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e?.message ||
          "Unable to fetch ServiceM8 jobs.",
      },
      { status: 502 }
    );
  }

  console.log(
    `[sm8 sync] fetched ${
      sm8Jobs?.length ?? 0
    } jobs, ${
      sm8Companies?.length ?? 0
    } companies — ${elapsed()}`
  );

  const companyName = {};

  for (const company of sm8Companies || []) {
    if (company?.uuid) {
      companyName[company.uuid] =
        company.name || "";
    }
  }

  const relevantJobs = (
    sm8Jobs || []
  ).filter((job) => {
    if (
      !job?.uuid ||
      !job?.status ||
      job.status === "Quote" ||
      job.status === "Cancelled"
    ) {
      return false;
    }

    const jobNo = String(
      job.generated_job_id || ""
    )
      .trim()
      .toUpperCase();

    const client = String(
      companyName[job.company_uuid] || ""
    )
      .trim()
      .toLowerCase();

    if (
      jobNo === "SAMPLE" ||
      client.includes("help guide")
    ) {
      return false;
    }

    return true;
  });

  /*
  |--------------------------------------------------------------------------
  | DEBUG — is job 15158 even in this window?
  |--------------------------------------------------------------------------
  | Logged once per run, cheap, tells us immediately whether the 14-day
  | SYNC_WINDOW_DAYS is excluding it before we even get to batching.
  |--------------------------------------------------------------------------
  */
  const debugTargetJob = (sm8Jobs || []).find(
    (j) => String(j.generated_job_id || "").trim() === "15158"
  );
  console.log(
    debugTargetJob
      ? `[DEBUG bundle] job #15158 found in sm8Jobs (uuid ${debugTargetJob.uuid}, status ${debugTargetJob.status}, date ${debugTargetJob.date})`
      : `[DEBUG bundle] job #15158 NOT found in sm8Jobs at all — check SYNC_WINDOW_DAYS (${SYNC_WINDOW_DAYS} days) or that it's the right org.`
  );

  relevantJobs.sort((a, b) =>
    String(a.uuid).localeCompare(
      String(b.uuid)
    )
  );

  console.log(
    `[sm8 sync] ${relevantJobs.length} relevant jobs after filtering — ${elapsed()}`
  );

  const {
    data: existingJobs,
    error: existingJobsError,
  } = await admin
    .from("jobs")
    .select(
      "id, servicem8_job_uuid"
    )
    .eq("org_id", orgId)
    .not(
      "servicem8_job_uuid",
      "is",
      null
    );

  if (existingJobsError) {
    return NextResponse.json(
      {
        error: `Could not load existing jobs: ${existingJobsError.message}`,
      },
      { status: 500 }
    );
  }

  const jobIdByUuid =
    Object.fromEntries(
      (existingJobs || []).map((job) => [
        job.servicem8_job_uuid,
        job.id,
      ])
    );

  const preExistingUuids =
    new Set(
      Object.keys(jobIdByUuid)
    );

  let jobsCreated = 0;
  let jobsUpdated = 0;

  if (relevantJobs.length > 0) {
    const jobRows =
      relevantJobs.map((job) => ({
        org_id: orgId,

        job_no:
          job.generated_job_id ||
          job.uuid,

        client:
          companyName[
            job.company_uuid
          ] ||
          "Unknown client",

        address:
          job.job_address ||
          null,

        job_date:
          (job.date || "").slice(0, 10) ||
          new Date()
            .toISOString()
            .slice(0, 10),

        location_id:
          mainLoc.id,

        servicem8_job_uuid:
          job.uuid,
      }));

    const {
      data: upserted,
      error: upsertErr,
    } = await admin.rpc(
      "upsert_synced_jobs",
      {
        p_jobs: jobRows,
      }
    );

    if (upsertErr) {
      return NextResponse.json(
        {
          error:
            `Job upsert failed: ${upsertErr.message}`,
        },
        { status: 500 }
      );
    }

    for (const row of upserted || []) {
      jobIdByUuid[
        row.servicem8_job_uuid
      ] = row.id;

      if (
        preExistingUuids.has(
          row.servicem8_job_uuid
        )
      ) {
        jobsUpdated++;
      } else {
        jobsCreated++;
      }
    }
  }

  console.log(
    `[sm8 sync] upserted ${
      relevantJobs.length
    } jobs (${jobsCreated} new, ${jobsUpdated} updated) — ${elapsed()}`
  );

  const allJobUuids =
    relevantJobs
      .map((job) => job.uuid)
      .filter(Boolean);

  const {
    data: syncState,
    error: syncStateErr,
  } = await admin
    .from("servicem8_sync_state")
    .select(
      "org_id, job_uuids, next_index, sync_started_at, updated_at"
    )
    .eq("org_id", orgId)
    .maybeSingle();

  if (syncStateErr) {
    return NextResponse.json(
      {
        error:
          `Could not load ServiceM8 sync checkpoint: ${syncStateErr.message}`,
      },
      { status: 500 }
    );
  }

  const savedJobUuids =
    Array.isArray(
      syncState?.job_uuids
    )
      ? syncState.job_uuids
      : [];

  const sameJobSet =
    savedJobUuids.length ===
      allJobUuids.length &&
    savedJobUuids.every(
      (uuid, index) =>
        uuid ===
        allJobUuids[index]
    );

  let nextIndex = 0;

  if (
    syncState &&
    sameJobSet &&
    Number(
      syncState.next_index || 0
    ) < allJobUuids.length
  ) {
    nextIndex = Math.max(
      0,
      Number(
        syncState.next_index || 0
      )
    );
  }

  if (
    allJobUuids.length === 0
  ) {
    await admin
      .from("servicem8_sync_state")
      .upsert({
        org_id: orgId,
        job_uuids: [],
        next_index: 0,
        sync_started_at:
          new Date().toISOString(),
        updated_at:
          new Date().toISOString(),
      });

    await admin
      .from("integrations")
      .update({
        last_synced_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        integration.id
      );

    return NextResponse.json({
      ok: true,
      syncComplete: true,

      jobsCreated,
      jobsUpdated,

      materialsDeducted: 0,
      materialsFlagged: 0,

      totalJobs: 0,

      message:
        "No relevant ServiceM8 jobs found in the sync window.",

      diagnostics: {
        elapsed: elapsed(),
      },
    });
  }

  if (
    !syncState ||
    !sameJobSet
  ) {
    nextIndex = 0;

    const {
      error: checkpointErr,
    } = await admin
      .from("servicem8_sync_state")
      .upsert({
        org_id: orgId,

        job_uuids:
          allJobUuids,

        next_index: 0,

        sync_started_at:
          new Date().toISOString(),

        updated_at:
          new Date().toISOString(),
      });

    if (checkpointErr) {
      return NextResponse.json(
        {
          error:
            `Could not initialize ServiceM8 sync checkpoint: ${checkpointErr.message}`,
        },
        { status: 500 }
      );
    }

    console.log(
      `[sm8 sync] initialized new checkpoint with ${allJobUuids.length} jobs`
    );
  }

  const batchStart =
    nextIndex;

  const batchJobUuids =
    allJobUuids.slice(
      batchStart,
      batchStart +
        JOB_BATCH_SIZE
    );

  const batchEnd =
    batchStart +
    batchJobUuids.length;

  console.log(
    `[sm8 sync] processing jobs ${
      batchStart + 1
    }-${batchEnd} of ${
      allJobUuids.length
    } — ${elapsed()}`
  );

  /*
  |--------------------------------------------------------------------------
  | DEBUG — is job 15158 in THIS batch?
  |--------------------------------------------------------------------------
  */
  if (debugTargetJob && batchJobUuids.includes(debugTargetJob.uuid)) {
    console.log(`[DEBUG bundle] job #15158 IS in this batch — its materials will be in the fetch below.`);
  } else if (debugTargetJob) {
    console.log(`[DEBUG bundle] job #15158 exists but is NOT in this batch (jobs ${batchStart + 1}-${batchEnd}). Keep clicking Sync to advance the checkpoint until it's included.`);
  }

  let sm8Materials = [];

  try {
    sm8Materials =
      await fetchJobMaterialsForJobs(
        sm8Token,
        batchJobUuids
      );
  } catch (e) {
    console.error(
      `[sm8 sync] material fetch failed for jobs ${
        batchStart + 1
      }-${batchEnd}:`,
      e
    );

    return NextResponse.json(
      {
        error:
          e?.message ||
          "Unable to fetch ServiceM8 job materials.",

        syncComplete: false,
        retryable: true,

        checkpoint: {
          nextIndex:
            batchStart,

          totalJobs:
            allJobUuids.length,

          jobsAttempted:
            batchJobUuids.length,
        },

        message:
          "Material sync stopped at the current checkpoint. The next Sync will retry this batch.",
      },
      { status: 502 }
    );
  }

  console.log(
    `[sm8 sync] fetched ${
      sm8Materials.length
    } material lines across ${
      batchJobUuids.length
    } jobs — ${elapsed()}`
  );

  /*
  |--------------------------------------------------------------------------
  | DEBUG — bundle detection (general, across whatever batch just ran)
  |--------------------------------------------------------------------------
  | Finds any line that is either:
  |   (a) a bundle CHILD — has a non-empty job_material_bundle_uuid, or
  |   (b) a bundle HEADER — its own uuid is referenced by another line's
  |       job_material_bundle_uuid
  | Logs the full raw JSON for any such lines found, plus job 15158's
  | lines specifically if that job landed in this batch.
  |--------------------------------------------------------------------------
  */
  const headerUuidsReferenced = new Set(
    sm8Materials
      .map((m) => m.job_material_bundle_uuid)
      .filter((v) => v && v !== "")
  );
  const bundleRelatedLines = sm8Materials.filter(
    (m) =>
      (m.job_material_bundle_uuid && m.job_material_bundle_uuid !== "") ||
      headerUuidsReferenced.has(m.uuid)
  );
  if (bundleRelatedLines.length > 0) {
    console.log(
      `[DEBUG bundle] found ${bundleRelatedLines.length} bundle-related line(s) in this batch:`
    );
    console.log(JSON.stringify(bundleRelatedLines, null, 2));
  } else {
    console.log(`[DEBUG bundle] no bundle-related lines (job_material_bundle_uuid) found in this batch's ${sm8Materials.length} material line(s).`);
  }
  if (debugTargetJob) {
    const job15158Lines = sm8Materials.filter((m) => m.job_uuid === debugTargetJob.uuid);
    if (job15158Lines.length > 0) {
      console.log(`[DEBUG bundle] job #15158 raw material lines (${job15158Lines.length}):`);
      console.log(JSON.stringify(job15158Lines, null, 2));
    }
  }

  const {
    data: parts,
    error: partsError,
  } = await admin
    .from("parts")
    .select(
      "id, sku, part_no, unit_cost"
    )
    .eq("org_id", orgId);

  if (partsError) {
    return NextResponse.json(
      {
        error:
          `Could not load inventory parts: ${partsError.message}`,
      },
      { status: 500 }
    );
  }

  const partByKey = {};

  for (const part of parts || []) {
    if (part.sku) {
      partByKey[
        String(part.sku)
          .trim()
          .toLowerCase()
      ] = part;
    }

    if (part.part_no) {
      partByKey[
        String(part.part_no)
          .trim()
          .toLowerCase()
      ] = part;
    }
  }

  const {
    data: alreadySyncedLines,
    error: alreadySyncedError,
  } = await admin
    .from("job_line_items")
    .select(
      "servicem8_material_uuid"
    )
    .not(
      "servicem8_material_uuid",
      "is",
      null
    );

  if (alreadySyncedError) {
    return NextResponse.json(
      {
        error:
          `Could not load processed materials: ${alreadySyncedError.message}`,
      },
      { status: 500 }
    );
  }

  const syncedUuids =
    new Set(
      (alreadySyncedLines || [])
        .map(
          (line) =>
            line.servicem8_material_uuid
        )
        .filter(Boolean)
    );

  const {
    data: alreadyFlagged,
    error: alreadyFlaggedError,
  } = await admin
    .from("unmatched_materials")
    .select(
      "servicem8_material_uuid"
    );

  if (alreadyFlaggedError) {
    return NextResponse.json(
      {
        error:
          `Could not load unmatched materials: ${alreadyFlaggedError.message}`,
      },
      { status: 500 }
    );
  }

  const flaggedUuids =
    new Set(
      (alreadyFlagged || [])
        .map(
          (row) =>
            row.servicem8_material_uuid
        )
        .filter(Boolean)
    );

  let materialsDeducted = 0;
  let materialsFlagged = 0;

  let materialsSkippedNoJob = 0;
  let materialsSkippedNoQty = 0;
  let materialsSkippedNonInventory = 0;

  const totalMaterialsSeen =
    sm8Materials.length;

  const nonInventoryItems =
    sm8Materials.filter((material) =>
      isNonInventoryCharge(
        material?.name
      )
    );

  for (
    const item of nonInventoryItems
  ) {
    materialsSkippedNonInventory++;

    console.log(
      `[sm8 sync] NON-INVENTORY — skipped completely: ${
        item?.name || "(unnamed)"
      }`
    );
  }

  const candidateMaterials =
    sm8Materials.filter(
      (material) => {
        if (!material?.uuid) {
          return false;
        }

        if (
          isNonInventoryCharge(
            material.name
          )
        ) {
          return false;
        }

        if (
          syncedUuids.has(
            material.uuid
          )
        ) {
          return false;
        }

        if (
          flaggedUuids.has(
            material.uuid
          )
        ) {
          return false;
        }

        return true;
      }
    );

  const materialPayload = [];

  for (
    const material of candidateMaterials
  ) {
    const jobId =
      jobIdByUuid[
        material.job_uuid
      ];

    if (!jobId) {
      materialsSkippedNoJob++;
      continue;
    }

    const qty = Number(
      material.quantity ??
        material.qty ??
        0
    );

    if (!qty) {
      materialsSkippedNoQty++;
      continue;
    }

    const key = String(
      material.name || ""
    )
      .trim()
      .toLowerCase();

    const match =
      partByKey[key] || null;

    materialPayload.push({
      job_id: jobId,

      part_id: match
        ? match.id
        : null,

      servicem8_material_uuid:
        material.uuid,

      raw_name:
        material.name ||
        "(unnamed)",

      qty,

      unit_cost:
        Number(material.cost) ||
        (match
          ? Number(
              match.unit_cost
            )
          : 0) ||
        0,

      sale_cost:
        Number(material.price) ||
        0,
    });
  }

  if (
    materialPayload.length > 0
  ) {
    const {
      data: result,
      error: processErr,
    } = await admin
      .rpc(
        "process_synced_materials",
        {
          p_org_id: orgId,

          p_location_id:
            mainLoc.id,

          p_materials:
            materialPayload,
        }
      )
      .single();

    if (processErr) {
      console.error(
        `[sm8 sync] material processing failed for jobs ${
          batchStart + 1
        }-${batchEnd}:`,
        processErr
      );

      return NextResponse.json(
        {
          error:
            `Material processing failed: ${processErr.message}`,

          syncComplete: false,

          retryable: true,

          checkpoint: {
            nextIndex:
              batchStart,

            totalJobs:
              allJobUuids.length,

            jobsAttempted:
              batchJobUuids.length,
          },

          message:
            "The checkpoint was not advanced because material processing failed.",
        },
        { status: 500 }
      );
    }

    materialsDeducted =
      Number(
        result?.deducted_count ||
          0
      );

    materialsFlagged =
      Number(
        result?.flagged_count ||
          0
      );
  }

  console.log(
    `[sm8 sync] processed ${
      materialPayload.length
    } inventory material lines — ${
      materialsDeducted
    } deducted, ${
      materialsFlagged
    } flagged, ${
      materialsSkippedNonInventory
    } service/labor lines skipped — ${elapsed()}`
  );

  const syncComplete =
    batchEnd >=
    allJobUuids.length;

  const newNextIndex =
    syncComplete
      ? allJobUuids.length
      : batchEnd;

  const {
    error:
      checkpointUpdateErr,
  } = await admin
    .from(
      "servicem8_sync_state"
    )
    .upsert({
      org_id: orgId,

      job_uuids:
        allJobUuids,

      next_index:
        newNextIndex,

      sync_started_at:
        syncState?.sync_started_at ||
        new Date().toISOString(),

      updated_at:
        new Date().toISOString(),
    });

  if (checkpointUpdateErr) {
    console.error(
      `[sm8 sync] WARNING: checkpoint update failed:`,
      checkpointUpdateErr
    );

    return NextResponse.json(
      {
        ok: true,

        syncComplete: false,

        warning:
          "Materials were processed, but the sync checkpoint could not be saved. Existing material UUID protection will prevent duplicate processing.",

        jobsCreated,
        jobsUpdated,

        materialsDeducted,
        materialsFlagged,

        checkpoint: {
          nextIndex:
            batchStart,

          totalJobs:
            allJobUuids.length,

          jobsProcessedThisRun:
            batchJobUuids.length,
        },
      },
      { status: 200 }
    );
  }

  await admin
    .from("integrations")
    .update({
      last_synced_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      integration.id
    );

  await admin
    .from("activity_log")
    .insert({
      org_id: orgId,

      message: syncComplete
        ? `Completed ServiceM8 material sync: ${jobsCreated} new job(s), ${jobsUpdated} updated, ${materialsDeducted} physical material(s) deducted, ${materialsFlagged} physical material(s) flagged for review, ${materialsSkippedNonInventory} labor/service charge(s) excluded from inventory.`
        : `ServiceM8 sync progress: processed jobs ${batchStart + 1}-${batchEnd} of ${allJobUuids.length}; ${materialsDeducted} physical material(s) deducted, ${materialsFlagged} physical material(s) flagged for review, ${materialsSkippedNonInventory} labor/service charge(s) excluded from inventory.`,
    });

  return NextResponse.json({
    ok: true,

    syncComplete,

    jobsCreated,
    jobsUpdated,

    materialsDeducted,
    materialsFlagged,

    checkpoint: {
      processedFrom:
        batchStart + 1,

      processedTo:
        batchEnd,

      nextIndex:
        newNextIndex,

      totalJobs:
        allJobUuids.length,

      remainingJobs:
        Math.max(
          0,
          allJobUuids.length -
            newNextIndex
        ),
    },

    message: syncComplete
      ? "ServiceM8 sync complete."
      : `Processed jobs ${batchStart + 1}-${batchEnd} of ${allJobUuids.length}. Click Sync again to continue.`,

    diagnostics: {
      totalMaterialsSeen,

      materialsSkippedNoJob,

      materialsSkippedNoQty,

      materialsSkippedNonInventory,

      candidateInventoryMaterials:
        materialPayload.length,

      batchSize:
        JOB_BATCH_SIZE,

      elapsed:
        elapsed(),

      sampleRawMaterials:
        sm8Materials.slice(
          0,
          3
        ),
    },
  });
}
