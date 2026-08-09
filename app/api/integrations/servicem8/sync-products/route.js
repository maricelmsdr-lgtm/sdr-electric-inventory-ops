import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidAccessToken, fetchMaterialsCatalog } from "@/lib/servicem8";

// Pulling the whole account's catalog is usually fast (it's one bulk call,
// not per-job like the jobs sync), but give it real room anyway.
export const maxDuration = 60;

// Same defensive fallback chain the jobs-sync route already uses for the
// item code — ServiceM8's material catalog has been observed returning the
// code under different field names depending on account/setup, so we don't
// bet on one. See app/api/integrations/servicem8/sync/route.js.
function pickCode(m) {
  return (m?.code || m?.item_number || m?.sku || m?.field1 || "").toString().trim();
}

// Same caution applies to price — this hasn't been verified against a real
// account's catalog response yet, so we check the plausible field names in
// order and fall back to 0 rather than crash. Worth confirming after the
// first real run (log a sample raw item if prices come back wrong).
function pickPrice(m) {
  const candidates = [m?.price, m?.sell_price, m?.displayed_amount, m?.cost];
  for (const c of candidates) {
    const n = Number(c);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return 0;
}

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

  let sm8Catalog;
  try {
    sm8Catalog = await fetchMaterialsCatalog(sm8Token);
  } catch (e) {
    // Most likely cause: the org connected before read_inventory was
    // requested. Give a specific, actionable message instead of a raw
    // API error.
    return NextResponse.json(
      { error: `Couldn't fetch the materials catalog from ServiceM8 (${e.message}). If this keeps happening, try disconnecting and reconnecting ServiceM8 to grant the read_inventory permission.` },
      { status: 502 }
    );
  }

  // Skip inactive/deleted catalog entries and anything with no name at all —
  // nothing useful to import.
  const usable = (sm8Catalog || []).filter((m) => m?.uuid && m?.active !== 0 && (m?.name || "").trim());

  if (usable.length === 0) {
    return NextResponse.json({ ok: true, productsCreated: 0, productsUpdated: 0, message: "No materials found in ServiceM8's catalog." });
  }

  // Existing parts already linked to a ServiceM8 catalog item, so we know
  // which ones are creates vs. updates for the summary message.
  const { data: existingParts } = await admin
    .from("parts")
    .select("id, servicem8_material_uuid")
    .eq("org_id", profile.org_id)
    .not("servicem8_material_uuid", "is", null);
  const existingUuids = new Set((existingParts || []).map((p) => p.servicem8_material_uuid));

  const rows = usable.map((m) => {
    const code = pickCode(m);
    const name = (m.name || "").trim();
    return {
      org_id: profile.org_id,
      // SKU must be non-empty and unique per org — fall back to the
      // ServiceM8 uuid itself when no code is set on the catalog item,
      // rather than skipping the item entirely.
      sku: code || `SM8-${m.uuid.slice(0, 8)}`,
      part_no: code || name,
      description: name,
      category: "General",
      unit_cost: pickPrice(m),
      servicem8_material_uuid: m.uuid,
    };
  });

  const { error: upsertErr, data: upserted } = await admin
    .from("parts")
    .upsert(rows, { onConflict: "servicem8_material_uuid" })
    .select("id");

  if (upsertErr) {
    // A collision on the (org_id, sku) unique constraint is the likely
    // failure mode — e.g. a manually-created part already uses the same
    // SKU as a ServiceM8 code. Surface that plainly rather than a raw
    // Postgres error.
    if (upsertErr.message?.includes("parts_org_id_sku_key")) {
      return NextResponse.json(
        { error: "One or more ServiceM8 item codes match a SKU already used by an existing part. Rename the conflicting part's SKU and try again." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  const productsCreated = rows.filter((r) => !existingUuids.has(r.servicem8_material_uuid)).length;
  const productsUpdated = rows.length - productsCreated;

  await admin.from("activity_log").insert({
    org_id: profile.org_id,
    user_id: userData.user.id,
    message: `Synced ServiceM8 product catalog: ${productsCreated} new part(s), ${productsUpdated} updated`,
  });

  await admin.from("integrations").update({ last_synced_at: new Date().toISOString() }).eq("id", integration.id);

  return NextResponse.json({ ok: true, productsCreated, productsUpdated });
}