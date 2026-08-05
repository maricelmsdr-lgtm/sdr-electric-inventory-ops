import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request) {
  const { access_token } = await request.json().catch(() => ({}));
  if (!access_token) {
    return NextResponse.json({ error: "Missing session." }, { status: 401 });
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(access_token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("org_id")
    .eq("id", userData.user.id)
    .single();

  if (!profile?.org_id) {
    return NextResponse.json({ error: "No organization found." }, { status: 400 });
  }

  const { data: integration } = await supabaseAdmin
    .from("integrations")
    .select("id")
    .eq("org_id", profile.org_id)
    .eq("provider", "servicem8")
    .single();

  if (integration) {
    await supabaseAdmin.from("integration_tokens").delete().eq("integration_id", integration.id);
    await supabaseAdmin
      .from("integrations")
      .update({ connected: false, connected_at: null })
      .eq("id", integration.id);
  }

  await supabaseAdmin.from("activity_log").insert({
    org_id: profile.org_id,
    user_id: userData.user.id,
    message: "Disconnected ServiceM8 integration",
  });

  return NextResponse.json({ ok: true });
}
