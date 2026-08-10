import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidAccessToken, fetchJobs, fetchJobMaterialsForJobs, fetchCompanies, fetchMaterialsCatalog } from "@/lib/servicem8";

// Retrying through a rate limit can take a while (see sm8Fetch's backoff),// so give this route more room than the default 10s.
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

// ServiceM8 sends labor, travel, and service-call charges through the same// jobmaterial endpoint as real parts. These aren't inventory â€” matching them
// against the parts catalog would either wrongly deduct a real part's stock
// (false positive) or just pile up as permanent "no match" noise in Needs
// Review (since there's no part named "Technician Labour After Hours").
// Skipped entirely, not flagged â€” there's nothing here to review.
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

// ServiceM8 represents a "Job Material Bundle" (e.g. one invoice line like// "$JOBMATERIAL â€” Materials 8 inch black nylon cable ties and wire spice// kit") as several separate jobmaterial rows: one HEADER row (the bundle
// itself â€” not physical inventory) plus several CHILD rows underneath it// (the actual parts, e.g. TYWRAP8MOUNTBLK, HSK4 â€” these ARE inventory).
// Every child's job_material_bundle_uuid points at the header's own uuid.
// So: collect every job_material_bundle_uuid value seen across the batch,
// then any material whose OWN uuid appears in that set is a header â€” skip
// it entirely (it's just a rollup label, not a real deduction).
function isBundleHeader(material, bundleHeaderUuids) {
  if (!material?.uuid) return false;
  if (bundleHeaderUuids.has(String(material.uuid))) return true;
  const name = normalize(material.name);
  if (name === "$jobmaterial" || name === "jobmaterial" || name === "materials") return true;
  // Fallback for cases where the structural link isn't available this run
  // (e.g. the bundle's children weren't in this batch) â€” ServiceM8 marks  // these rollup/placeholder rows inactive (active: 0) even standalone,
  // distinct from a real material that's just out of stock or deleted for
  // an unrelated reason. A generic name like "Project based Materials"
  // combined with active: 0 is the same "this isn't a real part" signal.
  if (Number(material.active) === 0 && /materials?$/i.test(name)) return true;
  return false;
}

// Catches cases like "SUBMERSIBLE 4-WIRE CLEAR HEAT SHRINK SPLICE KIT
// HSKC-4" where the real part number/SKU is embedded at the end of an
// otherwise-descriptive name. Two passes: first the confident one
// (hyphen/underscore/slash-joined tokens like "HSKC-4" or "F/UVMAX" â€”
// that punctuation is a strong signal it's a code, not English prose),
// then a looser fallback (a single run of 5+ letters-and-digits mixed,
// like "114X8CPEXTTUBESJN") tried only if nothing from the first pass
// matched a real part â€” mixed letters+digits of that length essentially
// never occurs in ordinary description text, so it's safe as a last resort.
function extractCodeTokens(text) {
  const value = String(text ?? "");
  const punctuated = value.match(/\b[A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+)+\b/g) || [];
  const looseCandidates = value.match(/\b[A-Za-z0-9]{5,}\b/g) || [];
  const loose = looseCandidates.filter((t) => /[A-Za-z]/.test(t) && /[0-9]/.test(t));
  return [...punctuated, ...loose];
}

export async function POST(request) {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  const { access_token, start_date, end_date } = await request.json().catch(() => ({}));
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
    return NextResponse.json({ error: "No Main Warehouse location found for this org â€” set one up before syncing." }, { status: 400 });
  }

  // Date range now comes from the UI's date-range picker instead of a
  // fixed lookback â€” capped at 30 days per request so a single sync can't
  // pull in a huge batch and blow past the route's time limit. Falls back
  // to "last 30 days" if the caller doesn't supply one (defensive only â€”  // the UI always sends both dates via the picker modal).
  let cutoffStr, endStr;
  if (start_date || end_date) {
    const start = start_date ? new Date(start_date) : null;
    const end = end_date ? new Date(end_date) : null;
    if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid start or end date." }, { status: 400 });
    }
    if (start > end) {
      return NextResponse.json({ error: "Start date must be before end date." }, { status: 400 });
    }
    const rangeDays = (end - start) / (1000 * 60 * 60 * 24);
    if (rangeDays > 30) {
      return NextResponse.json({ error: "Date range can't be more than 30 days." }, { status: 400 });
    }
    cutoffStr = start.toISOString().slice(0, 10);
    endStr = end.toISOString().slice(0, 10);
  } else {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    cutoffStr = cutoff.toISOString().slice(0, 10);
    endStr = new Date().toISOString().slice(0, 10);
  }

  let sm8Jobs, sm8Companies;
  try {
    [sm8Jobs, sm8Companies] = await Promise.all([fetchJobs(sm8Token, cutoffStr), fetchCompanies(sm8Token)]);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
  // fetchJobs only supports a lower bound (ServiceM8's filter API only
  // offers `gt`), so the upper bound of the range is applied here instead.  sm8Jobs = (sm8Jobs || []).filter((j) => !j.date || j.date.slice(0, 10) <= endStr);
  console.log(`[sm8 sync] fetched ${sm8Jobs?.length ?? 0} jobs, ${sm8Companies?.length ?? 0} companies â€” ${elapsed()}`);

  const companyName = {};
  for (const c of sm8Companies || []) companyName[c.uuid] = c.name;

  // Skip quotes and cancelled jobs â€” only pull real work. Note: we don't  // filter on ServiceM8's "active" flag â€” it goes to 0 once a job is marked
  // Completed, which is exactly the job state we most want to sync (that's  // when materials used are finalized).
  //
  // Also skip ServiceM8's own built-in "SAMPLE Â· Help Guide Job" â€” every new
  // ServiceM8 account gets one automatically, with placeholder tooltip text
  // as fake material line items ("click produce invoice to...", etc). It's  // not real customer work, so it shouldn't show up in Jobs or generate
  // "Needs Review" noise on every sync.
  // BUGFIX-002: a job deleted from SDR leaves no trace of its
  // servicem8_job_uuid in `jobs` (cascade delete), so without this
  // exclusion it looks identical to a job ServiceM8 has never sent
  // before â€” the sync would re-import it and re-deduct every material
  // on it. See supabase/010_prevent_resync_of_deleted_jobs.sql.
  const { data: deletedTombstones } = await admin
    .from("servicem8_deleted_jobs")
    .select("servicem8_job_uuid")
    .eq("org_id", profile.org_id);
  const deletedUuids = new Set((deletedTombstones || []).map((t) => t.servicem8_job_uuid));

  const relevantJobs = (sm8Jobs || []).filter((j) => {
    if (!j.uuid || !j.status || j.status === "Quote" || j.status === "Cancelled") return false;
    if (deletedUuids.has(j.uuid)) return false;
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

  // Upsert every job in ONE call instead of one HTTP round trip per job â€”
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
  console.log(`[sm8 sync] upserted ${relevantJobs.length} jobs (${jobsCreated} new, ${jobsUpdated} updated) â€” ${elapsed()}`);

  // Fetch materials per job (ServiceM8 requires the $filter=job_uuid query â€”
  // an unfiltered bulk call doesn't reliably return everything), and the
  // materials catalog, CONCURRENTLY â€” they're independent ServiceM8 calls,
  // and running the catalog fetch after materials used to just add its
  // duration on top sequentially. deadlineMs is measured from the route's
  // own start (t0), not from when this call begins, so it accounts for
  // time already spent on setup/job-upsert and leaves room for the catalog  // fetch and the final bulk write below â€” 38s here, out of the route's
  // 60s hard cap, leaves ~22s for everything else.
  const materialsDeadline = t0 + 38_000;
  const [materialsResult, catalogResult] = await Promise.allSettled([
    fetchJobMaterialsForJobs(sm8Token, Object.keys(jobIdByUuid), materialsDeadline),
    fetchMaterialsCatalog(sm8Token),
  ]);

  if (materialsResult.status === "rejected") {
    return NextResponse.json({ error: materialsResult.reason?.message || "Materials fetch failed." }, { status: 502 });
  }
  const sm8Materials = materialsResult.value;
  console.log(`[sm8 sync] fetched ${sm8Materials.length} material lines across ${Object.keys(jobIdByUuid).length} jobs â€” ${elapsed()}`);

  // Bundle headers ("$JOBMATERIAL" rollup rows) aren't physical inventory â€”
  // see isBundleHeader's comment. Build the header-uuid set once for the
  // whole batch.
  const bundleHeaderUuids = new Set(
    (sm8Materials || []).map((m) => m?.job_material_bundle_uuid).filter(Boolean).map(String)
  );

  // Materials catalog: ServiceM8 keeps the real item code (e.g.
  // "TYWRAP8MOUNTBLK") separate from the jobmaterial line's human-readable  // name ("TYWRAP 8 BLACK WITH MOUNTING HOLE") â€” the code lives in a
  // separate catalog record referenced by material_uuid. Requires the
  // read_inventory scope; if an org connected before that scope was added,  // this 403s and we fall back to name-only matching instead of failing
  // the whole sync.
  const catalogAvailable = catalogResult.status === "fulfilled";
  const sm8MaterialsCatalog = catalogAvailable ? catalogResult.value : [];
  if (!catalogAvailable) {
    console.log(`[sm8 sync] materials catalog unavailable (probably needs reconnect for read_inventory scope): ${catalogResult.reason?.message}`);
  }
  const catalogByUuid = {};
  for (const c of sm8MaterialsCatalog || []) catalogByUuid[c.uuid] = c;
  console.log(`[sm8 sync] materials catalog: ${sm8MaterialsCatalog.length} items, available=${catalogAvailable} â€” ${elapsed()}`);

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
  // resolveUnmatched in app/integrations/page.js) â€” once someone points
  // "TYWRAP 8 BLACK WITH MOUNTING HOLE" at TYWRAP8MOUNTBLK one time, every  // future occurrence of that exact ServiceM8 name auto-matches without
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

  // NOTE: previously this route also loaded `alreadySyncedLines` (every
  // job_line_items row with a servicem8_material_uuid already set) and
  // used it to drop any material we'd already synced once before. That
  // meant a line whose ServiceM8 qty changed after the first sync (e.g.
  // 2 -> 5) was silently ignored forever -- nothing extra ever got
  // deducted. Diff-based deduction (010_diff_based_material_deduction.sql)
  // now handles that INSIDE process_synced_materials: it looks up any
  // existing job_line_items row for the same servicem8_material_uuid,
  // deducts only the qty difference, and updates the stored qty. So we
  // deliberately no longer filter out already-synced uuids here --  // every material line ServiceM8 currently reports gets sent through, and
  // the database decides whether there's anything new to deduct.

  // Only a FINAL human decision (resolved or explicitly ignored) permanently
  // excludes a material. A "pending" Needs Review flag does NOT â€” matching
  // has kept improving (aliases, catalog-code lookup, bundle/non-inventory  // filtering all landed after some materials were already flagged), so
  // pending items get retried against the current matching logic on every
  // sync instead of being stuck forever with whatever the matcher could do  // the first time it saw them. process_synced_materials upserts rather
  // than blind-inserts, so a retry that still fails doesn't create a
  // duplicate row â€” it just updates the existing pending one.
  const { data: alreadyDecided } = await admin
    .from("unmatched_materials")
    .select("servicem8_material_uuid")
    .in("status", ["resolved", "ignored"]);
  const decidedUuids = new Set((alreadyDecided || []).map((f) => f.servicem8_material_uuid));

  // Match materials to the parts catalog, then hand the whole resolved
  // batch to Postgres in ONE call instead of one HTTP round trip per line.  // Match order (first hit wins):
  //   1. Learned alias (exact name seen before, manually resolved once)
  //   2. ServiceM8 catalog item code (via material_uuid â†’ material.json)  //   3. Direct name/SKU/part_no match
  //   4. A code-shaped token embedded in the name (e.g. "HSKC-4" inside
  //      "SUBMERSIBLE 4-WIRE CLEAR HEAT SHRINK SPLICE KIT HSKC-4")
  let materialsDeducted = 0;
  let materialsFlagged = 0;
  let materialsSkippedNoJob = 0;
  let materialsSkippedNoQty = 0;
  let materialsSkippedBundleHeader = 0;
  let materialsSkippedNonInventory = 0;
  let materialsSkippedDuplicate = 0;
  const totalMaterialsSeen = (sm8Materials || []).length;
  const matchMethodCounts = {};

  const candidateMaterials = (sm8Materials || []).filter((m) => {
    if (!m.uuid) { materialsSkippedNoJob++; return false; } // malformed line from the API, essentially never happens
    if (decidedUuids.has(m.uuid)) { materialsSkippedDuplicate++; return false; } // human already resolved/ignored this one for good
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
    `[sm8 sync] processed ${materialPayload.length} material lines (${materialsDeducted} deducted, ${materialsFlagged} flagged) â€” ` +
    `matched by: ${JSON.stringify(matchMethodCounts)} â€” skipped: ${materialsSkippedBundleHeader} bundle header(s), ${materialsSkippedNonInventory} non-inventory â€” ${elapsed()}`
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
      materialsSkippedDuplicate,
      matchMethodCounts,
      catalogAvailable,
      // Small sample for the debug panel â€” not full raw dumps, just enough
      // to eyeball what ServiceM8 actually sent if matching looks off.
      sampleRawMaterials: (sm8Materials || []).slice(0, 5),
    },
  });
}