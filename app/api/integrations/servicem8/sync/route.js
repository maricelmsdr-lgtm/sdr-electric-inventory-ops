import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getValidAccessToken,
  fetchJobs,
  fetchJobMaterialsForJobs,
  fetchCompanies,
} from "@/lib/servicem8";

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------

export const maxDuration = 60;

const JOB_BATCH_SIZE = 10;
const SYNC_WINDOW_DAYS = 14;

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function isNonInventoryItem(name) {
  const value = String(name || "")
    .trim()
    .toLowerCase();

  if (!value) return false;

  const patterns = [
    // LABOUR / LABOR
    /\blabou?r\b/,

    // TECHNICIAN / APPRENTICE
    /\btechnician\b/,
    /\bapprentice\b/,

    // TIME / HOURS
    /\bhour\b/,
    /\bhours\b/,
    /\bhr\b/,
    /\bhrs\b/,

    // TRUCK CHARGES
    /\btruck\s+charge\b/,
    /\btruck\s+fee\b/,
    /\btruck\s+cost\b/,

    // SERVICE CALL
    /\bservice\s+call\s+fee\b/,
    /\bservice\s+call\s+charge\b/,
    /\bservice\s+call\b/,

    // CALL OUT
    /\bcall\s*out\s+fee\b/,
    /\bcall\s*out\s+charge\b/,
    /\bcall\s*out\b/,

    // SERVICE FEES
    /\bservice\s+fee\b/,
    /\bservice\s+charge\b/,

    // TRIP FEES
    /\btrip\s+fee\b/,
    /\btrip\s+charge\b/,

    // TRAVEL
    /\btravel\s+fee\b/,
    /\btravel\s+charge\b/,
  ];

  return patterns.some((pattern) =>
    pattern.test(value)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------
// POST
// ------------------------------------------------------------

export async function POST(request) {
  const t0 = Date.now();

  const elapsed = () =>
    `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  // ----------------------------------------------------------
  // READ REQUEST
  // ----------------------------------------------------------

  const body = await request
    .json()
    .catch(() => ({}));

  const access_token = body?.access_token;

  if (!access_token) {
    return NextResponse.json(
      {
        error: "Missing session.",
      },
      { status: 401 }
    );
  }

  // ----------------------------------------------------------
  // SUPABASE ADMIN
  // ----------------------------------------------------------

  let admin;

  try {
    admin = supabaseAdmin();
  } catch (e) {
    return NextResponse.json(
      {
        error:
          "Server isn't configured yet (missing Supabase service key).",
      },
      { status: 500 }
    );
  }

  // ----------------------------------------------------------
  // AUTHENTICATE USER
  // ----------------------------------------------------------

  const {
    data: userData,
    error: userErr,
  } = await admin.auth.getUser(access_token);

  if (userErr || !userData?.user) {
    return NextResponse.json(
      {
        error: "Invalid session.",
      },
      { status: 401 }
    );
  }

  const userId = userData.user.id;

  // ----------------------------------------------------------
  // GET PROFILE / ORG
  // ----------------------------------------------------------

  const {
    data: profile,
    error: profileErr,
  } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", userId)
    .single();

  if (profileErr || !profile?.org_id) {
    return NextResponse.json(
      {
        error: "No organization found.",
      },
      { status: 400 }
    );
  }

  const orgId = profile.org_id;

  // ----------------------------------------------------------
  // GET SERVICEM8 INTEGRATION
  // ----------------------------------------------------------

  const {
    data: integration,
    error: integrationErr,
  } = await admin
    .from("integrations")
    .select("id, connected")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .single();

  if (
    integrationErr ||
    !integration?.connected
  ) {
    return NextResponse.json(
      {
        error: "ServiceM8 isn't connected.",
      },
      { status: 400 }
    );
  }

  // ----------------------------------------------------------
  // ACCESS TOKEN
  // ----------------------------------------------------------

  let sm8Token;

  try {
    sm8Token = await getValidAccessToken(
      admin,
      integration.id
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: e.message,
      },
      { status: 400 }
    );
  }

  // ----------------------------------------------------------
  // MAIN WAREHOUSE
  // ----------------------------------------------------------

  const {
    data: mainLoc,
    error: locationErr,
  } = await admin
    .from("locations")
    .select("id")
    .eq("org_id", orgId)
    .eq("code", "MAIN")
    .single();

  if (locationErr || !mainLoc?.id) {
    return NextResponse.json(
      {
        error:
          "No Main Warehouse location found for this org — set one up before syncing.",
      },
      { status: 400 }
    );
  }

  // ----------------------------------------------------------
  // FETCH SERVICEM8 JOBS + COMPANIES
  // ----------------------------------------------------------

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
    console.error(
      "[sm8 sync] failed fetching jobs/companies:",
      e
    );

    return NextResponse.json(
      {
        error: e.message,
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

  // ----------------------------------------------------------
  // COMPANY LOOKUP
  // ----------------------------------------------------------

  const companyName = {};

  for (const company of sm8Companies || []) {
    if (company?.uuid) {
      companyName[company.uuid] =
        company.name || "Unknown client";
    }
  }

  // ----------------------------------------------------------
  // FILTER JOBS
  // ----------------------------------------------------------

  const relevantJobs = (sm8Jobs || []).filter(
    (job) => {
      if (!job?.uuid) return false;

      if (!job.status) return false;

      if (
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

      if (jobNo === "SAMPLE") {
        return false;
      }

      if (client.includes("help guide")) {
        return false;
      }

      return true;
    }
  );

  relevantJobs.sort((a, b) =>
    String(a.uuid).localeCompare(
      String(b.uuid)
    )
  );

  console.log(
    `[sm8 sync] ${
      relevantJobs.length
    } relevant jobs after filtering — ${elapsed()}`
  );

  // ----------------------------------------------------------
  // EXISTING JOBS
  // ----------------------------------------------------------

  const {
    data: existingJobs,
    error: existingJobsErr,
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

  if (existingJobsErr) {
    return NextResponse.json(
      {
        error:
          existingJobsErr.message,
      },
      { status: 500 }
    );
  }

  const jobIdByUuid = {};

  for (const job of existingJobs || []) {
    if (job.servicem8_job_uuid) {
      jobIdByUuid[
        job.servicem8_job_uuid
      ] = job.id;
    }
  }

  const preExistingUuids = new Set(
    Object.keys(jobIdByUuid)
  );

  // ----------------------------------------------------------
  // UPSERT JOBS
  // ----------------------------------------------------------

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
          job.job_address || null,

        job_date:
          String(job.date || "")
            .slice(0, 10) ||
          new Date()
            .toISOString()
            .slice(0, 10),

        location_id: mainLoc.id,

        servicem8_job_uuid:
          job.uuid,
      }));

    const {
      data: upsertedJobs,
      error: upsertErr,
    } = await admin.rpc(
      "upsert_synced_jobs",
      {
        p_jobs: jobRows,
      }
    );

    if (upsertErr) {
      console.error(
        "[sm8 sync] job upsert failed:",
        upsertErr
      );

      return NextResponse.json(
        {
          error:
            `Job upsert failed: ${upsertErr.message}`,
        },
        { status: 500 }
      );
    }

    for (const row of upsertedJobs || []) {
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
    `[sm8 sync] upserted ${relevantJobs.length} jobs (${jobsCreated} new, ${jobsUpdated} updated) — ${elapsed()}`
  );

  // ----------------------------------------------------------
  // JOB UUIDS
  // ----------------------------------------------------------

  const allJobUuids = relevantJobs
    .map((job) => job.uuid)
    .filter(Boolean);

  // ----------------------------------------------------------
  // CHECKPOINT
  // ----------------------------------------------------------

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
        uuid === allJobUuids[index]
    );

  let nextIndex = 0;

  if (
    syncState &&
    sameJobSet &&
    Number(syncState.next_index || 0) <
      allJobUuids.length
  ) {
    nextIndex = Math.max(
      0,
      Number(
        syncState.next_index || 0
      )
    );
  }

  // ----------------------------------------------------------
  // NO JOBS
  // ----------------------------------------------------------

  if (allJobUuids.length === 0) {
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
      .eq("id", integration.id);

    return NextResponse.json({
      ok: true,
      syncComplete: true,

      jobsCreated,
      jobsUpdated,

      materialsDeducted: 0,
      materialsFlagged: 0,

      materialsSkippedNonInventory: 0,

      totalJobs: 0,
      nextIndex: 0,

      message:
        "No relevant ServiceM8 jobs found in the sync window.",

      diagnostics: {
        elapsed: elapsed(),
      },
    });
  }

  // ----------------------------------------------------------
  // INITIALIZE / RESET CHECKPOINT
  // ----------------------------------------------------------

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
        job_uuids: allJobUuids,
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

  // ----------------------------------------------------------
  // CURRENT JOB BATCH
  // ----------------------------------------------------------

  const batchStart = nextIndex;

  const batchJobUuids =
    allJobUuids.slice(
      batchStart,
      batchStart + JOB_BATCH_SIZE
    );

  const batchEnd =
    batchStart +
    batchJobUuids.length;

  console.log(
    `[sm8 sync] processing jobs ${batchStart + 1}-${batchEnd} of ${allJobUuids.length} — ${elapsed()}`
  );

  // ----------------------------------------------------------
  // FETCH MATERIALS
  // ----------------------------------------------------------

  let sm8Materials = [];

  try {
    sm8Materials =
      await fetchJobMaterialsForJobs(
        sm8Token,
        batchJobUuids
      );
  } catch (e) {
    console.error(
      `[sm8 sync] material fetch failed for jobs ${batchStart + 1}-${batchEnd}:`,
      e
    );

    return NextResponse.json(
      {
        error: e.message,

        syncComplete: false,

        retryable: true,

        checkpoint: {
          nextIndex: batchStart,
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
    `[sm8 sync] fetched ${sm8Materials.length} material lines across ${batchJobUuids.length} jobs — ${elapsed()}`
  );

  // ----------------------------------------------------------
  // LOAD PARTS
  // ----------------------------------------------------------

  const {
    data: parts,
    error: partsErr,
  } = await admin
    .from("parts")
    .select(
      "id, sku, part_no, unit_cost"
    )
    .eq("org_id", orgId);

  if (partsErr) {
    return NextResponse.json(
      {
        error:
          `Could not load parts: ${partsErr.message}`,
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

  // ----------------------------------------------------------
  // EXISTING MATERIAL UUIDS
  // ----------------------------------------------------------

  const {
    data: alreadySyncedLines,
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

  const syncedUuids = new Set(
    (alreadySyncedLines || []).map(
      (line) =>
        line.servicem8_material_uuid
    )
  );

  // ----------------------------------------------------------
  // EXISTING FLAGGED UUIDS
  // ----------------------------------------------------------

  const {
    data: alreadyFlagged,
  } = await admin
    .from("unmatched_materials")
    .select(
      "servicem8_material_uuid"
    );

  const flaggedUuids = new Set(
    (alreadyFlagged || []).map(
      (item) =>
        item.servicem8_material_uuid
    )
  );

  // ----------------------------------------------------------
  // DEBUG / COUNTERS
  // ----------------------------------------------------------

  const totalMaterialsSeen =
    sm8Materials.length;

  let materialsSkippedNonInventory = 0;
  let materialsSkippedNoJob = 0;
  let materialsSkippedNoQty = 0;

  // ----------------------------------------------------------
  // IDENTIFY NON-INVENTORY ITEMS FIRST
  // ----------------------------------------------------------
  //
  // THIS IS THE IMPORTANT PART.
  //
  // We remove labor / technician / hours /
  // truck charges BEFORE inventory matching.
  //
  // Therefore these items:
  //
  // SERVICE CALL FEE / TRUCK CHARGE
  // Technician Labour After Hours (2Hr minimum)
  // LABOUR MITCHELL
  // Technician Labour
  // Labour Technician + Apprentice
  // TRUCK CHARGE
  //
  // NEVER reach the inventory matching system.
  // ----------------------------------------------------------

  for (const material of sm8Materials) {
    if (
      isNonInventoryItem(
        material?.name
      )
    ) {
      materialsSkippedNonInventory++;

      console.log(
        `[sm8 sync] NON-INVENTORY SKIPPED: "${material.name}"`
      );
    }
  }

  // ----------------------------------------------------------
  // CANDIDATE INVENTORY MATERIALS
  // ----------------------------------------------------------

  const candidateMaterials =
    sm8Materials.filter(
      (material) => {
        if (!material?.uuid) {
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

        // ----------------------------------------------------
        // CRITICAL:
        // LABOR / TECHNICIAN / HOURS / TRUCK /
        // SERVICE CALL CHARGES ARE NOT INVENTORY.
        // ----------------------------------------------------

        if (
          isNonInventoryItem(
            material.name
          )
        ) {
          return false;
        }

        return true;
      }
    );

  console.log(
    `[sm8 sync] ${candidateMaterials.length} inventory candidates remain after excluding ${materialsSkippedNonInventory} non-inventory charges`
  );

  // ----------------------------------------------------------
  // BUILD MATERIAL PAYLOAD
  // ----------------------------------------------------------

  const materialPayload = [];

  for (const material of candidateMaterials) {
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

    const materialName =
      String(
        material.name || ""
      ).trim();

    const key =
      materialName.toLowerCase();

    const matchingPart =
      partByKey[key];

    materialPayload.push({
      job_id: jobId,

      part_id:
        matchingPart?.id || null,

      servicem8_material_uuid:
        material.uuid,

      raw_name:
        materialName ||
        "(unnamed)",

      qty,

      unit_cost:
        Number(material.cost) ||
        Number(
          matchingPart?.unit_cost
        ) ||
        0,

      sale_cost:
        Number(material.price) || 0,
    });
  }

  // ----------------------------------------------------------
  // PROCESS INVENTORY MATERIALS
  // ----------------------------------------------------------

  let materialsDeducted = 0;
  let materialsFlagged = 0;

  if (
    materialPayload.length > 0
  ) {
    const {
      data: result,
      error: processErr,
    } = await admin.rpc(
      "process_synced_materials",
      {
        p_org_id: orgId,

        p_location_id:
          mainLoc.id,

        p_materials:
          materialPayload,
      }
    );

    if (processErr) {
      console.error(
        "[sm8 sync] material processing failed:",
        processErr
      );

      return NextResponse.json(
        {
          error:
            `Material processing failed: ${processErr.message}`,

          syncComplete: false,

          retryable: true,

          checkpoint: {
            nextIndex: batchStart,
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

    // --------------------------------------------------------
    // SUPPORT DIFFERENT RPC RETURN SHAPES
    // --------------------------------------------------------

    const rpcResult =
      Array.isArray(result)
        ? result[0]
        : result;

    materialsDeducted =
      Number(
        rpcResult?.deducted_count ??
          rpcResult?.materials_deducted ??
          0
      );

    materialsFlagged =
      Number(
        rpcResult?.flagged_count ??
          rpcResult?.materials_flagged ??
          0
      );
  }

  console.log(
    `[sm8 sync] processed ${materialPayload.length} inventory material lines — ${materialsDeducted} deducted, ${materialsFlagged} flagged, ${materialsSkippedNonInventory} non-inventory charges skipped — ${elapsed()}`
  );

  // ----------------------------------------------------------
  // CHECKPOINT ADVANCE
  // ----------------------------------------------------------

  const syncComplete =
    batchEnd >=
    allJobUuids.length;

  const newNextIndex =
    syncComplete
      ? allJobUuids.length
      : batchEnd;

  const {
    error: checkpointUpdateErr,
  } = await admin
    .from("servicem8_sync_state")
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
      "[sm8 sync] checkpoint update failed:",
      checkpointUpdateErr
    );

    return NextResponse.json(
      {
        ok: true,

        syncComplete: false,

        warning:
          "Materials were processed, but the sync checkpoint could not be saved.",

        jobsCreated,
        jobsUpdated,

        materialsDeducted,
        materialsFlagged,

        materialsSkippedNonInventory,

        checkpoint: {
          nextIndex: batchStart,
          totalJobs:
            allJobUuids.length,
          jobsProcessedThisRun:
            batchJobUuids.length,
        },
      },
      { status: 200 }
    );
  }

  // ----------------------------------------------------------
  // UPDATE LAST SYNC
  // ----------------------------------------------------------

  await admin
    .from("integrations")
    .update({
      last_synced_at:
        new Date().toISOString(),
    })
    .eq("id", integration.id);

  // ----------------------------------------------------------
  // ACTIVITY LOG
  // ----------------------------------------------------------

  try {
    await admin
      .from("activity_log")
      .insert({
        org_id: orgId,

        user_id: userId,

        message: syncComplete
          ? `Completed ServiceM8 material sync: ${jobsCreated} new job(s), ${jobsUpdated} updated, ${materialsDeducted} material(s) deducted, ${materialsFlagged} flagged for review, ${materialsSkippedNonInventory} non-inventory charge(s) skipped.`
          : `ServiceM8 sync progress: processed jobs ${batchStart + 1}-${batchEnd} of ${allJobUuids.length}; ${materialsDeducted} material(s) deducted, ${materialsFlagged} flagged for review, ${materialsSkippedNonInventory} non-inventory charge(s) skipped.`,
      });
  } catch (e) {
    console.warn(
      "[sm8 sync] activity log failed:",
      e
    );
  }

  // ----------------------------------------------------------
  // RESPONSE
  // ----------------------------------------------------------

  return NextResponse.json({
    ok: true,

    syncComplete,

    jobsCreated,
    jobsUpdated,

    materialsDeducted,
    materialsFlagged,

    // IMPORTANT:
    // This is the number of LABOR / TECHNICIAN /
    // HOURS / TRUCK / SERVICE CHARGES excluded.
    materialsSkippedNonInventory,

    checkpoint: {
      processedFrom:
        batchStart + 1,

      processedTo:
        batchEnd,

      nextIndex:
        newNextIndex,

      totalJobs:
        allJobUuids.length,

      remainingJobs: Math.max(
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

      inventoryCandidates:
        candidateMaterials.length,

      materialPayload:
        materialPayload.length,

      materialsSkippedNoJob,

      materialsSkippedNoQty,

      materialsSkippedNonInventory,

      batchSize:
        JOB_BATCH_SIZE,

      elapsed:
        elapsed(),
    },
  });
}