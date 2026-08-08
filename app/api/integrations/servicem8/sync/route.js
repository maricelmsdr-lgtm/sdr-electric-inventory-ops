import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidAccessToken, fetchJobs, fetchJobMaterialsForJobs, fetchCompanies, fetchMaterialsCatalog } from "@/lib/servicem8";

// Retrying through a rate limit can take a while (see sm8Fetch's backoff),
// so give this route more room than the default 10s.
export const maxDuration = 60;

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

// ServiceM8 sends labor, travel, and service-call charges through the same
// jobmaterial endpoint as real parts. These aren't inventory — matching them
// against the parts catalog would either wrongly deduct a real part's stock
// (false positive) or just pile up as permanent "no match" noise in Needs
// Review (since there's no part named "Technician Labour After Hours").
// Skipped entirely, not flagged — there's nothing here to review.
function isNonInventoryCharge(name) {
  const value = normalize(name);
  if (!value) return false;

  if (/\blabou?r\b/i.test(value)) return true;
  if (/\bhours?\b/i.test(value)) return true;
  if (/\b(?:\d+(?:\.\d+)?\s*)?hrs?\b/i.test(value)) return true;
  if (/\bafter\s+hours?\b/i.test(value)) return true;
  if (/\btechnician\b.*\b(?:apprentice|hours?|hrs?|hr)\b/i.test(value)) return true;
  if (/\bapprentice\b.*\b(?:technician|hours?|hrs?|hr)\b/i.test(value)) return true;
  if (/\bservice\s+call\s+fee\b/i.test(value)) return true;
  if (/\bservice\s+fee\b/i.test(value)) return true;
  if (/\bservice\s+rate\b/i.test(value)) return true;
  if (/\bservice\s+charge\b/i.test(value)) return true;
  if (/\btruck\s+charge\b/i.test(value)) return true;
  if (/\bcall\s*-?\s*out\s+(?:fee|charge|rate)\b/i.test(value)) return true;
  if (/\btravel\s+(?:fee|charge)\b/i.test(value)) return true;
  if (/\b(?:after[- ]installation|post[- ]installation)\b.*\bcallback\b/i.test(value)) return true;
  if (/\bwarranty\b/i.test(value) && /\b(?:service|callback|labor|labour|charge|fee)\b/i.test(value)) return true;

  return false;
}

// ServiceM8 represents a "Job Material Bundle" (e.g. one invoice line like
// "$JOBMATERIAL — Materials 8 inch black nylon cable ties and wire spice
// kit") as several separate jobmaterial rows: one HEADER row (the bundle
// itself — not physical inventory) plus several CHILD rows underneath it
// (the actual parts, e.g. TYWRAP8MOUNTBLK, HSK4 — these ARE inventory).
// Every child's job_material_bundle_uuid points at the header's own uuid.
// So: collect every job_material_bundle_uuid value seen across the batch,
// then any material whose OWN uuid appears in that set is a header — skip
// it entirely (it's just a rollup label, not a real deduction).
function isBundleHeader(material, bundleHeaderUuids) {
  if (!material?.uuid) return false;
  if (bundleHeaderUuids.has(String(material.uuid))) return true;
  const name = normalize(material.name);
  return name === "$jobmaterial" || name === "jobmaterial" || name === "materials";
}

// Catches cases like "SUBMERSIBLE 4-WIRE CLEAR HEAT SHRINK SPLICE KIT
// HSKC-4" where the real part number/SKU is embedded at the end of an
// otherwise-descriptive name — pulls out hyphen/underscore/slash-joined
// alphanumeric tokens as match candidates.
function extractCodeTokens(text) {
  const matches = String(text ?? "").match(/\b[A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+)+\b/g);
  return matches || [];
}

export async function POST(request) {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  const { access_token } = await request.json().catch(() => ({}));
  if (!access_token) {
    return NextResponse.json({ error: "Missing session." }, { status: 401 });
  }

  let admin;
  try {
    admin = supabaseAdmin();
  } catch {
    return NextResponse.json({ error: "Server isn't configured yet (missing Supabase service key)." }, { status: 500 });
  }

  const { data: userData, error: userErr } = await admin.auth.getUser(access_token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", userData.user.id)
    .single();
  if (!profile?.org_id) {
    return NextResponse.json({ error: "No organization found." }, { status: 400 });
  }

  const { data: integration } = await admin
    .from("integrations")
    .select("id, connected")
    .eq("org_id", profile.org_id)
    .eq("provider", "servicem8")
    .single();
  if (!integration?.connected) {
    return NextResponse.json({ error: "ServiceM8 isn't connected." }, { status: 400 });
  }

  let sm8Token;
  try {
    sm8Token = await getValidAccessToken(admin, integration.id);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const { data: mainLoc } = await admin
    .from("locations")
    .select("id")
    .eq("org_id", profile.org_id)
    .eq("code", "MAIN")
    .single();
  if (!mainLoc?.id) {
    return NextResponse.json({ error: "No Main Warehouse location found for this org — set one up before syncing." }, { status: 400 });
  }

  // Only pull recent/active work — not the company's entire ServiceM8
  // history. Materials from a job finished years ago aren't relevant to
  // today's stock levels, and pulling everything makes each sync slow
  // and easy to exceed the function's time limit.
  const SYNC_WINDOW_DAYS = 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SYNC_WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let sm8Jobs, sm8Companies;
  try {
    [sm8Jobs, sm8Companies] = await Promise.all([fetchJobs(sm8Token, cutoffStr), fetchCompanies(sm8Token)]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
  console.log(`[sm8 sync] fetched ${sm8Jobs?.length ?? 0} jobs, ${sm8Companies?.length ?? 0} companies — ${elapsed()}`);

  const companyName = {};
  for (const c of sm8Companies || []) companyName[c.uuid] = c.name;

  // Skip quotes and cancelled jobs — only pull real work. Note: we don't
  // filter on ServiceM8's "active" flag — it goes to 0 once a job is marked
  // Completed, which is exactly the job state we most want to sync (that's
  // when materials used are finalized).
  //
  // Also skip ServiceM8's own built-in "SAMPLE · Help Guide Job" — every new
  // ServiceM8 account gets one automatically, with placeholder tooltip text
  // as fake material line items ("click produce invoice to...", etc). It's
  // not real customer work, so it shouldn't show up in Jobs or generate
  // "Needs Review" noise on every sync.
  const relevantJobs = (sm8Jobs || []).filter((j) => {
    if (!j.uuid || !j.status || j.status === "Quote" || j.status === "Cancelled") return false;
    const jobNo = (j.generated_job_id || "").trim().toUpperCase();
    const client = (companyName[j.company_uuid] || "").trim().toLowerCase();
    if (jobNo === "SAMPLE" || client.includes("help guide")) return false;
    return true;
  });

  const { data: existingJobs } = await admin
    .from("jobs")
    .select("id, servicem8_job_uuid")
    .eq("org_id", profile.org_id)
    .not("servicem8_job_uuid", "is", null);
  const jobIdByUuid = Object.fromEntries((existingJobs || []).map((j) => [j.servicem8_job_uuid, j.id]));
  const preExistingUuids = new Set(Object.keys(jobIdByUuid));

  // Upsert every job in ONE call instead of one HTTP round trip per job —
  // with a few hundred jobs in a 90-day window, that per-row approach was
  // most of what blew past Vercel's 60s limit. See supabase/007_bulk_sync_functions.sql.
  let jobsCreated = 0;
  let jobsUpdated = 0;
  if (relevantJobs.length > 0) {
    const jobRows = relevantJobs.map((j) => ({
      org_id: profile.org_id,
      job_no: j.generated_job_id || j.uuid,
      client: companyName[j.company_uuid] || "Unknown client",
      address: j.job_address || null,
      job_date: (j.date || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      location_id: mainLoc.id,
      servicem8_job_uuid: j.uuid,
    }));
    const { data: upserted, error: upsertErr } = await admin.rpc("upsert_synced_jobs", { p_jobs: jobRows });
    if (upsertErr) {
      return NextResponse.json({ error: `Job upsert failed: ${upsertErr.message}` }, { status: 500 });
    }
    for (const row of upserted || []) {
      jobIdByUuid[row.servicem8_job_uuid] = row.id;
      if (preExistingUuids.has(row.servicem8_job_uuid)) jobsUpdated++;
      else jobsCreated++;
    }
  }
  console.log(`[sm8 sync] upserted ${relevantJobs.length} jobs (${jobsCreated} new, ${jobsUpdated} updated) — ${elapsed()}`);

  // Fetch materials per job (ServiceM8 requires the $filter=job_uuid query —
  // an unfiltered bulk call doesn't reliably return everything). Done in
  // small concurrent batches (see fetchJobMaterialsForJobs) to stay under
  // ServiceM8's per-minute rate limit while still finishing well inside the
  // route's time limit.
  let sm8Materials = [];
  try {
    sm8Materials = await fetchJobMaterialsForJobs(sm8Token, Object.keys(jobIdByUuid));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
  console.log(`[sm8 sync] fetched ${sm8Materials.length} material lines across ${Object.keys(jobIdByUuid).length} jobs — ${elapsed()}`);

  // Bundle headers ("$JOBMATERIAL" rollup rows) aren't physical inventory —
  // see isBundleHeader's comment. Build the header-uuid set once for the
  // whole batch.
  const bundleHeaderUuids = new Set(
    (sm8Materials || []).map((m) => m?.job_material_bundle_uuid).filter(Boolean).map(String)
  );

  // Materials catalog fetch: ServiceM8 keeps the real item code (e.g.
  // "TYWRAP8MOUNTBLK") separate from the jobmaterial line's human-readable
  // name ("TYWRAP 8 BLACK WITH MOUNTING HOLE") — the code lives in a
  // separate catalog record referenced by material_uuid. Requires the
  // read_inventory scope; if an org connected before that scope was added,
  // this 403s and we fall back to name-only matching instead of failing
  // the whole sync.
  let sm8MaterialsCatalog = [];
  let catalogAvailable = true;
  try {
    sm8MaterialsCatalog = await fetchMaterialsCatalog(sm8Token);
  } catch (e) {
    catalogAvailable = false;
    console.log(`[sm8 sync] materials catalog unavailable (probably needs reconnect for read_inventory scope): ${e.message}`);
  }
  const catalogByUuid = {};
  for (const c of sm8MaterialsCatalog || []) catalogByUuid[c.uuid] = c;
  console.log(`[sm8 sync] materials catalog: ${sm8MaterialsCatalog.length} items, available=${catalogAvailable}`);

  const { data: parts } = await admin
    .from("parts")
    .select("id, sku, part_no, unit_cost")
    .eq("org_id", profile.org_id);
  const partByKey = {};
  const partsById = {};
  for (const p of parts || []) {
    partsById[p.id] = p;
    if (p.sku) partByKey[normalize(p.sku)] = p;
    if (p.part_no) partByKey[normalize(p.part_no)] = p;
  }

  // Aliases learned from manual "Needs Review" resolutions (see
  // resolveUnmatched in app/integrations/page.js) — once someone points
  // "TYWRAP 8 BLACK WITH MOUNTING HOLE" at TYWRAP8MOUNTBLK one time, every
  // future occurrence of that exact ServiceM8 name auto-matches without
  // needing the catalog fetch or manual review again.
  const { data: aliases } = await admin
    .from("part_aliases")
    .select("alias_name, part_id")
    .eq("org_id", profile.org_id);
  const partByAlias = {};
  for (const a of aliases || []) {
    const p = partsById[a.part_id];
    if (p) partByAlias[normalize(a.alias_name)] = p;
  }
  console.log(`[sm8 sync] loaded ${aliases?.length ?? 0} learned part aliases`);

  const { data: alreadySyncedLines } = await admin
    .from("job_line_items")
    .select("servicem8_material_uuid")
    .not("servicem8_material_uuid", "is", null);
  const syncedUuids = new Set((alreadySyncedLines || []).map((l) => l.servicem8_material_uuid));

  const { data: alreadyFlagged } = await admin.from("unmatched_materials").select("servicem8_material_uuid");
  const flaggedUuids = new Set((alreadyFlagged || []).map((f) => f.servicem8_material_uuid));

  // Match materials to the parts catalog, then hand the whole resolved
  // batch to Postgres in ONE call instead of one HTTP round trip per line.
  // Match order (first hit wins):
  //   1. Learned alias (exact name seen before, manually resolved once)
  //   2. ServiceM8 catalog item code (via material_uuid → material.json)
  //   3. Direct name/SKU/part_no match
  //   4. A code-shaped token embedded in the name (e.g. "HSKC-4" inside
  //      "SUBMERSIBLE 4-WIRE CLEAR HEAT SHRINK SPLICE KIT HSKC-4")
  let materialsDeducted = 0;
  let materialsFlagged = 0;
  let materialsSkippedNoJob = 0;
  let materialsSkippedNoQty = 0;
  let materialsSkippedBundleHeader = 0;
  let materialsSkippedNonInventory = 0;
  const totalMaterialsSeen = (sm8Materials || []).length;
  const matchMethodCounts = {};

  const candidateMaterials = (sm8Materials || []).filter((m) => {
    if (!m.uuid || syncedUuids.has(m.uuid) || flaggedUuids.has(m.uuid)) return false;
    if (isBundleHeader(m, bundleHeaderUuids)) { materialsSkippedBundleHeader++; return false; }
    if (isNonInventoryCharge(m.name)) { materialsSkippedNonInventory++; return false; }
    return true;
  });

  const materialPayload = [];
  for (const m of candidateMaterials) {
    const jobId = jobIdByUuid[m.job_uuid];
    if (!jobId) { materialsSkippedNoJob++; continue; } // material belongs to a job we didn't pull (quote/cancelled)

    const qty = Number(m.quantity ?? m.qty ?? 0);
    if (!qty) { materialsSkippedNoQty++; continue; }

    const nameKey = normalize(m.name);
    let match = null;
    let method = null;

    if (nameKey && partByAlias[nameKey]) {
      match = partByAlias[nameKey];
      method = "alias";
    }

    if (!match) {
      const catalogItem = catalogByUuid[m.material_uuid];
      const catalogCode = normalize(catalogItem?.code || catalogItem?.item_number || catalogItem?.sku || catalogItem?.field1 || "");
      if (catalogCode && partByKey[catalogCode]) {
        match = partByKey[catalogCode];
        method = "catalog_code";
      }
    }

    if (!match && nameKey && partByKey[nameKey]) {
      match = partByKey[nameKey];
      method = "name";
    }

    if (!match) {
      for (const token of extractCodeTokens(m.name)) {
        const key = normalize(token);
        if (partByKey[key]) { match = partByKey[key]; method = "embedded_code"; break; }
      }
    }

    if (method) matchMethodCounts[method] = (matchMethodCounts[method] || 0) + 1;

    materialPayload.push({
      job_id: jobId,
      part_id: match ? match.id : null,
      servicem8_material_uuid: m.uuid,
      raw_name: m.name || "(unnamed)",
      qty,
      unit_cost: Number(m.cost) || (match ? match.unit_cost : 0) || 0,
      sale_cost: Number(m.price) || 0,
    });
  }

  if (materialPayload.length > 0) {
    const { data: result, error: processErr } = await admin
      .rpc("process_synced_materials", {
        p_org_id: profile.org_id,
        p_location_id: mainLoc.id,
        p_materials: materialPayload,
      })
      .single();
    if (processErr) {
      return NextResponse.json({ error: `Material processing failed: ${processErr.message}` }, { status: 500 });
    }
    materialsDeducted = result?.deducted_count || 0;
    materialsFlagged = result?.flagged_count || 0;
  }

  console.log(
    `[sm8 sync] processed ${materialPayload.length} material lines (${materialsDeducted} deducted, ${materialsFlagged} flagged) — ` +
    `matched by: ${JSON.stringify(matchMethodCounts)} — skipped: ${materialsSkippedBundleHeader} bundle header(s), ${materialsSkippedNonInventory} non-inventory — ${elapsed()}`
  );

  await admin.from("integrations").update({ last_synced_at: new Date().toISOString() }).eq("id", integration.id);
  await admin.from("activity_log").insert({
    org_id: profile.org_id,
    user_id: userData.user.id,
    message: `Synced ServiceM8: ${jobsCreated} new job(s), ${jobsUpdated} updated, ${materialsDeducted} material(s) deducted, ${materialsFlagged} flagged for review.`,
  });

  return NextResponse.json({
    ok: true,
    jobsCreated,
    jobsUpdated,
    materialsDeducted,
    materialsFlagged,
    diagnostics: {
      totalMaterialsSeen,
      materialsSkippedNoJob,
      materialsSkippedNoQty,
      materialsSkippedBundleHeader,
      materialsSkippedNonInventory,
      matchMethodCounts,
      catalogAvailable,
    },
  });
}
