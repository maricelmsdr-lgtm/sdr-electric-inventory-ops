import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidAccessToken, fetchJobs, fetchJobMaterialsForJobs, fetchCompanies } from "@/lib/servicem8";

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

  let jobsCreated = 0;
  let jobsUpdated = 0;
  for (const j of relevantJobs) {
    const row = {
      org_id: profile.org_id,
      job_no: j.generated_job_id || j.uuid,
      client: companyName[j.company_uuid] || "Unknown client",
      address: j.job_address || null,
      job_date: (j.date || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      location_id: mainLoc.id,
      servicem8_job_uuid: j.uuid,
      synced_from_servicem8: true,
    };
    if (jobIdByUuid[j.uuid]) {
      await admin.from("jobs").update(row).eq("id", jobIdByUuid[j.uuid]);
      jobsUpdated++;
    } else {
      const { data: inserted, error: insErr } = await admin.from("jobs").insert(row).select("id").single();
      if (!insErr && inserted) {
        jobIdByUuid[j.uuid] = inserted.id;
        jobsCreated++;
      }
    }
  }

  // Fetch materials per job (ServiceM8 requires the $filter=job_uuid query —
  // an unfiltered bulk call doesn't reliably return everything). Done
  // sequentially with a small pause between calls to stay under ServiceM8's
  // per-minute rate limit — firing one request per job all at once trips it
  // as soon as there's more than a few jobs.
  let sm8Materials = [];
  try {
    sm8Materials = await fetchJobMaterialsForJobs(sm8Token, Object.keys(jobIdByUuid));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  // Match materials to the parts catalog by SKU or part number
  // (case-insensitive, exact match on the ServiceM8 material name).
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

  let materialsDeducted = 0;
  let materialsFlagged = 0;
  let materialsSkippedNoJob = 0;
  let materialsSkippedNoQty = 0;
  let materialsNonInventory = 0;
  const totalMaterialsSeen = (sm8Materials || []).length;

  // ServiceM8's Job Materials list mixes real inventory parts with labor
  // and service charges ("Technician Labour", "SERVICE CALL FEE / TRUCK
  // CHARGE", etc). Those aren't materials to match against the parts
  // catalog or deduct stock for — but they're still real invoice line
  // items, so we record them on the job with no linked part instead of
  // silently dropping them or flagging them as "no matching part found".
  const NON_INVENTORY_PATTERN = /\b(labou?r|technician|apprentice|service\s?(call|rate)|truck charge|call[\s-]?out|call[\s-]?back|travel time|site visit|diagnostic fee|trip charge|mileage|warranty\s?(service|call|visit|callback)|after[\s-]?installation)\b/i;

  for (const m of sm8Materials || []) {
    if (!m.uuid || syncedUuids.has(m.uuid) || flaggedUuids.has(m.uuid)) continue;

    const jobId = jobIdByUuid[m.job_uuid];
    if (!jobId) { materialsSkippedNoJob++; continue; } // material belongs to a job we didn't pull (quote/cancelled) — skip

    const qty = Number(m.quantity ?? m.qty ?? 0);
    if (!qty) { materialsSkippedNoQty++; continue; }

    if (NON_INVENTORY_PATTERN.test(m.name || "")) {
      await admin.from("job_line_items").insert({
        job_id: jobId,
        part_id: null,
        qty: Math.max(1, Math.round(qty)),
        part_cost: 0,
        sale_cost: Number(m.price) || 0,
        servicem8_material_uuid: m.uuid,
      });
      materialsNonInventory++;
      continue;
    }

    const key = (m.name || "").trim().toLowerCase();
    const match = partByKey[key];

    if (!match) {
      await admin.from("unmatched_materials").insert({
        org_id: profile.org_id,
        job_id: jobId,
        servicem8_material_uuid: m.uuid,
        raw_name: m.name || "(unnamed)",
        qty,
        unit_cost: Number(m.cost) || 0,
        reason: "no_match",
      });
      materialsFlagged++;
      continue;
    }

    // Try the deduction first — the DB rejects it if it would take
    // that location negative. If it fails, flag for review instead
    // of recording a line item for stock that was never actually moved.
    const { error: rpcErr } = await admin.rpc("apply_inventory_qty_change", {
      p_org_id: profile.org_id,
      p_part_id: match.id,
      p_location_id: mainLoc.id,
      p_delta: -qty,
    });

    if (rpcErr) {
      await admin.from("unmatched_materials").insert({
        org_id: profile.org_id,
        job_id: jobId,
        servicem8_material_uuid: m.uuid,
        raw_name: m.name || "(unnamed)",
        qty,
        unit_cost: Number(m.cost) || 0,
        reason: "insufficient_stock",
      });
      materialsFlagged++;
      continue;
    }

    await admin.from("job_line_items").insert({
      job_id: jobId,
      part_id: match.id,
      qty,
      part_cost: Number(m.cost) || match.unit_cost || 0,
      sale_cost: Number(m.price) || 0,
      servicem8_material_uuid: m.uuid,
    });
    materialsDeducted++;
  }

  await admin.from("integrations").update({ last_synced_at: new Date().toISOString() }).eq("id", integration.id);
  await admin.from("activity_log").insert({
    org_id: profile.org_id,
    user_id: userData.user.id,
    message: `Synced ServiceM8: ${jobsCreated} new job(s), ${jobsUpdated} updated, ${materialsDeducted} material(s) deducted, ${materialsNonInventory} labor/service charge(s) recorded, ${materialsFlagged} flagged for review.`,
  });

  return NextResponse.json({
    ok: true,
    jobsCreated,
    jobsUpdated,
    materialsDeducted,
    materialsNonInventory,
    materialsFlagged,
    diagnostics: {
      totalMaterialsSeen,
      materialsSkippedNoJob,
      materialsSkippedNoQty,
      // Temporary: raw shape of what ServiceM8 actually returns, so we can
      // see real field names instead of guessing against docs. Remove once
      // matching is confirmed working.
      sampleRawMaterials: (sm8Materials || []).slice(0, 3),
    },
  });
}