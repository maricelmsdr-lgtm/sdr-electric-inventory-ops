import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Read-only-ish scopes to start. Add manage_/create_ scopes later once we
// build the actual data sync (pulling jobs, pushing parts usage, etc).
const SCOPES = "vendor read_customers read_jobs read_job_materials";

// POST (not GET) so the user's session token travels in the request body,
// never in the URL — a URL-based token risks leaking via server access
// logs or the browser's Referer header on the next navigation.
export async function POST(request) {
  const { access_token } = await request.json().catch(() => ({}));
  if (!access_token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(access_token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("org_id")
    .eq("id", userData.user.id)
    .single();

  if (profileErr || !profile?.org_id) {
    return NextResponse.json({ error: "No organization found for this account." }, { status: 400 });
  }

  const appId = process.env.SERVICEM8_APP_ID;
  const redirectUri = process.env.SERVICEM8_REDIRECT_URI;
  if (!appId || !redirectUri) {
    return NextResponse.json({ error: "ServiceM8 integration is not configured yet." }, { status: 500 });
  }

  // Short-lived state tying the callback back to this org/user, and guarding
  // against CSRF. Stored in an httpOnly cookie so browser JS can't read or
  // tamper with it; the random `state` value also gets echoed by ServiceM8.
  const state = randomBytes(16).toString("hex");
  const authorizeUrl = new URL("https://go.servicem8.com/oauth/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", appId);
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.json({ url: authorizeUrl.toString() });
  res.cookies.set(
    "sm8_oauth",
    JSON.stringify({ state, org_id: profile.org_id, user_id: userData.user.id }),
    { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" }
  );
  return res;
}
