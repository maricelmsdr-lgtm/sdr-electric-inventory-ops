// SERVER-ONLY. Talks to ServiceM8's API using the org's stored OAuth tokens.
// Never import this from a "use client" component.

const TOKEN_URL = "https://go.servicem8.com/oauth/access_token";
const API_BASE = "https://api.servicem8.com/api_1.0";

export async function getValidAccessToken(admin, integrationId) {
  const { data: tok, error } = await admin
    .from("integration_tokens")
    .select("*")
    .eq("integration_id", integrationId)
    .single();

  if (error || !tok) {
    throw new Error("No ServiceM8 tokens on file. Reconnect ServiceM8.");
  }

  const expiresAt = tok.expires_at
    ? new Date(tok.expires_at).getTime()
    : 0;

  const expiringSoon = expiresAt - Date.now() < 60_000;

  if (!expiringSoon) return tok.access_token;

  if (!tok.refresh_token) {
    throw new Error(
      "ServiceM8 session expired and there's no refresh token on file. Reconnect ServiceM8."
    );
  }

  const appId = process.env.SERVICEM8_APP_ID;
  const appSecret = process.env.SERVICEM8_APP_SECRET;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: appId,
      client_secret: appSecret,
      refresh_token: tok.refresh_token,
    }),
  });

  if (!res.ok) {
    throw new Error(
      "Couldn't refresh the ServiceM8 connection. Try disconnecting and reconnecting it."
    );
  }

  const fresh = await res.json();

  if (!fresh?.access_token) {
    throw new Error(
      "Couldn't refresh the ServiceM8 connection. Try disconnecting and reconnecting it."
    );
  }

  const newExpiresAt = new Date(
    Date.now() + (fresh.expires_in || 3600) * 1000
  ).toISOString();

  const { error: updateError } = await admin
    .from("integration_tokens")
    .update({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token || tok.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("integration_id", integrationId);

  if (updateError) {
    throw new Error(
      `Couldn't save refreshed ServiceM8 token: ${updateError.message}`
    );
  }

  return fresh.access_token;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sm8Fetch(path, accessToken, attempt = 1) {
  const res = await fetch(`${API_BASE}/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (res.status === 429 && attempt <= 2) {
    const retryAfterHeader = res.headers.get("retry-after");
    const parsedRetryAfter = Number(retryAfterHeader);

    const waitMs =
      Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0
        ? Math.min(parsedRetryAfter * 1000, 5000)
        : 1500 * 2 ** (attempt - 1);

    await sleep(waitMs);

    return sm8Fetch(path, accessToken, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");

    throw new Error(
      `ServiceM8 API error (${res.status}) on ${path}: ${body.slice(0, 200)}`
    );
  }

  return res.json();
}

export function fetchJobs(accessToken, sinceDate) {
  if (!sinceDate) {
    return sm8Fetch("job.json", accessToken);
  }

  const filterValue = encodeURIComponent(`date gt '${sinceDate}'`);

  return sm8Fetch(
    `job.json?%24filter=${filterValue}`,
    accessToken
  );
}

export function fetchJobMaterialsForJob(accessToken, jobUuid) {
  const filterValue = encodeURIComponent(
    `job_uuid eq '${jobUuid}'`
  );

  return sm8Fetch(
    `jobmaterial.json?%24filter=${filterValue}`,
    accessToken
  );
}

/**
 * Fetch job materials using controlled concurrency.
 *
 * IMPORTANT:
 * The old implementation randomized jobs and could stop early while
 * the sync route still advanced the checkpoint for the entire batch.
 *
 * This version returns:
 *
 * materials
 * completedJobUuids
 * failedJobs
 * timedOut
 *
 * The sync route can therefore advance ONLY jobs that were actually
 * fetched successfully.
 */
export async function fetchJobMaterialsForJobs(
  accessToken,
  jobUuids,
  options = {}
) {
  const concurrency = Math.max(
    1,
    Number(options.concurrency || 2)
  );

  const timeBudgetMs = Math.max(
    5000,
    Number(options.timeBudgetMs || 42_000)
  );

  const startedAt = Date.now();

  const results = [];
  const completedJobUuids = [];
  const failedJobs = [];

  let cursor = 0;

  async function worker(workerId) {
    while (true) {
      if (Date.now() - startedAt >= timeBudgetMs) {
        return;
      }

      const index = cursor++;

      if (index >= jobUuids.length) {
        return;
      }

      const jobUuid = jobUuids[index];

      try {
        const materials =
          await fetchJobMaterialsForJob(
            accessToken,
            jobUuid
          );

        if (Array.isArray(materials)) {
          results.push(...materials);
        }

        completedJobUuids.push(jobUuid);

        console.log(
          `[sm8 sync] material fetch worker ${workerId}: ${index + 1}/${jobUuids.length} complete`
        );
      } catch (e) {
        failedJobs.push({
          jobUuid,
          error:
            e?.message ||
            "Unknown ServiceM8 material fetch error",
        });

        console.log(
          `[sm8 sync] material fetch failed for job ${jobUuid}: ${e?.message || e}`
        );
      }

      await sleep(150);
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          concurrency,
          jobUuids.length
        ),
      },
      (_, i) => worker(i + 1)
    )
  );

  return {
    materials: results,
    completedJobUuids,
    failedJobs,
    timedOut:
      Date.now() - startedAt >= timeBudgetMs,
  };
}

export function fetchCompanies(accessToken) {
  return sm8Fetch("company.json", accessToken);
}

/**
 * ServiceM8's account-wide Materials & Services catalog.
 *
 * Job-material rows contain material_uuid. The catalog can provide the
 * actual ServiceM8 item code, which is important for matching:
 *
 * ServiceM8:
 *   TYWRAP 8 BLACK WITH MOUNTING HOLE
 *
 * Catalog code:
 *   TYWRAP8MOUNTBLK
 *
 * SDR Parts:
 *   TYWRAP8MOUNTBLK
 */
export function fetchMaterialsCatalog(accessToken) {
  return sm8Fetch(
    "material.json",
    accessToken
  );
}