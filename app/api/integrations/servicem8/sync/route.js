import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  getValidAccessToken,
  fetchJobs,
  fetchJobMaterialsForJobs,
  fetchCompanies,
  fetchMaterialsCatalog,
} from "@/lib/servicem8";

export const maxDuration = 60;

// Keep each sync request small enough to finish safely inside Vercel.
const JOB_BATCH_SIZE = 10;

// Only sync jobs within this recent window.
const SYNC_WINDOW_DAYS = 14;

// Material requests are intentionally serialized.
const MATERIAL_FETCH_CONCURRENCY = 1;

// Leave enough time for the API calls while staying safely below
// the Vercel function timeout.
const MATERIAL_FETCH_BUDGET_MS = 42_000;

/* ============================================================
   NORMALIZATION
============================================================ */

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ");
}

/* ============================================================
   ORGANIZATION RESOLUTION
============================================================

   Prefer an explicit org_id from the client (body, query string,
   or header). If none is supplied, fall back to the single org
   on record — this installation is single-tenant today, so that
   fallback is safe and prevents the sync from being blocked by a
   frontend that doesn't pass org_id.
============================================================ */

async function resolveOrgId(request, body, admin) {
  const bodyOrgId = body?.org_id || body?.orgId || null;
  if (bodyOrgId) return String(bodyOrgId).trim();

  const url = new URL(request.url);
  const queryOrgId =
    url.searchParams.get("org_id") || url.searchParams.get("orgId");
  if (queryOrgId) return String(queryOrgId).trim();

  const headerOrgId = request.headers.get("x-org-id");
  if (headerOrgId) return String(headerOrgId).trim();

  const { data: orgRows, error: orgRowsError } = await admin
    .from("parts")
    .select("org_id")
    .not("org_id", "is", null)
    .limit(1000);

  if (orgRowsError) {
    throw new Error(
      `Could not automatically determine organization: ${orgRowsError.message}`
    );
  }

  const uniqueOrgIds = [
    ...new Set(
      (orgRows || [])
        .map((row) => row?.org_id)
        .filter(Boolean)
        .map((id) => String(id).trim())
    ),
  ];

  if (uniqueOrgIds.length === 1) {
    console.log(
      `[sm8 sync] org_id not supplied by client — auto-resolved to ${uniqueOrgIds[0]}`
    );
    return uniqueOrgIds[0];
  }

  if (uniqueOrgIds.length === 0) {
    throw new Error(
      "Could not determine organization automatically because no inventory parts have an org_id."
    );
  }

  throw new Error(
    "Multiple organizations were found, but the request did not provide org_id."
  );
}

/* ============================================================
   NON-INVENTORY DETECTION
============================================================ */

function isNonInventoryCharge(name) {
  const value = normalize(name);

  if (!value) return false;

  // Labor / labour
  if (/\blabou?r\b/i.test(value)) return true;

  // Hours
  if (/\bhours?\b/i.test(value)) return true;

  // hr / hrs
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
    /\bcall\s*-?\s*out\s+(?:fee|charge|rate)\b/i.test(value)
  ) {
    return true;
  }

  if (/\btravel\s+(?:fee|charge)\b/i.test(value)) {
    return true;
  }

  // Post-installation callback
  if (
    /\b(?:after-installation|post[- ]installation)\b.*\bcallback\b/i.test(
      value
    )
  ) {
    return true;
  }

  // Warranty service/labor charges
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
   SERVICEM8 $JOBMATERIAL BUNDLE HEADER
============================================================ */

function isBundleHeader(material) {
  const identifiers = [
    material?.item_code,
    material?.item_number,
    material?.code,
    material?.sku,
  ]
    .map(normalize)
    .filter(Boolean);

  /*
   * The actual ServiceM8 bundle header is encoded as:
   *
   * $JOBMATERIAL
   *
   * Do not treat an ordinary inventory item merely named
   * "Materials" as a bundle header.
   */

  if (
    identifiers.some(
      (value) =>
        value === "$jobmaterial" ||
        value === "jobmaterial"
    )
  ) {
    return true;
  }

  const name = normalize(material?.name);

  return (
    !material?.material_uuid &&
    name === "materials"
  );
}

/* ============================================================
   MATERIAL CATALOG RESOLUTION
============================================================ */

function getMaterialCode(material, catalogByUuid) {
  const catalog = material?.material_uuid
    ? catalogByUuid.get(material.material_uuid)
    : null;

  return String(
    material?.item_code ||
      material?.item_number ||
      material?.code ||
      material?.sku ||
      catalog?.code ||
      catalog?.item_code ||
      catalog?.item_number ||
      catalog?.sku ||
      ""
  ).trim();
}

function getMaterialName(material, catalogByUuid) {
  const catalog = material?.material_uuid
    ? catalogByUuid.get(material.material_uuid)
    : null;

  return String(
    material?.name ||
      catalog?.name ||
      catalog?.description ||
      "(unnamed)"
  ).trim();
}

function getMaterialCost(material, catalogByUuid) {
  const catalog = material?.material_uuid
    ? catalogByUuid.get(material.material_uuid)
    : null;

  return (
    Number(material?.cost) ||
    Number(catalog?.cost) ||
    0
  );
}

function getMaterialPrice(material, catalogByUuid) {
  const catalog = material?.material_uuid
    ? catalogByUuid.get(material.material_uuid)
    : null;

  return (
    Number(material?.price) ||
    Number(catalog?.price) ||
    0
  );
}

function materialQuantity(material) {
  return Number(
    material?.quantity ??
      material?.qty ??
      material?.quantity_used ??
      0
  );
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

  let admin;

  try {
    admin = supabaseAdmin();
  } catch {
    return NextResponse.json(
      {
        error:
          "Server isn't configured yet (missing Supabase service key).",
      },
      {
        status: 500,
      }
    );
  }

  let orgId;

  try {
    orgId = await resolveOrgId(request, body, admin);
  } catch (e) {
    return NextResponse.json(
      {
        error: e?.message || "Unable to determine organization.",
      },
      {
        status: 400,
      }
    );
  }

  console.log(`[sm8 sync] using org_id=${orgId}`);

  /* ==========================================================
     VERIFY ORGANIZATION
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
        error:
          `Could not verify organization: ${orgCheckError.message}`,
      },
      {
        status: 500,
      }
    );
  }

  if (!orgCheck?.org_id) {
    return NextResponse.json(
      {
        error:
          "The supplied organization does not have any inventory parts.",
        org_id: orgId,
      },
      {
        status: 400,
      }
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
        error:
          `Could not load ServiceM8 integration: ${integrationError.message}`,
      },
      {
        status: 500,
      }
    );
  }

  if (!integration?.connected) {
    return NextResponse.json(
      {
        error: "ServiceM8 isn't connected.",
      },
      {
        status: 400,
      }
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
      {
        status: 400,
      }
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
        error:
          `Could not load Main Warehouse: ${mainLocError.message}`,
      },
      {
        status: 500,
      }
    );
  }

  if (!mainLoc?.id) {
    return NextResponse.json(
      {
        error:
          "No Main Warehouse location found for this org — set one up before syncing.",
      },
      {
        status: 400,
      }
    );
  }

  /* ==========================================================
     FETCH SERVICEM8 JOBS / COMPANIES / MATERIAL CATALOG
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
  let sm8Catalog;

  try {
    /*
     * These functions all go through the ServiceM8 request
     * queue inside lib/servicem8.js.
     *
     * Promise.all here does NOT create an API burst because
     * sm8Fetch is globally paced.
     */
    [
      sm8Jobs,
      sm8Companies,
      sm8Catalog,
    ] = await Promise.all([
      fetchJobs(
        sm8Token,
        cutoffStr
      ),

      fetchCompanies(
        sm8Token
      ),

      fetchMaterialsCatalog(
        sm8Token
      ),
    ]);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e?.message ||
          "Unable to fetch ServiceM8 data.",
      },
      {
        status: 502,
      }
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

  /* ==========================================================
     COMPANY LOOKUP
  ========================================================== */

  const companyName = {};

  for (
    const company of sm8Companies || []
  ) {
    if (company?.uuid) {
      companyName[company.uuid] =
        company.name || "";
    }
  }

  /* ==========================================================
     MATERIAL CATALOG LOOKUP
  ========================================================== */

  const catalogByUuid = new Map();

  for (
    const material of sm8Catalog || []
  ) {
    if (material?.uuid) {
      catalogByUuid.set(
        material.uuid,
        material
      );
    }
  }

  /* ==========================================================
     FILTER JOBS
  ========================================================== */

  const relevantJobs =
    (sm8Jobs || []).filter(
      (job) => {
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
          companyName[
            job.company_uuid
          ] || ""
        )
          .trim()
          .toLowerCase();

        if (
          jobNo === "SAMPLE" ||
          client.includes(
            "help guide"
          )
        ) {
          return false;
        }

        return true;
      }
    );

  relevantJobs.sort(
    (a, b) =>
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
        error:
          `Could not load existing jobs: ${existingJobsError.message}`,
      },
      {
        status: 500,
      }
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
      Object.keys(
        jobIdByUuid
      )
    );

  let jobsCreated = 0;
  let jobsUpdated = 0;

  /* ==========================================================
     UPSERT JOBS
  ========================================================== */

  if (relevantJobs.length > 0) {
    const jobRows =
      relevantJobs.map(
        (job) => ({
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
            (
              job.date ||
              ""
            ).slice(0, 10) ||
            new Date()
              .toISOString()
              .slice(0, 10),

          location_id:
            mainLoc.id,

          servicem8_job_uuid:
            job.uuid,
        })
      );

    const {
      data: upserted,
      error: upsertErr,
    } = await admin.rpc(
      "upsert_synced_jobs",
      {
        p_jobs:
          jobRows,
      }
    );

    if (upsertErr) {
      return NextResponse.json(
        {
          error:
            `Job upsert failed: ${upsertErr.message}`,
        },
        {
          status: 500,
        }
      );
    }

    for (
      const row of upserted || []
    ) {
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

  const allJobUuids =
    relevantJobs
      .map(
        (job) => job.uuid
      )
      .filter(Boolean);

  /* ==========================================================
     LOAD CHECKPOINT
  ========================================================== */

  const {
    data: syncState,
    error: syncStateErr,
  } = await admin
    .from(
      "servicem8_sync_state"
    )
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
      {
        status: 500,
      }
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

  if (
    allJobUuids.length === 0
  ) {
    await admin
      .from(
        "servicem8_sync_state"
      )
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

      org_id: orgId,

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

  /* ==========================================================
     RESET CHECKPOINT WHEN JOB SET CHANGES
  ========================================================== */

  if (
    !syncState ||
    !sameJobSet
  ) {
    nextIndex = 0;

    const {
      error: checkpointErr,
    } = await admin
      .from(
        "servicem8_sync_state"
      )
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
        {
          status: 500,
        }
      );
    }

    console.log(
      `[sm8 sync] initialized new checkpoint with ${allJobUuids.length} jobs`
    );
  }

  /* ==========================================================
     CURRENT BATCH
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
     FETCH MATERIALS
  ========================================================== */

  let materialFetch;

  try {
    materialFetch =
      await fetchJobMaterialsForJobs(
        sm8Token,
        batchJobUuids,
        {
          concurrency:
            MATERIAL_FETCH_CONCURRENCY,

          timeBudgetMs:
            MATERIAL_FETCH_BUDGET_MS,
        }
      );
  } catch (e) {
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
          "Material sync stopped before processing. The checkpoint was not advanced.",
      },
      {
        status: 502,
      }
    );
  }

  const sm8Materials =
    materialFetch.materials ||
    [];

  const completedSet =
    new Set(
      materialFetch.completedJobUuids ||
        []
    );

  console.log(
    `[sm8 sync] fetched ${
      sm8Materials.length
    } material lines across ${
      materialFetch
        .completedJobUuids
        ?.length || 0
    }/${batchJobUuids.length} jobs — ${elapsed()}`
  );

  /* ==========================================================
     SAFE CHECKPOINT PREFIX
  ========================================================== */

  let completedPrefixCount = 0;

  while (
    completedPrefixCount <
      batchJobUuids.length &&
    completedSet.has(
      batchJobUuids[
        completedPrefixCount
      ]
    )
  ) {
    completedPrefixCount++;
  }

  const safeBatchEnd =
    batchStart +
    completedPrefixCount;

  /* ==========================================================
     LOAD PARTS
  ========================================================== */

  const {
    data: parts,
    error: partsError,
  } = await admin
    .from("parts")
    .select(
      "id, sku, part_no, unit_cost"
    )
    .eq(
      "org_id",
      orgId
    );

  if (partsError) {
    return NextResponse.json(
      {
        error:
          `Could not load inventory parts: ${partsError.message}`,
      },
      {
        status: 500,
      }
    );
  }

  const partByKey = {};

  for (
    const part of parts || []
  ) {
    if (part.sku) {
      partByKey[
        normalize(part.sku)
      ] = part;
    }

    if (part.part_no) {
      partByKey[
        normalize(part.part_no)
      ] = part;
    }
  }

  /* ==========================================================
     EXISTING MATERIAL UUIDS
  ========================================================== */

  const {
    data: alreadySyncedLines,
    error: alreadySyncedError,
  } = await admin
    .from(
      "job_line_items"
    )
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
      {
        status: 500,
      }
    );
  }

  const syncedUuids =
    new Set(
      (
        alreadySyncedLines ||
        []
      )
        .map(
          (line) =>
            line.servicem8_material_uuid
        )
        .filter(Boolean)
    );

  /* ==========================================================
     EXISTING FLAGGED MATERIAL UUIDS
  ========================================================== */

  const {
    data: alreadyFlagged,
    error: alreadyFlaggedError,
  } = await admin
    .from(
      "unmatched_materials"
    )
    .select(
      "servicem8_material_uuid"
    )
    .not(
      "servicem8_material_uuid",
      "is",
      null
    );

  if (alreadyFlaggedError) {
    return NextResponse.json(
      {
        error:
          `Could not load unmatched materials: ${alreadyFlaggedError.message}`,
      },
      {
        status: 500,
      }
    );
  }

  const flaggedUuids =
    new Set(
      (
        alreadyFlagged ||
        []
      )
        .map(
          (row) =>
            row.servicem8_material_uuid
        )
        .filter(Boolean)
    );

  /* ==========================================================
     MATERIAL PROCESSING COUNTERS
  ========================================================== */

  let materialsDeducted = 0;

  let materialsFlagged = 0;

  let materialsSkippedNoJob = 0;

  let materialsSkippedNoQty = 0;

  let materialsSkippedNonInventory = 0;

  let materialsSkippedBundleHeader = 0;

  const materialPayload = [];

  /* ==========================================================
     PROCESS SERVICEM8 MATERIAL LINES
  ========================================================== */

  for (
    const material of
      sm8Materials
  ) {
    if (!material?.uuid) {
      continue;
    }

    /*
     * $JOBMATERIAL is the ServiceM8 bundle HEADER.
     *
     * It is not inventory.
     *
     * The CHILDREN underneath it are the actual
     * physical materials that need matching/deduction.
     */

    if (
      isBundleHeader(material)
    ) {
      materialsSkippedBundleHeader++;

      console.log(
        `[sm8 sync] BUNDLE HEADER — skipped: ${
          material.name ||
          material.item_code ||
          material.item_number ||
          "$JOBMATERIAL"
        }`
      );

      continue;
    }

    const materialName =
      getMaterialName(
        material,
        catalogByUuid
      );

    const materialCode =
      getMaterialCode(
        material,
        catalogByUuid
      );

    /*
     * Labor / service charges NEVER enter
     * the inventory matching system.
     */

    if (
      isNonInventoryCharge(
        materialName
      ) ||
      isNonInventoryCharge(
        materialCode
      )
    ) {
      materialsSkippedNonInventory++;

      console.log(
        `[sm8 sync] NON-INVENTORY — skipped: ${materialName}${
          materialCode
            ? ` [${materialCode}]`
            : ""
        }`
      );

      continue;
    }

    /*
     * Prevent duplicate processing.
     */

    if (
      syncedUuids.has(
        material.uuid
      ) ||
      flaggedUuids.has(
        material.uuid
      )
    ) {
      continue;
    }

    const jobId =
      jobIdByUuid[
        material.job_uuid
      ];

    if (!jobId) {
      materialsSkippedNoJob++;
      continue;
    }

    const qty =
      materialQuantity(
        material
      );

    if (!qty) {
      materialsSkippedNoQty++;
      continue;
    }

    /*
     * IMPORTANT BUNDLE MATCHING:
     *
     * First try the ServiceM8 catalog code.
     *
     * Example:
     *
     * ServiceM8 name:
     * TYWRAP 8 BLACK WITH MOUNTING HOLE
     *
     * ServiceM8 catalog code:
     * TYWRAP8MOUNTBLK
     *
     * SDR part:
     * TYWRAP8MOUNTBLK
     *
     * That means we can match the physical item
     * even though the human-readable names differ.
     */

    const match =
      partByKey[
        normalize(
          materialCode
        )
      ] ||
      partByKey[
        normalize(
          materialName
        )
      ] ||
      null;

    materialPayload.push({
      job_id: jobId,

      part_id:
        match
          ? match.id
          : null,

      servicem8_material_uuid:
        material.uuid,

      raw_name:
        materialCode
          ? `${materialCode} — ${materialName}`
          : materialName,

      qty,

      unit_cost:
        getMaterialCost(
          material,
          catalogByUuid
        ) ||
        (
          match
            ? Number(
                match.unit_cost
              )
            : 0
        ) ||
        0,

      sale_cost:
        getMaterialPrice(
          material,
          catalogByUuid
        ),
    });
  }

  /* ==========================================================
     PROCESS INVENTORY
  ========================================================== */

  if (
    materialPayload.length >
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
            materialPayload,
        }
      )
      .single();

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
        {
          status: 500,
        }
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
     SAFE CHECKPOINT UPDATE
  ========================================================== */

  const newNextIndex =
    safeBatchEnd;

  const syncComplete =
    newNextIndex >=
    allJobUuids.length;

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

      /*
       * CRITICAL:
       *
       * Only advance through jobs whose material
       * fetch actually completed.
       */

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

    return NextResponse.json({
      ok: true,

      syncComplete: false,

      warning:
        "Materials were processed, but the sync checkpoint could not be saved. Existing material UUID protection will prevent duplicate processing.",

      org_id: orgId,

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
    });
  }

  /* ==========================================================
     MARK INTEGRATION COMPLETE
  ========================================================== */

  if (syncComplete) {
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
  }

  /* ==========================================================
     ACTIVITY LOG
  ========================================================== */

  await admin
    .from("activity_log")
    .insert({
      org_id: orgId,

      message:
        syncComplete
          ? `Completed ServiceM8 material sync: ${jobsCreated} new job(s), ${jobsUpdated} updated, ${materialsDeducted} physical material(s) deducted, ${materialsFlagged} physical material(s) flagged for review, ${materialsSkippedNonInventory} labor/service charge(s) excluded, ${materialsSkippedBundleHeader} bundle header(s) excluded.`
          : `ServiceM8 sync progress: processed ${completedPrefixCount} contiguous job(s) from batch ${batchStart + 1}-${batchEnd}; ${materialsDeducted} physical material(s) deducted, ${materialsFlagged} flagged, ${materialsSkippedNonInventory} labor/service charge(s) excluded, ${materialsSkippedBundleHeader} bundle header(s) excluded.`,
    });

  /* ==========================================================
     RESPONSE
  ========================================================== */

  return NextResponse.json({
    ok: true,

    syncComplete,

    org_id: orgId,

    jobsCreated,
    jobsUpdated,

    materialsDeducted,
    materialsFlagged,

    checkpoint: {
      processedFrom:
        batchStart + 1,

      processedTo:
        safeBatchEnd,

      attemptedTo:
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
        : completedPrefixCount <
          batchJobUuids.length
        ? `Processed ${completedPrefixCount} job(s) safely. Some ServiceM8 material requests failed or hit the time budget; click Sync again to retry the remaining jobs.`
        : `Processed jobs ${batchStart + 1}-${batchEnd} of ${allJobUuids.length}. Click Sync again to continue.`,

    diagnostics: {
      totalMaterialsSeen:
        sm8Materials.length,

      materialJobsCompleted:
        materialFetch
          .completedJobUuids
          ?.length || 0,

      materialJobsFailed:
        materialFetch
          .failedJobs
          ?.length || 0,

      materialsSkippedNoJob,

      materialsSkippedNoQty,

      materialsSkippedNonInventory,

      materialsSkippedBundleHeader,

      candidateInventoryMaterials:
        materialPayload.length,

      batchSize:
        JOB_BATCH_SIZE,

      materialConcurrency:
        MATERIAL_FETCH_CONCURRENCY,

      elapsed:
        elapsed(),

      failedMaterialJobs:
        materialFetch.failedJobs ||
        [],

      sampleRawMaterials:
        sm8Materials.slice(
          0,
          3
        ),
    },
  });
}