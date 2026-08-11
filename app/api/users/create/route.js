import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Creates a new team member: an auth user + their profile row.
// Runs server-side only — this is where it's safe to use the service
// role key. The Add User modal calls this via fetch() instead of
// touching supabase.auth.admin directly from the browser.
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const {
    username,
    email,
    password,
    phone,
    locationId,
    role,
    jobAccess,
    purchaseAccess,
    cycleCountAccess,
    orgId, // ASSUMPTION: pass the current user's org_id from the client
  } = body;

  if (!username?.trim() || !email?.trim() || !password?.trim()) {
    return NextResponse.json(
      { error: "Username, email, and password are required." },
      { status: 400 }
    );
  }

  let admin;
  try {
    admin = supabaseAdmin();
  } catch {
    return NextResponse.json(
      { error: "Server isn't configured yet (missing Supabase service key)." },
      { status: 500 }
    );
  }

  // 1. Create the auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  // 2. Create the profile row
  // ASSUMPTION: profiles table columns — adjust to match your real schema
  // once you share it.
  const { error: profileError } = await admin.from("profiles").insert({
    id: authData.user.id,
    org_id: orgId || null,
    username: username.trim(),
    email: email.trim(),
    phone: phone?.trim() || null,
    location_id: locationId || null,
    role: role || "technician",
    job_access: jobAccess || "assigned",
    purchase_access: !!purchaseAccess,
    cycle_count_access: !!cycleCountAccess,
    active: true,
  });

  if (profileError) {
    // Roll back the auth user so we don't leave an orphaned account
    // if the profile insert failed.
    await admin.auth.admin.deleteUser(authData.user.id).catch(() => {});
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId: authData.user.id });
}
