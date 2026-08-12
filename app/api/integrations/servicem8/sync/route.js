import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getValidAccessToken,
  fetchJobs,
  fetchJobMaterialsForJobs,
  fetchCompanies,
  fetchMaterialsCatalog,
} from "@/lib/servicem8";

// Retrying through a rate limit can take a while.
export const maxDuration = 60;

const JOB_BATCH_SIZE = 10;
const SYNC_WINDOW_DAYS = 14;

// ------------------------------------------------------------
// NON-INVENTORY SERVICE / LABOR DETECTION
// ------------------------------------------------------------

function isNonInventoryCharge(name) {
  const value = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ");

  if (!value) return false;

  // Labor / labour
  if (/\blabou?r\b/i.test(value)) return true;

  // Hours / hr / hrs
  if (/\bhours?\b/i.test(value)) return true;
  if (/\b(?:\d+(?:\.\d+)?\s*)?hrs?\b/i.test(value)) return true;
  if (/\bafter\s+hours?\b/i.test(value)) return true;

  // Technician / apprentice labor
  if (/\btechnician\b.*\b(?:apprentice|hours?|hrs?|hr)\b/i.test(value)) {
    return true;
  }

  // Service charges
  if (/\bservice\s+call\s+fee\b/i.test(value)) return true;
  if (/\bservice\s+fee\b/i.test(value)) return true;
  if (/\bservice\s+rate\b/i.test(value)) return true;
  if (/\bservice\s+charge\b/i.test(value)) return true;
  if (/\btruck\s+charge\b/i.test(value)) return true;
  if (/\bcall\s*-?\s*out\s+(?:fee|charge|rate)\b/i.test(value)) {
    return true;
  }
  if (/\btravel\s+(?:fee|charge)\b/i.test(value)) return true;

  // Warranty / callback service
  if (
    /\b(?:after[- ]installation|post[- ]installation)\b.*\bcallback\b/i.test(
      value
    )
  ) {
    return true;
  }

  if (
    /\bwarranty\b/i.test(value) &&
    /\b(?:service|callback|labor|labour|charge|fee)\b/i.test(value)
  ) {
    return true;
  }

  return false;
}

// ------------------------------------------------------------
// NORMALIZE LOOKUP KEY
// ------------------------------------------------------------

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

// ------------------------------------------------------------
// BUILD SERVICE M8 MATERIAL CATALOG LOOKUP
// ------------------------------------------------------------
//
// ServiceM8 jobmaterial.json gives us material_uuid.
// The actual material code such as TYWRAP8MOUNTBLK is in
// material.json as item_number.
//
// UUID -> catalog material
// ------------------------------------------------------------

function buildCatalogByUuid(catalog) {
  const lookup = {};

  for (const item of catalog || []) {
    const uuid = normalizeKey(item?.uuid);

    if (!uuid) continue;

    lookup[uuid] = item;
  }

  return lookup;
}

// ------------------------------------------------------------
// GET BEST SERVICE M8 MATERIAL IDENTIFIERS
// ------------------------------------------------------------

function resolveCatalogMaterial(jobMaterial, catalogByUuid) {
  const materialUuid = normalizeKey(jobMaterial?.material_uuid);

  const catalogItem = materialUuid
    ? catalogByUuid[materialUuid]
    : null;

  const itemNumber = String(
    catalogItem?.item_number ||
      catalogItem?.item_no ||
      catalogItem?.code ||
      ""
  ).trim();

  const catalogName = String(
    catalogItem?.name ||
      catalogItem?.description ||
      ""
  ).trim();

  const jobMaterialName = String(
    jobMaterial?.name ||
      jobMaterial?.description ||
      ""
  ).trim();

  return {
    catalogItem,
    materialUuid,
    itemNumber,
    catalogName,
    jobMaterialName,
  };
}

// ------------------------------------------------------------
// POST
// ------------------------------------------------------------

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
  let sm8Catalog;

  try {
    // IMPORTANT:
    // The catalog is fetched account-wide once.
    //
    // jobmaterial.json gives us material_uuid.
    // material.json gives us item_number.
    //
    // We need both to correctly identify actual issued parts.

    [sm8Jobs, sm8Companies, sm8Catalog] =
      await Promise.all([
        fetchJobs(sm8Token, cutoffStr),
        fetchCompanies(sm8Token),
        fetchMaterialsCatalog(sm8Token),
      ]);
  } catch (e) {
    console.error(
      "[sm8 sync] initial ServiceM8 fetch failed:",
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
    } companies, ${
      sm8Catalog?.length ?? 0
    } catalog materials — ${elapsed()}`
  );

  // ------------------------------------------------------------
  // SERVICE M8 MATERIAL CATALOG LOOKUP
  // ------------------------------------------------------------

  const catalogByUuid =
    buildCatalogByUuid(sm8Catalog);

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

    // Ignore ServiceM8 built-in sample job.
    if (
      jobNo === "SAMPLE" ||
      client.includes("help guide")
    ) {
      return false;
    }

    return true;
  });

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
        error:
          `Could not load ServiceM8 sync checkpoint: ${syncStateErr.message}`,
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

  // ------------------------------------------------------------
  // NO JOBS
  // ------------------------------------------------------------

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
        serviceM8CatalogCount:
          sm8Catalog?.length ?? 0,
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
          error:
            `Could not initialize ServiceM8 sync checkpoint: ${checkpointErr.message}`,
        },
        { status: 500 }
      );
    }
  }

  // ------------------------------------------------------------
  // DETERMINE BATCH
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
  // FETCH MATERIALS FOR THIS BATCH
  // ------------------------------------------------------------

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

  // ------------------------------------------------------------
  // LOAD SDR PARTS
  // ------------------------------------------------------------

  const { data: parts, error: partsErr } =
    await admin
      .from("parts")
      .select(
        "id, sku, part_no, unit_cost"
      )
      .eq("org_id", orgId);

  if (partsErr) {
    return NextResponse.json(
      {
        error:
          `Could not load SDR parts: ${partsErr.message}`,
      },
      { status: 500 }
    );
  }

  const partByKey = {};

  for (const p of parts || []) {
    if (p.sku) {
      partByKey[
        normalizeKey(p.sku)
      ] = p;
    }

    if (p.part_no) {
      partByKey[
        normalizeKey(p.part_no)
      ] = p;
    }
  }

  // ------------------------------------------------------------
  // LOAD ALREADY PROCESSED MATERIALS
  // ------------------------------------------------------------

  const {
    data: alreadySyncedLines,
    error: syncedErr,
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

  if (syncedErr) {
    return NextResponse.json(
      {
        error:
          `Could not load processed materials: ${syncedErr.message}`,
      },
      { status: 500 }
    );
  }

  const syncedUuids = new Set(
    (alreadySyncedLines || []).map(
      (l) =>
        normalizeKey(
          l.servicem8_material_uuid
        )
    )
  );

  // ------------------------------------------------------------
  // LOAD FLAGGED MATERIALS
  // ------------------------------------------------------------
  //
  // We DO NOT permanently skip a flagged UUID if it now
  // matches an SDR part.
  //
  // This is important:
  //
  // Stock = 0 today
  //       ↓
  // flagged insufficient_stock
  //       ↓
  // stock is replenished tomorrow
  //       ↓
  // next ServiceM8 sync can attempt deduction again
  //
  // But an unmatched item with no SDR part remains skipped
  // so we don't create endless duplicate "no_match" rows.
  // ------------------------------------------------------------

  const {
    data: alreadyFlagged,
    error: flaggedErr,
  } = await admin
    .from("unmatched_materials")
    .select(
      "servicem8_material_uuid, reason"
    );

  if (flaggedErr) {
    return NextResponse.json(
      {
        error:
          `Could not load flagged materials: ${flaggedErr.message}`,
      },
      { status: 500 }
    );
  }

  const flaggedByUuid = new Map();

  for (const f of alreadyFlagged || []) {
    const uuid = normalizeKey(
      f.servicem8_material_uuid
    );

    if (uuid) {
      flaggedByUuid.set(
        uuid,
        f.reason
      );
    }
  }

  // ------------------------------------------------------------
  // BUILD MATERIAL PAYLOAD
  // ------------------------------------------------------------

  let materialsDeducted = 0;
  let materialsFlagged = 0;
  let materialsSkippedNoJob = 0;
  let materialsSkippedNoQty = 0;
  let materialsSkippedNonInventory = 0;
  let materialsSkippedAlreadyProcessed = 0;
  let materialsCatalogResolved = 0;
  let materialsCatalogMissing = 0;

  const totalMaterialsSeen =
    sm8Materials.length;

  // ------------------------------------------------------------
  // PROCESS EACH SERVICE M8 MATERIAL
  // ------------------------------------------------------------

  const materialPayload = [];

  for (const m of sm8Materials) {
    const jobId =
      jobIdByUuid[m.job_uuid];

    if (!jobId) {
      materialsSkippedNoJob++;
      continue;
    }

    const qty = Number(
      m.quantity ??
        m.qty ??
        0
    );

    if (!qty) {
      materialsSkippedNoQty++;
      continue;
    }

    // ----------------------------------------------------------
    // RESOLVE THE REAL SERVICE M8 CATALOG ITEM
    // ----------------------------------------------------------

    const resolved =
      resolveCatalogMaterial(
        m,
        catalogByUuid
      );

    const itemNumber =
      resolved.itemNumber;

    const catalogName =
      resolved.catalogName;

    const jobMaterialName =
      resolved.jobMaterialName;

    if (itemNumber) {
      materialsCatalogResolved++;
    } else {
      materialsCatalogMissing++;
    }

    // Use catalog name first when available for labor detection.
    const inventoryDisplayName =
      catalogName ||
      jobMaterialName ||
      itemNumber;

    // ----------------------------------------------------------
    // LABOR / SERVICE CHARGE
    // ----------------------------------------------------------

    if (
      isNonInventoryCharge(
        inventoryDisplayName
      ) ||
      isNonInventoryCharge(
        jobMaterialName
      )
    ) {
      materialsSkippedNonInventory++;

      console.log(
        `[sm8 sync] skipping non-inventory charge: ${
          inventoryDisplayName || "(unnamed)"
        }`
      );

      continue;
    }

    // ----------------------------------------------------------
    // MATCH SDR PART
    // ----------------------------------------------------------
    //
    // PRIMARY:
    // ServiceM8 catalog item_number
    //
    // FALLBACK:
    // ServiceM8 job material name
    //
    // This means:
    //
    // TYWRAP8MOUNTBLK
    //       ↓
    // ServiceM8 item_number
    //       ↓
    // SDR SKU / part_no
    //
    // ----------------------------------------------------------

    const itemKey =
      normalizeKey(itemNumber);

    const nameKey =
      normalizeKey(jobMaterialName);

    const match =
      (itemKey
        ? partByKey[itemKey]
        : null) ||
      (nameKey
        ? partByKey[nameKey]
        : null);

    const materialUuid =
      m.uuid ||
      m.material_uuid ||
      "";

    const materialUuidKey =
      normalizeKey(materialUuid);

    // ----------------------------------------------------------
    // ALREADY PROCESSED
    // ----------------------------------------------------------

    if (
      materialUuidKey &&
      syncedUuids.has(materialUuidKey)
    ) {
      materialsSkippedAlreadyProcessed++;
      continue;
    }

    // ----------------------------------------------------------
    // ALREADY FLAGGED WITHOUT A MATCH
    // ----------------------------------------------------------
    //
    // If there is still no SDR match, don't keep inserting the
    // exact same unmatched material on every sync.
    //
    // If there IS now a match, however, we allow it through again.
    // This lets a previously unresolved material become inventory
    // automatically after the catalog/part is corrected.
    // ----------------------------------------------------------

    if (
      !match &&
      materialUuidKey &&
      flaggedByUuid.has(materialUuidKey)
    ) {
      continue;
    }

    // ----------------------------------------------------------
    // BUILD PAYLOAD
    // ----------------------------------------------------------

    materialPayload.push({
      job_id: jobId,

      // This is the actual SDR part matched from:
      // ServiceM8 material.item_number -> SDR SKU/part_no
      part_id: match
        ? match.id
        : null,

      // Keep the ServiceM8 job-material UUID.
      servicem8_material_uuid:
        materialUuid,

      // IMPORTANT:
      // Show the actual catalog item number whenever available.
      // This makes TYWRAP8MOUNTBLK the actual issued material
      // instead of only the human-readable ServiceM8 name.
      raw_name:
        itemNumber ||
        jobMaterialName ||
        "(unnamed)",

      qty,

      unit_cost:
        Number(
          m.cost ??
            resolved.catalogItem?.cost ??
            0
        ) ||
        (match
          ? Number(match.unit_cost || 0)
          : 0),

      sale_cost:
        Number(
          m.price ??
            resolved.catalogItem?.price ??
            0
        ) || 0,
    });

    console.log(
      `[sm8 sync] material candidate: job=${jobId} uuid=${materialUuid} item_number=${itemNumber || "(none)"} name=${jobMaterialName || "(none)"} matched_part=${match?.part_no || match?.sku || "(NO MATCH)"} qty=${qty}`
    );
  }

  // ------------------------------------------------------------
  // PROCESS MATERIALS
  // ------------------------------------------------------------

  if (materialPayload.length > 0) {
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
        `[sm8 sync] material processing failed for jobs ${batchStart + 1}-${batchEnd}:`,
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

    materialsDeducted =
      Number(
        result?.deducted_count || 0
      );

    materialsFlagged =
      Number(
        result?.flagged_count || 0
      );
  }

  console.log(
    `[sm8 sync] processed ${materialPayload.length} material lines (${materialsDeducted} deducted, ${materialsFlagged} flagged, ${materialsSkippedNonInventory} non-inventory charges skipped) — ${elapsed()}`
  );

  // ------------------------------------------------------------
  // ADVANCE CHECKPOINT
  // ------------------------------------------------------------

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
      "[sm8 sync] WARNING: checkpoint update failed:",
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
    user_id:
      userData.user.id,
    message: syncComplete
      ? `Completed ServiceM8 material sync: ${jobsCreated} new job(s), ${jobsUpdated} updated, ${materialsDeducted} material(s) deducted, ${materialsFlagged} flagged for review, ${materialsSkippedNonInventory} non-inventory charge(s) skipped.`
      : `ServiceM8 sync progress: processed jobs ${batchStart + 1}-${batchEnd} of ${allJobUuids.length}; ${materialsDeducted} material(s) deducted, ${materialsFlagged} flagged for review, ${materialsSkippedNonInventory} non-inventory charge(s) skipped.`,
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

      materialsSkippedNoJob,
      materialsSkippedNoQty,
      materialsSkippedNonInventory,
      materialsSkippedAlreadyProcessed,

      materialsCatalogResolved,
      materialsCatalogMissing,

      materialPayloadCount:
        materialPayload.length,

      serviceM8CatalogCount:
        sm8Catalog?.length ?? 0,

      batchSize:
        JOB_BATCH_SIZE,

      elapsed: elapsed(),

      sampleRawMaterials:
        sm8Materials.slice(0, 5),
    },
  });
}