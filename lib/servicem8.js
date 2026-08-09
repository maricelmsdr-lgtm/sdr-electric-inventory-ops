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

  if (res.status === 429 && attempt <= 2) {
    // Cut from 4 retries (2s/4s/8s/16s, up to 30s per request) down to 2
    // (2s/4s, up to 6s) — a real sustained rate limit doesn't clear faster
    // just because we wait longer, and a handful of rate-limited jobs each
    // eating 30s of retries was enough on its own to blow the route's 60s
    // budget even with per-job failures no longer aborting the whole sync.
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

// Fetches materials one job at a time, sequentially, with a pause between
// each — ServiceM8's per-minute rate limit turned out to be tighter than
// expected: firing 5 concurrent requests (an earlier approach) burst past
// it hard enough that even automatic 429 backoff couldn't recover. We can
// afford to be conservative here now — the database side (job upserts +
// material processing) is a single bulk call each since
// 007_bulk_sync_functions.sql, so it's no longer the fetch pacing that
// determines whether a sync finishes inside the time limit.
//
// deadlineMs is an ABSOLUTE timestamp (Date.now()-based), not a duration —
// the caller passes in "route start time + safety margin" so this respects
// the WHOLE request's time budget (job fetch, catalog fetch, the final
// bulk write) rather than just its own loop's start. A fixed internal
// budget measured from when this function starts was the bug last round:
// fine for ~50 jobs, not enough headroom once an org had 292.
//
// Two independent safeguards, since either failure pattern is possible:
//   - MAX_CONSECUTIVE_FAILURES catches a solid wall of rate-limiting.
//   - deadlineMs catches scattered failures too (e.g. every other job
//     failing) — each retried failure can cost up to ~6s even spread out.
// Either way, nothing is lost — a skipped job's materials just get picked
// up on a later sync (job order is shuffled below so repeated runs don't
// keep stalling on the same jobs).
const MATERIALS_FETCH_PAUSE_MS = 600;
const MAX_CONSECUTIVE_FAILURES = 3;

export async function fetchJobMaterialsForJobs(accessToken, jobUuids, deadlineMs) {
  const shuffled = [...jobUuids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const results = [];
  let consecutiveFailures = 0;
  for (let i = 0; i < shuffled.length; i++) {
    if (deadlineMs && Date.now() > deadlineMs) {
      console.log(`[sm8 sync] materials fetch hit its time budget — stopping early, ${shuffled.length - i} job(s) left unfetched this run.`);
      break;
    }
    try {
      const materials = await fetchJobMaterialsForJob(accessToken, shuffled[i]);
      results.push(...materials);
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures++;
      console.log(`[sm8 sync] skipped materials for job ${shuffled[i]} after fetch failure: ${e.message}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log(`[sm8 sync] ${consecutiveFailures} consecutive material-fetch failures — stopping early, ${shuffled.length - i - 1} job(s) left unfetched this run.`);
        break;
      }
    }
    if (i < shuffled.length - 1) await sleep(MATERIALS_FETCH_PAUSE_MS);
  }
  return results;
}

export function fetchCompanies(accessToken) {
  return sm8Fetch("company.json", accessToken);
}

// The materials CATALOG (ServiceM8's own "Materials & Services" list) — a
// single account-wide fetch, not per-job. Each job material line (above)
// only carries a human-readable name plus a material_uuid pointing at one
// of these; the actual item code (e.g. "TYWRAP8MOUNTBLK") lives here.
// Requires the read_inventory OAuth scope.
export function fetchMaterialsCatalog(accessToken) {
  return sm8Fetch("material.json", accessToken);
}