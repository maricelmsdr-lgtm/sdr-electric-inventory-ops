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

// ------------------------------------------------------------
// LABOR DETECTION
// ------------------------------------------------------------
//
// Labor is NOT inventory.
//
// Examples:
// - Technician Labour
// - Technician Labor
// - Technician Labour After Hours (2Hr minimum)
// - 2 HR
// - 2 HRS
// - 3 Hours
// - After Hours
//
// These items must never be sent to inventory deduction.
//

function isLaborItem(name) {
  const value = String(name || "").trim().toLowerCase();

  // labor / labour
  if (/\blabou?r\b/i.test(value)) {
    return true;
  }

  // hour / hours
  if (/\bhours?\b/i.test(value)) {
    return true;
  }

  // hr / hrs, including "2Hr", "2 Hrs", etc.
  if (/(?:^|[^a-z])(?:\d+\s*)?hrs?\b/i.test(value)) {
    return true;
  }

  return false;
}

export async function POST(request) {
  const t0 = Date.now();

  const elapsed = () =>
    `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  const { access_token } = await request
    .json()
    .catch(() => ({}));

  if (!access_token) {
    return NextResponse.json(
      { error: "Missing session." },
      { status: 401 }
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

  // ------------------------------------------------------------
  // AUTHENTICATE USER
  // ------------------------------------------------------------

  const { data: userData, error: userErr } =
    await admin.auth.getUser(access_token);

  if (userErr || !userData?.user) {
    return NextResponse.json(
      { error: "Invalid session." },
      { status: 401 }
    );
  }

  // ------------------------------------------------------------
  // GET ORGANIZATION
  // ------------------------------------------------------------

  const { data: profile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", userData.user.id)
    .single();

  if (!profile?.org_id) {
    return NextResponse.json(
      { error: "No organization found." },
      { status: 400 }
    );
  }

  const orgId = profile.org_id;

  // ------------------------------------------------------------
  // GET SERVICEM8 INTEGRATION
  // ------------------------------------------------------------

  const { data: integration } = await admin
    .from("integrations")
    .select("id, connected")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .single();

  if (!integration?.connected) {
    return NextResponse.json(
      { error: "ServiceM8 isn't connected." },
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
      { error: e.message },
      { status: 400 }
    );
  }

  // ------------------------------------------------------------
  // MAIN WAREHOUSE
  // ------------------------------------------------------------

  const { data: mainLoc } = await admin
    .from("locations")
    .select("id")
    .eq("org_id", orgId)
    .eq("code", "MAIN")
    .single();

  if (!mainLoc?.id) {
    return NextResponse.json(
      {
        error:
          "No Main Warehouse location found for this org — set one up before syncing.",
      },
      { status: 400 }
    );
  }

  // ------------------------------------------------------------
  // FETCH RECENT SERVICEM8 JOBS
  // ------------------------------------------------------------

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
    [sm8Jobs, sm8Companies] = await Promise.all([
      fetchJobs(sm8Token, cutoffStr),
      fetchCompanies(sm8Token),
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: e.message },
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

  // ------------------------------------------------------------
  // COMPANY LOOKUP
  // ------------------------------------------------------------

  const companyName = {};

  for (const c of sm8Companies || []) {
    companyName[c.uuid] = c.name;
  }

  // ------------------------------------------------------------
  // FILTER RELEVANT JOBS
  // ------------------------------------------------------------

  const relevantJobs = (sm8Jobs || []).filter((j) => {
    if (
      !j.uuid ||
      !j.status ||
      j.status === "Quote" ||
      j.status === "Cancelled"
    ) {
      return false;
    }

    const jobNo = (
      j.generated_job_id || ""
    )
      .trim()
      .toUpperCase();

    const client = (
      companyName[j.company_uuid] || ""
    )
      .trim()
      .toLowerCase();

    // Ignore ServiceM8's built-in sample job.
    if (
      jobNo === "SAMPLE" ||
      client.includes("help guide")
    ) {
      return false;
    }

    return true;
  });

  // Sort UUIDs so the checkpoint remains stable even if
  // ServiceM8 changes the order of returned jobs.
  relevantJobs.sort((a, b) =>
    String(a.uuid).localeCompare(
      String(b.uuid)
    )
  );

  console.log(
    `[sm8 sync] ${relevantJobs.length} relevant jobs after filtering — ${elapsed()}`
  );

  // ------------------------------------------------------------
  // LOAD EXISTING JOBS
  // ------------------------------------------------------------

  const { data: existingJobs } = await admin
    .from("jobs")
    .select("id, servicem8_job_uuid")
    .eq("org_id", orgId)
    .not("servicem8_job_uuid", "is", null);

  const jobIdByUuid = Object.fromEntries(
    (existingJobs || []).map((j) => [
      j.servicem8_job_uuid,
      j.id,
    ])
  );

  const preExistingUuids = new Set(
    Object.keys(jobIdByUuid)
  );

  // ------------------------------------------------------------
  // UPSERT JOBS
  // ------------------------------------------------------------

  let jobsCreated = 0;
  let jobsUpdated = 0;

  if (relevantJobs.length > 0) {
    const jobRows = relevantJobs.map((j) => ({
      org_id: orgId,
      job_no:
        j.generated_job_id || j.uuid,
      client:
        companyName[j.company_uuid] ||
        "Unknown client",
      address: j.job_address || null,
      job_date:
        (j.date || "").slice(0, 10) ||
        new Date()
          .toISOString()
          .slice(0, 10),
      location_id: mainLoc.id,
      servicem8_job_uuid: j.uuid,
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
          error: `Job upsert failed: ${upsertErr.message}`,
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
    `[sm8 sync] upserted ${relevantJobs.length} jobs (${jobsCreated} new, ${jobsUpdated} updated) — ${elapsed()}`
  );

  // ------------------------------------------------------------
  // CHECKPOINT
  // ------------------------------------------------------------

  const allJobUuids = relevantJobs
    .map((j) => j.uuid)
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
        error: `Could not load ServiceM8 sync checkpoint: ${syncStateErr.message}`,
      },
      { status: 500 }
    );
  }

  const savedJobUuids = Array.isArray(
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

  // If the previous sync is incomplete and the job set
  // hasn't changed, continue from the saved position.
  //
  // If the previous sync is complete, this click starts
  // a fresh pass. Duplicate protection below means already
  // processed material UUIDs will still be skipped.
  if (
    syncState &&
    sameJobSet &&
    Number(syncState.next_index || 0) <
      allJobUuids.length
  ) {
    nextIndex = Math.max(
      0,
      Number(syncState.next_index || 0)
    );
  }

  // If there are no jobs, clear/reset the checkpoint.
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
      totalJobs: 0,
      nextIndex: 0,
      message:
        "No relevant ServiceM8 jobs found in the sync window.",
      diagnostics: {
        elapsed: elapsed(),
      },
    });
  }

  // ------------------------------------------------------------
  // SAVE / UPDATE CHECKPOINT BEFORE MATERIAL FETCH
  // ------------------------------------------------------------

  if (!syncState || !sameJobSet) {
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
          error: `Could not initialize ServiceM8 sync checkpoint: ${checkpointErr.message}`,
        },
        { status: 500 }
      );
    }

    console.log(
      `[sm8 sync] initialized new checkpoint with ${allJobUuids.length} jobs`
    );
  }

  // ------------------------------------------------------------
  // DETERMINE THIS BATCH
  // ------------------------------------------------------------

  const batchStart = nextIndex;

  const batchJobUuids = allJobUuids.slice(
    batchStart,
    batchStart + JOB_BATCH_SIZE
  );

  const batchEnd =
    batchStart + batchJobUuids.length;

  console.log(
    `[sm8 sync] processing jobs ${batchStart + 1}-${batchEnd} of ${allJobUuids.length} — ${elapsed()}`
  );

  // ------------------------------------------------------------
  // FETCH MATERIALS ONLY FOR THIS BATCH
  // ------------------------------------------------------------

  let sm8Materials = [];

  try {
    sm8Materials =
      await fetchJobMaterialsForJobs(
        sm8Token,
        batchJobUuids
      );
  } catch (e) {
    // IMPORTANT:
    // We intentionally do NOT advance the checkpoint here.
    // If ServiceM8 returns 429 or the request fails, the next
    // Sync click will retry this exact same batch.
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
          totalJobs: allJobUuids.length,
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

  // ------------------------------------------------------------
  // LOAD PARTS
  // ------------------------------------------------------------

  const { data: parts } = await admin
    .from("parts")
    .select(
      "id, sku, part_no, unit_cost"
    )
    .eq("org_id", orgId);

  const partByKey = {};

  for (const p of parts || []) {
    if (p.sku) {
      partByKey[
        p.sku.trim().toLowerCase()
      ] = p;
    }

    if (p.part_no) {
      partByKey[
        p.part_no.trim().toLowerCase()
      ] = p;
    }
  }

  // ------------------------------------------------------------
  // LOAD ALREADY PROCESSED MATERIALS
  // ------------------------------------------------------------

  const { data: alreadySyncedLines } =
    await admin
      .from("job_line_items")
      .select("servicem8_material_uuid")
      .not(
        "servicem8_material_uuid",
        "is",
        null
      );

  const syncedUuids = new Set(
    (alreadySyncedLines || []).map(
      (l) =>
        l.servicem8_material_uuid
    )
  );

  const { data: alreadyFlagged } =
    await admin
      .from("unmatched_materials")
      .select("servicem8_material_uuid");

  const flaggedUuids = new Set(
    (alreadyFlagged || []).map(
      (f) =>
        f.servicem8_material_uuid
    )
  );

  // ------------------------------------------------------------
  // BUILD MATERIAL PAYLOAD
  // ------------------------------------------------------------

  let materialsDeducted = 0;
  let materialsFlagged = 0;
  let materialsSkippedNoJob = 0;
  let materialsSkippedNoQty = 0;
  let materialsSkippedLabor = 0;

  const totalMaterialsSeen =
    sm8Materials.length;

  // ------------------------------------------------------------
  // IDENTIFY LABOR
  // ------------------------------------------------------------

  const laborMaterials =
    sm8Materials.filter((m) =>
      isLaborItem(m.name)
    );

  for (const labor of laborMaterials) {
    materialsSkippedLabor++;

    console.log(
      `[sm8 sync] skipping labor item: ${labor.name}`
    );
  }

  // ------------------------------------------------------------
  // CANDIDATE MATERIALS
  // ------------------------------------------------------------
  //
  // Labor is excluded here so it never reaches:
  // - part matching
  // - inventory deduction
  // - Needs Review
  //

  const candidateMaterials =
    sm8Materials.filter(
      (m) =>
        m.uuid &&
        !syncedUuids.has(m.uuid) &&
        !flaggedUuids.has(m.uuid) &&
        !isLaborItem(m.name)
    );

  const materialPayload = [];

  for (const m of candidateMaterials) {
    const jobId =
      jobIdByUuid[m.job_uuid];

    if (!jobId) {
      materialsSkippedNoJob++;
      continue;
    }

    const qty = Number(
      m.quantity ?? m.qty ?? 0
    );

    if (!qty) {
      materialsSkippedNoQty++;
      continue;
    }

    const key = (m.name || "")
      .trim()
      .toLowerCase();

    const match = partByKey[key];

    materialPayload.push({
      job_id: jobId,
      part_id: match
        ? match.id
        : null,
      servicem8_material_uuid:
        m.uuid,
      raw_name:
        m.name || "(unnamed)",
      qty,
      unit_cost:
        Number(m.cost) ||
        (match
          ? match.unit_cost
          : 0) ||
        0,
      sale_cost:
        Number(m.price) || 0,
    });
  }

  // ------------------------------------------------------------
  // PROCESS MATERIALS
  // ------------------------------------------------------------

  if (materialPayload.length > 0) {
    const {
      data: result,
      error: processErr,
    } = await admin
      .rpc("process_synced_materials", {
        p_org_id: orgId,
        p_location_id: mainLoc.id,
        p_materials: materialPayload,
      })
      .single();

    if (processErr) {
      // IMPORTANT:
      // Do not advance checkpoint if material processing fails.
      // The same batch will be retried next time.
      console.error(
        `[sm8 sync] material processing failed for jobs ${batchStart + 1}-${batchEnd}:`,
        processErr
      );

      return NextResponse.json(
        {
          error: `Material processing failed: ${processErr.message}`,
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

    materialsDeducted =
      result?.deducted_count || 0;

    materialsFlagged =
      result?.flagged_count || 0;
  }

  console.log(
    `[sm8 sync] processed ${materialPayload.length} material lines (${materialsDeducted} deducted, ${materialsFlagged} flagged, ${materialsSkippedLabor} labor skipped) — ${elapsed()}`
  );

  // ------------------------------------------------------------
  // ADVANCE CHECKPOINT
  // ------------------------------------------------------------

  const syncComplete =
    batchEnd >= allJobUuids.length;

  const newNextIndex = syncComplete
    ? allJobUuids.length
    : batchEnd;

  const {
    error: checkpointUpdateErr,
  } = await admin
    .from("servicem8_sync_state")
    .upsert({
      org_id: orgId,
      job_uuids: allJobUuids,
      next_index: newNextIndex,
      sync_started_at:
        syncState?.sync_started_at ||
        new Date().toISOString(),
      updated_at:
        new Date().toISOString(),
    });

  if (checkpointUpdateErr) {
    // IMPORTANT:
    // Material processing has already succeeded.
    // The material UUID protection prevents duplicate processing
    // if this checkpoint save fails and the batch is retried.
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

  // ------------------------------------------------------------
  // UPDATE LAST SYNC TIME
  // ------------------------------------------------------------

  await admin
    .from("integrations")
    .update({
      last_synced_at:
        new Date().toISOString(),
    })
    .eq("id", integration.id);

  // ------------------------------------------------------------
  // ACTIVITY LOG
  // ------------------------------------------------------------

  await admin.from("activity_log").insert({
    org_id: orgId,
    user_id: userData.user.id,
    message: syncComplete
      ? `Completed ServiceM8 material sync: ${jobsCreated} new job(s), ${jobsUpdated} updated, ${materialsDeducted} material(s) deducted, ${materialsFlagged} flagged for review, ${materialsSkippedLabor} labor item(s) skipped.`
      : `ServiceM8 sync progress: processed jobs ${batchStart + 1}-${batchEnd} of ${allJobUuids.length}; ${materialsDeducted} material(s) deducted, ${materialsFlagged} flagged for review, ${materialsSkippedLabor} labor item(s) skipped.`,
  });

  // ------------------------------------------------------------
  // RESPONSE
  // ------------------------------------------------------------

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
      processedTo: batchEnd,
      nextIndex: newNextIndex,
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
      materialsSkippedNoJob,
      materialsSkippedNoQty,
      materialsSkippedLabor,
      batchSize: JOB_BATCH_SIZE,
      elapsed: elapsed(),

      // Temporary diagnostic data.
      // Remove this later once material matching is confirmed.
      sampleRawMaterials:
        sm8Materials.slice(0, 3),
    },
  });
}