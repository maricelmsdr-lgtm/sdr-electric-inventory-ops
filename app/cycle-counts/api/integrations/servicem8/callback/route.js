import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const sm8Error = searchParams.get("error");

  const cookieRaw = request.cookies.get("sm8_oauth")?.value;
  const clearCookie = (res) => {
    res.cookies.set("sm8_oauth", "", { maxAge: 0, path: "/" });
    return res;
  };

  if (sm8Error) {
    return clearCookie(NextResponse.redirect(`${origin}/integrations?error=servicem8_denied`));
  }
  if (!code || !cookieRaw) {
    return clearCookie(NextResponse.redirect(`${origin}/integrations?error=invalid_callback`));
  }

  let orgId, userId, expectedState;
  try {
    const parsed = JSON.parse(cookieRaw);
    orgId = parsed.org_id;
    userId = parsed.user_id;
    expectedState = parsed.state;
  } catch {
    return clearCookie(NextResponse.redirect(`${origin}/integrations?error=invalid_callback`));
  }

  if (!returnedState || returnedState !== expectedState) {
    return clearCookie(NextResponse.redirect(`${origin}/integrations?error=state_mismatch`));
  }

  let admin;
  try {
    admin = supabaseAdmin();
  } catch {
    return clearCookie(NextResponse.redirect(`${origin}/integrations?error=not_configured`));
  }

  const appId = process.env.SERVICEM8_APP_ID;
  const appSecret = process.env.SERVICEM8_APP_SECRET;
  const redirectUri = process.env.SERVICEM8_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) {
    return clearCookie(NextResponse.redirect(`${origin}/integrations?error=not_configured`));
  }

  try {
    const tokenRes = await fetch("https://go.servicem8.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      return clearCookie(NextResponse.redirect(`${origin}/integrations?error=token_exchange_failed`));
    }
    const tokenData = await tokenRes.json();

    // Guard against a 200 response that doesn't actually contain a token —
    // without this check we'd silently mark the integration "connected"
    // with nothing usable behind it.
    if (!tokenData?.access_token) {
      return clearCookie(NextResponse.redirect(`${origin}/integrations?error=token_exchange_failed`));
    }

    // Upsert the integrations row for this org/provider, then store the tokens.
    const { data: integration, error: integErr } = await admin
      .from("integrations")
      .upsert(
        { org_id: orgId, provider: "servicem8", connected: true, connected_at: new Date().toISOString() },
        { onConflict: "org_id,provider" }
      )
      .select()
      .single();

    if (integErr || !integration) {
      return clearCookie(NextResponse.redirect(`${origin}/integrations?error=save_failed`));
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
    const { error: tokenSaveErr } = await admin.from("integration_tokens").upsert({
      integration_id: integration.id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: expiresAt,
    });

    if (tokenSaveErr) {
      return clearCookie(NextResponse.redirect(`${origin}/integrations?error=save_failed`));
    }

    await admin.from("activity_log").insert({
      org_id: orgId,
      user_id: userId,
      message: "Connected ServiceM8 integration",
    });

    return clearCookie(NextResponse.redirect(`${origin}/integrations?connected=servicem8`));
  } catch (e) {
    return clearCookie(NextResponse.redirect(`${origin}/integrations?error=unexpected`));
  }
}
