// SERVER-ONLY. Talks to ServiceM8's API using the org's stored OAuth
// tokens. Never import this from a "use client" component.

const TOKEN_URL = "https://go.servicem8.com/oauth/access_token";
const API_BASE = "https://api.servicem8.com/api_1.0";

// Returns a usable access token for this integration, refreshing it
// first if it's expired or about to expire. Updates integration_tokens
// in place when a refresh happens, so the next call can reuse it.
export async function getValidAccessToken(admin, integrationId) {
  const { data: tok, error } = await admin
    .from("integration_tokens")
    .select("*")
    .eq("integration_id", integrationId)
    .single();

  if (error || !tok) {
    throw new Error("No ServiceM8 tokens on file. Reconnect ServiceM8.");
  }

  const expiresAt = tok.expires_at ? new Date(tok.expires_at).getTime() : 0;
  const expiringSoon = expiresAt - Date.now() < 60_000; // refresh if <60s left
  if (!expiringSoon) return tok.access_token;

  if (!tok.refresh_token) {
    throw new Error("ServiceM8 session expired and there's no refresh token on file. Reconnect ServiceM8.");
  }

  const appId = process.env.SERVICEM8_APP_ID;
  const appSecret = process.env.SERVICEM8_APP_SECRET;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: appId,
      client_secret: appSecret,
      refresh_token: tok.refresh_token,
    }),
  });

  if (!res.ok) {
    throw new Error("Couldn't refresh the ServiceM8 connection. Try disconnecting and reconnecting it.");
  }
  const fresh = await res.json();
  if (!fresh?.access_token) {
    throw new Error("Couldn't refresh the ServiceM8 connection. Try disconnecting and reconnecting it.");
  }

  const newExpiresAt = new Date(Date.now() + (fresh.expires_in || 3600) * 1000).toISOString();
  await admin
    .from("integration_tokens")
    .update({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token || tok.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("integration_id", integrationId);

  return fresh.access_token;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sm8Fetch(path, accessToken, attempt = 1) {
  const res = await fetch(`${API_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });

  if (res.status === 429 && attempt <= 4) {
    // Respect Retry-After if ServiceM8 sends one, otherwise back off
    // 2s, 4s, 8s, 16s. Their per-minute limit resets on a rolling window,
    // so a short wait is normally enough.
    const retryAfterHeader = res.headers.get("retry-after");
    const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 2000 * 2 ** (attempt - 1);
    await sleep(waitMs);
    return sm8Fetch(path, accessToken, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ServiceM8 API error (${res.status}) on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export function fetchJobs(accessToken, sinceDate) {
  // sinceDate: "YYYY-MM-DD". ServiceM8 only supports the `gt` operator on
  // date filters (no `ge`), which is fine — a day of slack doesn't matter
  // here. Filtering server-side avoids pulling a company's entire job
  // history (which can be thousands of rows) on every sync.
  if (!sinceDate) return sm8Fetch("job.json", accessToken);
  const filterValue = encodeURIComponent(`date gt '${sinceDate}'`);
  return sm8Fetch(`job.json?%24filter=${filterValue}`, accessToken);
}

// ServiceM8 expects Job Materials (the Billing-tab "Items & Services") to be
// queried per job with a $filter, not pulled in bulk — an unfiltered call
// doesn't reliably return everything.
export function fetchJobMaterialsForJob(accessToken, jobUuid) {
  const filterValue = encodeURIComponent(`job_uuid eq '${jobUuid}'`);
  return sm8Fetch(`jobmaterial.json?%24filter=${filterValue}`, accessToken);
}

// Fetches materials for many jobs in small concurrent batches (rather than
// one request at a time) — ServiceM8's rate limit is per-minute, not
// per-request, so a handful of jobs in flight at once is safe and cuts
// total wall-clock time roughly by the batch size. Fully sequential (one
// job + 150ms pause at a time) was the main reason large syncs blew past
// the route's time limit and got killed with a 504 before ever responding.
const MATERIALS_BATCH_SIZE = 5;
const MATERIALS_BATCH_PAUSE_MS = 200;

export async function fetchJobMaterialsForJobs(accessToken, jobUuids) {
  const results = [];
  for (let i = 0; i < jobUuids.length; i += MATERIALS_BATCH_SIZE) {
    const batch = jobUuids.slice(i, i + MATERIALS_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((jobUuid) => fetchJobMaterialsForJob(accessToken, jobUuid))
    );
    for (const materials of batchResults) results.push(...materials);
    if (i + MATERIALS_BATCH_SIZE < jobUuids.length) await sleep(MATERIALS_BATCH_PAUSE_MS);
  }
  return results;
}

export function fetchCompanies(accessToken) {
  return sm8Fetch("company.json", accessToken);
}