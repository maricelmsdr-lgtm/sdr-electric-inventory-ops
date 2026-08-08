import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidAccessToken, fetchJobs, fetchJobMaterialsForJobs, fetchCompanies, fetchMaterialsCatalog } from "@/lib/servicem8";

// Retrying through a rate limit can take a while (see sm8Fetch's backoff),
// so give this route more room than the default 10s.
export const maxDuration = 60;

// One-way pull from ServiceM8: jobs + materials used come IN, nothing
// goes back out. Each material line that matches a part in the SDR
// catalog gets deducted from stock at the Main Warehouse location.
// Anything that can't be matched, or matches but doesn't have enough
// stock on hand, is written to unmatched_materials for manual review
// instead of silently failing or going negative.
export async function POST(request) {
  console.log("MARKER_TEST_7f40507_CHECK");
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
  // most of what blew past Vercel's 60s limit (confirmed via the Vercel
  // function logs: a long list of individual POST requests to Supabase).
  // See supabase/007_bulk_sync_functions.sql.
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

  // ---------------------------------------------------------------------
  // TEMPORARY DEBUG — bundle investigation (job #15158 / $JOBMATERIAL)
  // Logs the raw, unprocessed material lines for job 15158 exactly as
  // ServiceM8's API returned them, before any matching/filtering touches
  // them. Goal: see whether a bundle line's inner parts (e.g.
  // TYWRAP8MOUNTBLK, HSK4) come back as separate sibling rows in this same
  // array (maybe tagged with a parent/bundle uuid field), or whether only
  // the bundle header ($JOBMATERIAL) is present and the components require
  // a separate API call. Remove this block once that's confirmed.
  // ---------------------------------------------------------------------
  const DEBUG_JOB_NO = "15158";
  const debugJobUuid = relevantJobs.find(
    (j) => (j.generated_job_id || "").trim() === DEBUG_JOB_NO
  )?.uuid;
  if (debugJobUuid) {
    const debugLines = sm8Materials.filter((m) => m.job_uuid === debugJobUuid);
    console.log(
      `[DEBUG bundle] job #${DEBUG_JOB_NO} (${debugJobUuid}) — ${debugLines.length} raw material line(s):`
    );
    console.log(JSON.stringify(debugLines, null, 2));
  } else {
    console.log(`[DEBUG bundle] job #${DEBUG_JOB_NO} not found in this sync's relevantJobs (check SYNC_WINDOW_DAYS / job status).`);
  }
  // ---------------------------------------------------------------------
  // END TEMPORARY DEBUG
  // ---------------------------------------------------------------------

  // Match materials to the parts catalog. Prefer matching on ServiceM8's own
  // catalog item CODE (via material_uuid → material.json) — that's the real
  // part number, e.g. "TYWRAP8MOUNTBLK" — over the job material's "name"
  // field, which is a human-readable description ("TYWRAP 8 BLACK WITH
  // MOUNTING HOLE") that will almost never equal a SKU/part_no exactly.
  //
  // The catalog fetch needs the read_inventory scope, only just added — an
  // org connected before this update will 403 here until they disconnect +
  // reconnect ServiceM8. That's not fatal: fall back to name-only matching
  // (the old behavior) so sync still works, just less precisely, until
  // they reconnect.
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
  if (sm8MaterialsCatalog.length > 0) console.log(`[sm8 sync] sample catalog item: ${JSON.stringify(sm8MaterialsCatalog[0])}`);

  const { data: parts } = await admin
    .from("parts")
    .select("id, sku, part_no, unit_cost")
    .eq("org_id", profile.org_id);
  const partByKey = {};
  for (const p of parts || []) {
    if (p.sku) partByKey[p.sku.trim().toLowerCase()] = p;
    if (p.part_no) partByKey[p.part_no.trim().toLowerCase()] = p;
  }

  const { data: alreadySyncedLines } = await admin
    .from("job_line_items")
    .select("servicem8_material_uuid")
    .not("servicem8_material_uuid", "is", null);
  const syncedUuids = new Set((alreadySyncedLines || []).map((l) => l.servicem8_material_uuid));

  const { data: alreadyFlagged } = await admin.from("unmatched_materials").select("servicem8_material_uuid");
  const flaggedUuids = new Set((alreadyFlagged || []).map((f) => f.servicem8_material_uuid));

  // Match materials to the parts catalog by SKU or part number in memory
  // (cheap — no network cost), then hand the whole resolved batch to
  // Postgres in ONE call instead of one HTTP round trip per material line.
  // With a few hundred material lines, that per-row approach (even
  // "concurrent" in small batches) was the dominant cost — confirmed via
  // Vercel's function logs showing a long list of individual POST requests
  // to Supabase. See supabase/007_bulk_sync_functions.sql.
  let materialsDeducted = 0;
  let materialsFlagged = 0;
  let materialsSkippedNoJob = 0;
  let materialsSkippedNoQty = 0;
  const totalMaterialsSeen = (sm8Materials || []).length;

  const candidateMaterials = (sm8Materials || []).filter(
    (m) => m.uuid && !syncedUuids.has(m.uuid) && !flaggedUuids.has(m.uuid)
  );

  const materialPayload = [];
  for (const m of candidateMaterials) {
    const jobId = jobIdByUuid[m.job_uuid];
    if (!jobId) { materialsSkippedNoJob++; continue; } // material belongs to a job we didn't pull (quote/cancelled)

    const qty = Number(m.quantity ?? m.qty ?? 0);
    if (!qty) { materialsSkippedNoQty++; continue; }

    const catalogItem = catalogByUuid[m.material_uuid];
    // Field name guessed defensively since we haven't seen a live payload
    // yet — sampleRawMaterialsCatalog in the response below will confirm
    // the real one if this needs adjusting.
    const catalogCode = (catalogItem?.code || catalogItem?.item_number || catalogItem?.sku || catalogItem?.field1 || "")
      .toString().trim().toLowerCase();
    const nameKey = (m.name || "").trim().toLowerCase();
    const match = (catalogCode && partByKey[catalogCode]) || partByKey[nameKey];

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

  console.log(`[sm8 sync] processed ${materialPayload.length} material lines (${materialsDeducted} deducted, ${materialsFlagged} flagged) — ${elapsed()}`);

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
      // Temporary: raw shape of what ServiceM8 actually returns, so we can
      // see real field names instead of guessing against docs. Remove once
      // matching is confirmed working.
      sampleRawMaterials: (sm8Materials || []).slice(0, 3),
      sampleRawMaterialsCatalog: (sm8MaterialsCatalog || []).slice(0, 3),
      catalogAvailable,
    },
  });
}