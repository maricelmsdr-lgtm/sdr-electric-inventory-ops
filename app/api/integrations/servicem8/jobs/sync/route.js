import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getValidAccessToken,
  fetchJobs,
  fetchJobMaterialsForJobs,
  fetchCompanies,
} from "@/lib/servicem8";

// ServiceM8 can take a while when batches are being processed.
export const maxDuration = 60;

const JOB_BATCH_SIZE = 10;
const SYNC_WINDOW_DAYS = 14;

/* ============================================================
   HELPERS
   ============================================================ */

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ");
}

function compact(value) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function addIndex(index, value, part) {
  const key = normalize(value);

  if (!key) return;

  if (!index[key]) {
    index[key] = part;
  }
}

/* ============================================================
   NON-INVENTORY SERVICE / LABOR DETECTION
   ============================================================ */

function isNonInventoryCharge(name) {
  const value = normalize(name);

  if (!value) return false;

  // Labor / labour
  if (/\blabou?r\b/i.test(value)) {
    return true;
  }

  // Hours / hrs / hr
  if (/\bhours?\b/i.test(value)) {
    return true;
  }

  if (/\b(?:\d+(?:\.\d+)?\s*)?hrs?\b/i.test(value)) {
    return true;
  }

  if (/\bafter\s+hours?\b/i.test(value)) {
    return true;
  }

  // Technician / apprentice labor
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

  // Service charges
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
    /\b(?:service|callback|labor|labour|charge|fee)\b/i.test(
      value
    )
  ) {
    return true;
  }

  return false;
}

/* ============================================================
   SERVICEM8 BUNDLE DETECTION
   ============================================================ */

/*
  ServiceM8 represents a bundle as multiple jobmaterial rows.

  Example:

  HEADER
    uuid = AAA
    name = "$JOBMATERIAL"

  CHILD
    uuid = BBB
    job_material_bundle_uuid = AAA
    name = "TYWRAP 8 BLACK WITH MOUNTING HOLE"

  CHILD
    uuid = CCC
    job_material_bundle_uuid = AAA
    name = "SUBMERSIBLE 4-WIRE CLEAR HEAT SHRINK SPLICE KIT HSKC-4"

  The HEADER is NOT physical inventory.

  The CHILDREN ARE physical inventory.
*/

function isObviousBundleHeader(material, bundleHeaderUuids) {
  if (!material?.uuid) return false;

  const uuid = String(material.uuid);

  if (bundleHeaderUuids.has(uuid)) {
    return true;
  }

  const name = normalize(material.name);

  if (
    name === "$jobmaterial" ||
    name === "jobmaterial" ||
    name === "materials"
  ) {
    return true;
  }

  return false;
}

/* ============================================================
   PART MATCHING
   ============================================================ */

function buildPartIndexes(parts) {
  const byServiceM8Id = {};
  const byKey = {};

  for (const part of parts || []) {
    if (part.servicem8_material_id) {
      byServiceM8Id[
        String(part.servicem8_material_id).trim()
      ] = part;
    }

    addIndex(byKey, part.sku, part);
    addIndex(byKey, part.part_no, part);
    addIndex(byKey, part.description, part);
  }

  return {
    byServiceM8Id,
    byKey,
  };
}

function findPartMatch(material, indexes) {
  if (!material) {
    return null;
  }

  /*
   * ----------------------------------------------------------
   * MATCH #1 — ServiceM8 MATERIAL UUID
   * ----------------------------------------------------------

   This is the strongest possible match.

   ServiceM8 jobmaterial:
     material_uuid

   SDR part:
     servicem8_material_id
   */

  const serviceM8MaterialId =
    material.material_uuid ||
    material.material_id ||
    material.servicem8_material_id ||
    material.servicem8_material_uuid;

  if (serviceM8MaterialId) {
    const exact =
      indexes.byServiceM8Id[
        String(serviceM8MaterialId).trim()
      ];

    if (exact) {
      return {
        part: exact,
        method: "servicem8_material_uuid",
      };
    }
  }

  /*
   * ----------------------------------------------------------
   * MATCH #2 — ServiceM8 ITEM NUMBER / SKU
   * ----------------------------------------------------------
   */

  const itemNumberCandidates = [
    material.item_number,
    material.itemNumber,
    material.item_no,
    material.itemNo,
    material.item_code,
    material.itemCode,
    material.code,
    material.sku,
    material.part_no,
    material.partNo,
  ];

  for (const candidate of itemNumberCandidates) {
    const key = normalize(candidate);

    if (!key) continue;

    const exact = indexes.byKey[key];

    if (exact) {
      return {
        part: exact,
        method: "item_number",
      };
    }
  }

  /*
   * ----------------------------------------------------------
   * MATCH #3 — NAME / DESCRIPTION
   * ----------------------------------------------------------
   */

  const nameCandidates = [
    material.name,
    material.item_description,
    material.description,
  ];

  for (const candidate of nameCandidates) {
    const key = normalize(candidate);

    if (!key) continue;

    const exact = indexes.byKey[key];

    if (exact) {
      return {
        part: exact,
        method: "name",
      };
    }
  }

  /*
   * ----------------------------------------------------------
   * MATCH #4 — CODE FOUND INSIDE MATERIAL NAME
   * ----------------------------------------------------------

   Example:

     "SUBMERSIBLE 4-WIRE CLEAR HEAT SHRINK SPLICE KIT HSKC-4"

   If HSKC-4 is the SDR part number or SKU, this will find it.
   */

  const text = [
    material.name,
    material.item_description,
    material.description,
  ]
    .filter(Boolean)
    .join(" ");

  const tokens =
    text.match(
      /\b[A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+)+\b/g
    ) || [];

  for (const token of tokens) {
    const key = normalize(token);

    const exact = indexes.byKey[key];

    if (exact) {
      return {
        part: exact,
        method: "embedded_code",
      };
    }
  }

  /*
   * ----------------------------------------------------------
   * NO MATCH
   * ----------------------------------------------------------
   */

  return null;
}

/* ============================================================
   POST
   ============================================================ */

export async function POST(request) {
  const t0 = Date.now();

  const elapsed = () =>
    `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  const body = await request
    .json()
    .catch(() => ({}));

  /*
   * Current frontend sends org_id.
   */
  const requestedOrgId = body?.org_id;

  if (!requestedOrgId) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: "Missing org_id.",
      },
      { status: 400 }
    );
  }

  /* ==========================================================
     SUPABASE ADMIN
     ========================================================== */

  let admin;

  try {
    admin = supabaseAdmin();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error:
          "Server isn't configured yet (missing Supabase service key).",
      },
      { status: 500 }
    );
  }

  const orgId = requestedOrgId;

  /* ==========================================================
     VERIFY ORG HAS PARTS
     ========================================================== */

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
        ok: false,
        success: false,
        error: `Could not verify organization: ${orgCheckError.message}`,
      },
      { status: 500 }
    );
  }

  if (!orgCheck?.org_id) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error:
          "The supplied organization does not have any inventory parts.",
      },
      { status: 400 }
    );
  }

  /* ==========================================================
     SERVICEM8 INTEGRATION
     ========================================================== */

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
        ok: false,
        success: false,
        error: `Could not load ServiceM8 integration: ${integrationError.message}`,
      },
      { status: 500 }
    );
  }

  if (!integration?.connected) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
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
        ok: false,
        success: false,
        error:
          e?.message ||
          "Unable to obtain ServiceM8 access token.",
      },
      { status: 400 }
    );
  }

  /* ==========================================================
     MAIN WAREHOUSE
     ========================================================== */

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
        ok: false,
        success: false,
        error: `Could not load Main Warehouse: ${mainLocError.message}`,
      },
      { status: 500 }
    );
  }

  if (!mainLoc?.id) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error:
          "No Main Warehouse location found for this org — set one up before syncing.",
      },
      { status: 400 }
    );
  }

  /* ==========================================================
     FETCH SERVICEM8 JOBS
     ========================================================== */

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
        ok: false,
        success: false,
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

  /* ==========================================================
     COMPANY LOOKUP
     ========================================================== */

  const companyName = {};

  for (const company of sm8Companies || []) {
    if (company?.uuid) {
      companyName[company.uuid] =
        company.name || "";
    }
  }

  /* ==========================================================
     FILTER JOBS
     ========================================================== */

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

  relevantJobs.sort((a, b) =>
    String(a.uuid).localeCompare(
      String(b.uuid)
    )
  );

  console.log(
    `[sm8 sync] ${relevantJobs.length} relevant jobs after filtering — ${elapsed()}`
  );

  /* ==========================================================
     EXISTING JOBS
     ========================================================== */

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
        ok: false,
        success: false,
        error: `Could not load existing jobs: ${existingJobsError.message}`,
      },
      { status: 500 }
    );
  }

  const jobIdByUuid =
    Object.fromEntries(
      (existingJobs || []).map(
        (job) => [
          job.servicem8_job_uuid,
          job.id,
        ]
      )
    );

  const preExistingUuids =
    new Set(
      Object.keys(jobIdByUuid)
    );

  /* ==========================================================
     UPSERT JOBS
     ========================================================== */

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
          ok: false,
          success: false,
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

  /* ==========================================================
     CHECKPOINT
     ========================================================== */

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
        ok: false,
        success: false,
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

  /* ==========================================================
     NO JOBS
     ========================================================== */

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
      .eq(
        "id",
        integration.id
      );

    return NextResponse.json({
      ok: true,
      success: true,

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

  /* ==========================================================
     INITIALIZE CHECKPOINT
     ========================================================== */

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
          ok: false,
          success: false,
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

  /* ==========================================================
     DETERMINE BATCH
     ========================================================== */

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

  /* ==========================================================
     FETCH JOB MATERIALS
     ========================================================== */

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
        ok: false,
        success: false,

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

  /* ==========================================================
     BUNDLE ANALYSIS
     ========================================================== */

  const bundleHeaderUuids =
    new Set(
      (sm8Materials || [])
        .map(
          (m) =>
            m?.job_material_bundle_uuid
        )
        .filter(Boolean)
        .map(String)
    );

  const bundleHeaders =
    (sm8Materials || []).filter(
      (m) =>
        m?.uuid &&
        bundleHeaderUuids.has(
          String(m.uuid)
        )
    );

  const bundleChildren =
    (sm8Materials || []).filter(
      (m) =>
        m?.job_material_bundle_uuid
    );

  console.log(
    `[sm8 bundle] ${bundleHeaders.length} bundle header(s), ${bundleChildren.length} bundle child line(s) detected`
  );

  if (bundleHeaders.length > 0) {
    console.log(
      "[sm8 bundle] headers skipped from inventory:"
    );

    for (const header of bundleHeaders) {
      console.log(
        JSON.stringify(
          {
            uuid:
              header.uuid,
            name:
              header.name,
            job_uuid:
              header.job_uuid,
          },
          null,
          2
        )
      );
    }
  }

  /* ==========================================================
     LOAD PARTS
     ========================================================== */

  const {
    data: parts,
    error: partsError,
  } = await admin
    .from("parts")
    .select(
      "id, sku, part_no, description, unit_cost, servicem8_material_id"
    )
    .eq(
      "org_id",
      orgId
    );

  if (partsError) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error:
          `Could not load inventory parts: ${partsError.message}`,
      },
      { status: 500 }
    );
  }

  const partIndexes =
    buildPartIndexes(
      parts || []
    );

  console.log(
    `[sm8 match] loaded ${
      parts?.length || 0
    } SDR parts`
  );

  /* ==========================================================
     LOAD PROCESSED MATERIAL UUIDS
     ========================================================== */

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
        ok: false,
        success: false,
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
        .map(String)
    );

  /* ==========================================================
     LOAD NEEDS REVIEW UUIDS
     ========================================================== */

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
        ok: false,
        success: false,
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
        .map(String)
    );

  /* ==========================================================
     COUNTERS
     ========================================================== */

  let materialsDeducted = 0;
  let materialsFlagged = 0;

  let materialsSkippedNoJob = 0;
  let materialsSkippedNoQty = 0;
  let materialsSkippedNonInventory = 0;

  let materialsSkippedBundleHeader = 0;

  let materialsMatchedByServiceM8Id = 0;
  let materialsMatchedByItemNumber = 0;
  let materialsMatchedByName = 0;
  let materialsMatchedByEmbeddedCode = 0;

  let staleReviewRowsRemoved = 0;

  const totalMaterialsSeen =
    sm8Materials.length;

  /* ==========================================================
     REMOVE STALE BUNDLE HEADER REVIEW RECORDS
     ========================================================== */

  const bundleHeaderReviewUuids =
    bundleHeaders
      .map(
        (m) => m?.uuid
      )
      .filter(Boolean);

  if (
    bundleHeaderReviewUuids.length >
    0
  ) {
    const {
      data: removedBundleRows,
      error: bundleCleanupError,
    } = await admin
      .from("unmatched_materials")
      .delete()
      .in(
        "servicem8_material_uuid",
        bundleHeaderReviewUuids
      )
      .select(
        "servicem8_material_uuid"
      );

    if (bundleCleanupError) {
      console.warn(
        "[sm8 bundle] Could not clean old bundle-header Needs Review rows:",
        bundleCleanupError
      );
    } else {
      staleReviewRowsRemoved +=
        removedBundleRows?.length ||
        0;
    }
  }

  /* ==========================================================
     IDENTIFY NON-INVENTORY ITEMS
     ========================================================== */

  const nonInventoryItems =
    sm8Materials.filter(
      (material) =>
        isNonInventoryCharge(
          material?.name
        )
    );

  for (const item of nonInventoryItems) {
    materialsSkippedNonInventory++;

    console.log(
      `[sm8 sync] NON-INVENTORY — skipped: ${
        item?.name ||
        "(unnamed)"
      }`
    );
  }

  /* ==========================================================
     BUILD CANDIDATE MATERIALS
     ========================================================== */

  const candidateMaterials =
    sm8Materials.filter(
      (material) => {
        if (!material?.uuid) {
          return false;
        }

        const materialUuid =
          String(
            material.uuid
          );

        /*
         * Bundle header:
         *
         * NEVER inventory.
         */
        if (
          isObviousBundleHeader(
            material,
            bundleHeaderUuids
          )
        ) {
          materialsSkippedBundleHeader++;
          return false;
        }

        /*
         * Labor/service:
         *
         * NEVER inventory.
         */
        if (
          isNonInventoryCharge(
            material.name
          )
        ) {
          return false;
        }

        /*
         * Already successfully processed.
         */
        if (
          syncedUuids.has(
            materialUuid
          )
        ) {
          return false;
        }

        return true;
      }
    );

  /* ==========================================================
     BUILD MATERIAL PAYLOAD
     ========================================================== */

  const materialPayload = [];

  const matchedMaterialUuids =
    [];

  for (
    const material of
    candidateMaterials
  ) {
    const materialUuid =
      String(
        material.uuid
      );

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

    /*
     * --------------------------------------------------------
     * MATCH THE PART
     * --------------------------------------------------------
     */

    const match =
      findPartMatch(
        material,
        partIndexes
      );

    const matchedPart =
      match?.part || null;

    if (match) {
      console.log(
        `[sm8 match] ${
          material.name ||
          "(unnamed)"
        } -> ${
          matchedPart.part_no ||
          matchedPart.sku
        } via ${match.method}`
      );

      if (
        match.method ===
        "servicem8_material_uuid"
      ) {
        materialsMatchedByServiceM8Id++;
      }

      if (
        match.method ===
        "item_number"
      ) {
        materialsMatchedByItemNumber++;
      }

      if (
        match.method ===
        "name"
      ) {
        materialsMatchedByName++;
      }

      if (
        match.method ===
        "embedded_code"
      ) {
        materialsMatchedByEmbeddedCode++;
      }

      matchedMaterialUuids.push(
        materialUuid
      );
    } else {
      console.warn(
        `[sm8 match] NO MATCH: ${
          material.name ||
          "(unnamed)"
        } | material_uuid=${
          material.material_uuid ||
          "none"
        } | item_number=${
          material.item_number ||
          material.itemNumber ||
          "none"
        }`
      );
    }

    materialPayload.push({
      job_id: jobId,

      /*
       * IMPORTANT:
       *
       * If this is null, process_synced_materials
       * will put it into Needs Review.
       *
       * That is intentional for genuine physical
       * materials that we cannot identify.
       */
      part_id:
        matchedPart?.id ||
        null,

      servicem8_material_uuid:
        materialUuid,

      raw_name:
        material.name ||
        "(unnamed)",

      qty,

      unit_cost:
        Number(material.cost) ||
        (
          matchedPart
            ? Number(
                matchedPart.unit_cost
              )
            : 0
        ) ||
        0,

      sale_cost:
        Number(material.price) ||
        0,
    });
  }

  /* ==========================================================
     CLEAN OLD NEEDS REVIEW ROWS THAT ARE NOW MATCHED
     ========================================================== */

  if (
    matchedMaterialUuids.length >
    0
  ) {
    const {
      data: removedMatchedRows,
      error: matchedCleanupError,
    } = await admin
      .from("unmatched_materials")
      .delete()
      .in(
        "servicem8_material_uuid",
        matchedMaterialUuids
      )
      .select(
        "servicem8_material_uuid"
      );

    if (matchedCleanupError) {
      console.warn(
        "[sm8 match] Could not remove stale matched Needs Review rows:",
        matchedCleanupError
      );
    } else {
      staleReviewRowsRemoved +=
        removedMatchedRows?.length ||
        0;
    }
  }

  /*
   * IMPORTANT:
   *
   * A material that was previously flagged should NOT
   * be blocked if we can now match it.
   *
   * Rebuild the flagged set after removing stale
   * matched records.
   */

  const currentFlaggedUuids =
    new Set(
      flaggedUuids
    );

  for (
    const uuid of
    matchedMaterialUuids
  ) {
    currentFlaggedUuids.delete(
      uuid
    );
  }

  /* ==========================================================
     REMOVE OLD FLAGGED ITEMS FROM PAYLOAD
     ========================================================== */

  const processablePayload =
    materialPayload.filter(
      (row) => {
        /*
         * If this UUID was previously flagged
         * and is STILL unmatched, don't create
         * another review row.
         */
        if (
          currentFlaggedUuids.has(
            String(
              row.servicem8_material_uuid
            )
          ) &&
          !row.part_id
        ) {
          return false;
        }

        return true;
      }
    );

  /* ==========================================================
     DEBUG JOB 15158
     ========================================================== */

  const debugJob15158 =
    sm8Jobs?.find(
      (job) =>
        String(
          job.generated_job_id ||
            ""
        ).trim() ===
        "15158"
    );

  if (debugJob15158) {
    const debugLines =
      sm8Materials.filter(
        (material) =>
          material.job_uuid ===
          debugJob15158.uuid
      );

    console.log(
      `[DEBUG 15158] ${debugLines.length} ServiceM8 material line(s) found`
    );

    console.log(
      JSON.stringify(
        debugLines,
        null,
        2
      )
    );
  }

  /* ==========================================================
     DEBUG BUNDLE SUMMARY
     ========================================================== */

  console.log(
    `[sm8 bundle] SUMMARY:
      total raw lines = ${totalMaterialsSeen}
      bundle headers = ${bundleHeaders.length}
      bundle children = ${bundleChildren.length}
      non-inventory = ${materialsSkippedNonInventory}
      candidates = ${candidateMaterials.length}
      processable = ${processablePayload.length}
    `
  );

  /* ==========================================================
     PROCESS MATERIALS
     ========================================================== */

  if (
    processablePayload.length >
    0
  ) {
    const {
      data: result,
      error: processErr,
    } = await admin
      .rpc(
        "process_synced_materials",
        {
          p_org_id:
            orgId,

          p_location_id:
            mainLoc.id,

          p_materials:
            processablePayload,
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
          ok: false,
          success: false,

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
            "The checkpoint was not advanced because material processing failed. The same batch will be retried.",
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

  /* ==========================================================
     LOG PROCESSING RESULT
     ========================================================== */

  console.log(
    `[sm8 sync] processed ${
      processablePayload.length
    } physical material lines:
      deducted=${materialsDeducted}
      flagged=${materialsFlagged}
      nonInventory=${materialsSkippedNonInventory}
      bundleHeadersSkipped=${materialsSkippedBundleHeader}
      matchedByServiceM8Id=${materialsMatchedByServiceM8Id}
      matchedByItemNumber=${materialsMatchedByItemNumber}
      matchedByName=${materialsMatchedByName}
      matchedByEmbeddedCode=${materialsMatchedByEmbeddedCode}
      staleReviewRowsRemoved=${staleReviewRowsRemoved}
      elapsed=${elapsed()}`
  );

  /* ==========================================================
     ADVANCE CHECKPOINT
     ========================================================== */

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
        success: true,

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

        diagnostics: {
          totalMaterialsSeen,

          materialsSkippedNoJob,

          materialsSkippedNoQty,

          materialsSkippedNonInventory,

          materialsSkippedBundleHeader,

          materialsMatchedByServiceM8Id,

          materialsMatchedByItemNumber,

          materialsMatchedByName,

          materialsMatchedByEmbeddedCode,

          staleReviewRowsRemoved,

          candidateInventoryMaterials:
            candidateMaterials.length,

          processableInventoryMaterials:
            processablePayload.length,

          batchSize:
            JOB_BATCH_SIZE,

          elapsed:
            elapsed(),
        },
      },
      { status: 200 }
    );
  }

  /* ==========================================================
     UPDATE LAST SYNC
     ========================================================== */

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

  /* ==========================================================
     ACTIVITY LOG
     ========================================================== */

  await admin
    .from("activity_log")
    .insert({
      org_id: orgId,

      message:
        syncComplete
          ? `Completed ServiceM8 material sync: ${jobsCreated} new job(s), ${jobsUpdated} updated, ${materialsDeducted} physical material(s) deducted, ${materialsFlagged} flagged for review, ${materialsSkippedNonInventory} labor/service charge(s) skipped, ${materialsSkippedBundleHeader} bundle header(s) skipped.`
          : `ServiceM8 sync progress: processed jobs ${
              batchStart + 1
            }-${batchEnd} of ${
              allJobUuids.length
            }; ${materialsDeducted} physical material(s) deducted, ${materialsFlagged} flagged for review, ${materialsSkippedNonInventory} labor/service charge(s) skipped, ${materialsSkippedBundleHeader} bundle header(s) skipped.`,
    });

  /* ==========================================================
     RESPONSE
     ========================================================== */

  return NextResponse.json({
    ok: true,
    success: true,

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

    message:
      syncComplete
        ? "ServiceM8 sync complete."
        : `Processed jobs ${
            batchStart + 1
          }-${batchEnd} of ${
            allJobUuids.length
          }. Click Sync again to continue.`,

    diagnostics: {
      totalMaterialsSeen,

      materialsSkippedNoJob,

      materialsSkippedNoQty,

      materialsSkippedNonInventory,

      materialsSkippedBundleHeader,

      materialsMatchedByServiceM8Id,

      materialsMatchedByItemNumber,

      materialsMatchedByName,

      materialsMatchedByEmbeddedCode,

      staleReviewRowsRemoved,

      candidateInventoryMaterials:
        candidateMaterials.length,

      processableInventoryMaterials:
        processablePayload.length,

      bundleHeadersDetected:
        bundleHeaders.length,

      bundleChildrenDetected:
        bundleChildren.length,

      batchSize:
        JOB_BATCH_SIZE,

      elapsed:
        elapsed(),

      /*
       * Keep this while testing.
       * It lets us inspect exactly what ServiceM8
       * returned for the bundle.
       */
      sampleRawMaterials:
        sm8Materials.slice(
          0,
          10
        ),
    },
  });
}