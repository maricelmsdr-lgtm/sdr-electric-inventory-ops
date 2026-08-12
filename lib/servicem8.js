// SERVER-ONLY.
// Talks to ServiceM8's API using the org's stored OAuth tokens.
// Never import this from a "use client" component.

const TOKEN_URL =
  "https://go.servicem8.com/oauth/access_token";

const API_BASE =
  "https://api.servicem8.com/api_1.0";

// ------------------------------------------------------------
// ACCESS TOKEN
// ------------------------------------------------------------

export async function getValidAccessToken(
  admin,
  integrationId
) {
  const { data: tok, error } = await admin
    .from("integration_tokens")
    .select("*")
    .eq("integration_id", integrationId)
    .single();

  if (error || !tok) {
    throw new Error(
      "No ServiceM8 tokens on file. Reconnect ServiceM8."
    );
  }

  const expiresAt = tok.expires_at
    ? new Date(tok.expires_at).getTime()
    : 0;

  const expiringSoon =
    expiresAt - Date.now() < 60_000;

  if (!expiringSoon) {
    return tok.access_token;
  }

  if (!tok.refresh_token) {
    throw new Error(
      "ServiceM8 session expired and there's no refresh token on file. Reconnect ServiceM8."
    );
  }

  const appId =
    process.env.SERVICEM8_APP_ID;

  const appSecret =
    process.env.SERVICEM8_APP_SECRET;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type":
        "application/x-www-form-urlencoded",
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
    Date.now() +
      (fresh.expires_in || 3600) * 1000
  ).toISOString();

  await admin
    .from("integration_tokens")
    .update({
      access_token: fresh.access_token,
      refresh_token:
        fresh.refresh_token ||
        tok.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("integration_id", integrationId);

  return fresh.access_token;
}

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ------------------------------------------------------------
// GENERIC SERVICEM8 FETCH
// ------------------------------------------------------------

async function sm8Fetch(
  path,
  accessToken,
  attempt = 1
) {
  const res = await fetch(
    `${API_BASE}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (
    res.status === 429 &&
    attempt <= 2
  ) {
    const retryAfterHeader =
      res.headers.get("retry-after");

    const waitMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000
      : 2000 * 2 ** (attempt - 1);

    await sleep(waitMs);

    return sm8Fetch(
      path,
      accessToken,
      attempt + 1
    );
  }

  if (!res.ok) {
    const body = await res
      .text()
      .catch(() => "");

    throw new Error(
      `ServiceM8 API error (${res.status}) on ${path}: ${body.slice(
        0,
        200
      )}`
    );
  }

  return res.json();
}

// ------------------------------------------------------------
// JOBS
// ------------------------------------------------------------

export function fetchJobs(
  accessToken,
  sinceDate
) {
  if (!sinceDate) {
    return sm8Fetch(
      "job.json",
      accessToken
    );
  }

  const filterValue = encodeURIComponent(
    `date gt '${sinceDate}'`
  );

  return sm8Fetch(
    `job.json?%24filter=${filterValue}`,
    accessToken
  );
}

// ------------------------------------------------------------
// JOB MATERIALS - ONE JOB
// ------------------------------------------------------------
//
// IMPORTANT:
//
// ServiceM8 keeps deleted/inactive job-material
// records accessible through the API.
//
// Those records have:
//     active = 0
//
// They may therefore exist in the API even though
// they are no longer visible in the ServiceM8 UI.
//
// We MUST ignore inactive materials.
//
// We also explicitly require:
//     active !== "0"
//     active !== 0
//
// This prevents old/deleted material records from
// entering SDR inventory.
//
// ------------------------------------------------------------

export async function fetchJobMaterialsForJob(
  accessToken,
  jobUuid
) {
  const filterValue = encodeURIComponent(
    `job_uuid eq '${jobUuid}'`
  );

  const materials = await sm8Fetch(
    `jobmaterial.json?%24filter=${filterValue}`,
    accessToken
  );

  if (!Array.isArray(materials)) {
    return [];
  }

  const activeMaterials =
    materials.filter((material) => {
      const active =
        material?.active;

      // ServiceM8 active values can arrive as
      // either numeric or string values.
      //
      // Only explicitly inactive records are removed.
      if (
        active === 0 ||
        active === "0"
      ) {
        console.log(
          `[sm8 sync] ignoring inactive ServiceM8 material: job=${jobUuid} material=${material?.uuid || "(no uuid)"} material_uuid=${material?.material_uuid || "(none)"} name=${material?.name || "(unnamed)"}`
        );

        return false;
      }

      return true;
    });

  console.log(
    `[sm8 sync] job ${jobUuid}: ${materials.length} API material record(s), ${activeMaterials.length} active material record(s)`
  );

  return activeMaterials;
}

// ------------------------------------------------------------
// JOB MATERIALS - BATCH
// ------------------------------------------------------------
//
// Fetches materials one job at a time sequentially.
//
// ServiceM8 has relatively tight API rate limits, so
// we deliberately avoid concurrent requests.
//
// ------------------------------------------------------------

const MATERIALS_FETCH_PAUSE_MS = 600;

const MAX_CONSECUTIVE_FAILURES = 3;

export async function fetchJobMaterialsForJobs(
  accessToken,
  jobUuids,
  deadlineMs
) {
  const shuffled = [...jobUuids];

  // Shuffle so repeated sync attempts don't
  // repeatedly stall on the same job.
  for (
    let i = shuffled.length - 1;
    i > 0;
    i--
  ) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [
      shuffled[i],
      shuffled[j],
    ] = [
      shuffled[j],
      shuffled[i],
    ];
  }

  const results = [];

  let consecutiveFailures = 0;

  for (
    let i = 0;
    i < shuffled.length;
    i++
  ) {
    if (
      deadlineMs &&
      Date.now() > deadlineMs
    ) {
      console.log(
        `[sm8 sync] materials fetch hit its time budget — stopping early, ${
          shuffled.length - i
        } job(s) left unfetched this run.`
      );

      break;
    }

    try {
      const materials =
        await fetchJobMaterialsForJob(
          accessToken,
          shuffled[i]
        );

      results.push(...materials);

      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures++;

      console.log(
        `[sm8 sync] skipped materials for job ${
          shuffled[i]
        } after fetch failure: ${
          e.message
        }`
      );

      if (
        consecutiveFailures >=
        MAX_CONSECUTIVE_FAILURES
      ) {
        console.log(
          `[sm8 sync] ${consecutiveFailures} consecutive material-fetch failures — stopping early, ${
            shuffled.length - i - 1
          } job(s) left unfetched this run.`
        );

        break;
      }
    }

    if (
      i < shuffled.length - 1
    ) {
      await sleep(
        MATERIALS_FETCH_PAUSE_MS
      );
    }
  }

  return results;
}

// ------------------------------------------------------------
// COMPANIES
// ------------------------------------------------------------

export function fetchCompanies(
  accessToken
) {
  return sm8Fetch(
    "company.json",
    accessToken
  );
}

// ------------------------------------------------------------
// MATERIAL CATALOG
// ------------------------------------------------------------
//
// ServiceM8's material catalog contains the
// actual item_number.
//
// Example:
//
// material_uuid
//       ↓
// material.json
//       ↓
// item_number
//       ↓
// TYWRAP8MOUNTBLK
//
// ------------------------------------------------------------

export function fetchMaterialsCatalog(
  accessToken
) {
  return sm8Fetch(
    "material.json",
    accessToken
  );
}