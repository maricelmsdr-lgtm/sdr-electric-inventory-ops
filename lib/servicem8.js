// SERVER-ONLY.
// Talks to ServiceM8 using the organization's stored OAuth tokens.
// Never import this from a "use client" component.

const TOKEN_URL =
  "https://go.servicem8.com/oauth/access_token";

const API_BASE =
  "https://api.servicem8.com/api_1.0";

/*
|--------------------------------------------------------------------------
| SERVICE M8 RATE LIMIT PROTECTION
|--------------------------------------------------------------------------
|
| ServiceM8 allows up to 180 requests/minute per
| application/account pairing.
|
| We intentionally stay far below that limit.
|
| IMPORTANT:
| Do NOT increase these values unless necessary.
|
|--------------------------------------------------------------------------
*/

const REQUEST_MIN_INTERVAL_MS = 450;

const MAX_429_RETRIES = 4;

const DEFAULT_429_WAIT_MS = 5000;

let lastRequestStartedAt = 0;

let requestQueue = Promise.resolve();

/*
|--------------------------------------------------------------------------
| BASIC HELPERS
|--------------------------------------------------------------------------
*/

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeErrorBody(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/*
|--------------------------------------------------------------------------
| GLOBAL REQUEST PACER
|--------------------------------------------------------------------------
|
| All ServiceM8 requests pass through this queue.
|
| This prevents Promise.all() from immediately firing
| multiple API requests at once.
|
|--------------------------------------------------------------------------
*/

function queueServiceM8Request(task) {
  const run = requestQueue.then(async () => {
    const now = Date.now();

    const elapsed =
      now - lastRequestStartedAt;

    if (
      elapsed <
      REQUEST_MIN_INTERVAL_MS
    ) {
      await sleep(
        REQUEST_MIN_INTERVAL_MS -
          elapsed
      );
    }

    lastRequestStartedAt =
      Date.now();

    return task();
  });

  /*
   * Keep the queue alive even if one request fails.
   */
  requestQueue = run.catch(() => {});

  return run;
}

/*
|--------------------------------------------------------------------------
| OAUTH TOKEN
|--------------------------------------------------------------------------
*/

export async function getValidAccessToken(
  admin,
  integrationId
) {
  const {
    data: tok,
    error,
  } = await admin
    .from("integration_tokens")
    .select("*")
    .eq(
      "integration_id",
      integrationId
    )
    .single();

  if (error || !tok) {
    throw new Error(
      "No ServiceM8 tokens on file. Reconnect ServiceM8."
    );
  }

  const expiresAt = tok.expires_at
    ? new Date(
        tok.expires_at
      ).getTime()
    : 0;

  const expiringSoon =
    expiresAt - Date.now() <
    60_000;

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

  if (!appId || !appSecret) {
    throw new Error(
      "ServiceM8 OAuth credentials are missing from the server environment."
    );
  }

  const res = await fetch(
    TOKEN_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      body: new URLSearchParams({
        grant_type:
          "refresh_token",

        client_id:
          appId,

        client_secret:
          appSecret,

        refresh_token:
          tok.refresh_token,
      }),
    }
  );

  if (!res.ok) {
    const body =
      await res
        .text()
        .catch(() => "");

    throw new Error(
      `Couldn't refresh the ServiceM8 connection (${res.status}): ${normalizeErrorBody(
        body
      )}`
    );
  }

  const fresh =
    await res.json();

  if (
    !fresh?.access_token
  ) {
    throw new Error(
      "Couldn't refresh the ServiceM8 connection. Try disconnecting and reconnecting it."
    );
  }

  const newExpiresAt =
    new Date(
      Date.now() +
        (Number(
          fresh.expires_in
        ) || 3600) *
          1000
    ).toISOString();

  const {
    error: updateError,
  } = await admin
    .from(
      "integration_tokens"
    )
    .update({
      access_token:
        fresh.access_token,

      refresh_token:
        fresh.refresh_token ||
        tok.refresh_token,

      expires_at:
        newExpiresAt,
    })
    .eq(
      "integration_id",
      integrationId
    );

  if (updateError) {
    throw new Error(
      `Couldn't save refreshed ServiceM8 token: ${updateError.message}`
    );
  }

  return fresh.access_token;
}

/*
|--------------------------------------------------------------------------
| SERVICE M8 FETCH
|--------------------------------------------------------------------------
|
| Every request:
|
| 1. Goes through the global pacer.
| 2. Handles 429.
| 3. Uses Retry-After when supplied.
| 4. Uses exponential backoff.
| 5. Stops after a controlled number of retries.
|
|--------------------------------------------------------------------------
*/

async function sm8Fetch(
  path,
  accessToken,
  attempt = 1
) {
  return queueServiceM8Request(
    async () => {
      const res =
        await fetch(
          `${API_BASE}/${path}`,
          {
            method: "GET",

            headers: {
              Authorization:
                `Bearer ${accessToken}`,

              Accept:
                "application/json",
            },

            cache: "no-store",
          }
        );

      /*
      |--------------------------------------------------------------------------
      | RATE LIMIT
      |--------------------------------------------------------------------------
      */

      if (
        res.status === 429
      ) {
        const retryAfterHeader =
          res.headers.get(
            "retry-after"
          );

        const retryAfterSeconds =
          Number(
            retryAfterHeader
          );

        let waitMs;

        if (
          Number.isFinite(
            retryAfterSeconds
          ) &&
          retryAfterSeconds > 0
        ) {
          waitMs =
            retryAfterSeconds *
            1000;
        } else {
          /*
           * Exponential backoff:
           *
           * attempt 1 -> 5 sec
           * attempt 2 -> 10 sec
           * attempt 3 -> 20 sec
           * attempt 4 -> 40 sec
           */
          waitMs =
            DEFAULT_429_WAIT_MS *
            Math.pow(
              2,
              attempt - 1
            );
        }

        /*
         * Never wait less than 5 seconds
         * after a 429.
         */
        waitMs = Math.max(
          waitMs,
          DEFAULT_429_WAIT_MS
        );

        /*
         * Don't wait forever.
         */
        waitMs = Math.min(
          waitMs,
          45_000
        );

        console.warn(
          `[ServiceM8] 429 rate limit on ${path}. Retry ${attempt}/${MAX_429_RETRIES} after ${waitMs}ms.`
        );

        if (
          attempt >
          MAX_429_RETRIES
        ) {
          const body =
            await res
              .text()
              .catch(() => "");

          throw new Error(
            `ServiceM8 API rate limit exceeded after ${MAX_429_RETRIES} retries on ${path}: ${normalizeErrorBody(
              body
            )}`
          );
        }

        await sleep(
          waitMs
        );

        /*
         * Retry outside the current
         * queued request.
         */
        return sm8Fetch(
          path,
          accessToken,
          attempt + 1
        );
      }

      /*
      |--------------------------------------------------------------------------
      | OTHER HTTP ERRORS
      |--------------------------------------------------------------------------
      */

      if (!res.ok) {
        const body =
          await res
            .text()
            .catch(() => "");

        throw new Error(
          `ServiceM8 API error (${res.status}) on ${path}: ${normalizeErrorBody(
            body
          )}`
        );
      }

      return res.json();
    }
  );
}

/*
|--------------------------------------------------------------------------
| JOBS
|--------------------------------------------------------------------------
*/

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

  const filterValue =
    encodeURIComponent(
      `date gt '${sinceDate}'`
    );

  return sm8Fetch(
    `job.json?%24filter=${filterValue}`,
    accessToken
  );
}

/*
|--------------------------------------------------------------------------
| JOB MATERIALS — SINGLE JOB
|--------------------------------------------------------------------------
*/

export function fetchJobMaterialsForJob(
  accessToken,
  jobUuid
) {
  const filterValue =
    encodeURIComponent(
      `job_uuid eq '${jobUuid}'`
    );

  return sm8Fetch(
    `jobmaterial.json?%24filter=${filterValue}`,
    accessToken
  );
}

/*
|--------------------------------------------------------------------------
| JOB MATERIALS — CONTROLLED BATCH
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| We deliberately do NOT run several requests simultaneously.
|
| ServiceM8's limit is 180 requests/minute.
|
| With one request approximately every 450ms,
| we stay around 133 requests/minute maximum.
|
| This is intentionally conservative.
|
|--------------------------------------------------------------------------
*/

export async function fetchJobMaterialsForJobs(
  accessToken,
  jobUuids,
  options = {}
) {
  const timeBudgetMs =
    Math.max(
      5_000,
      Number(
        options.timeBudgetMs ||
          42_000
      )
    );

  const startedAt =
    Date.now();

  const materials = [];

  const completedJobUuids = [];

  const failedJobs = [];

  /*
   * IMPORTANT:
   *
   * Ignore concurrency > 1.
   *
   * Requests must be serialized so we
   * don't burst ServiceM8.
   */
  const queue = Array.isArray(
    jobUuids
  )
    ? jobUuids
    : [];

  for (
    let index = 0;
    index < queue.length;
    index++
  ) {
    /*
     * Stop before Vercel gets too close
     * to the function timeout.
     */
    if (
      Date.now() -
        startedAt >=
      timeBudgetMs
    ) {
      console.warn(
        `[sm8 sync] material fetch time budget reached after ${index}/${queue.length} jobs.`
      );

      break;
    }

    const jobUuid =
      queue[index];

    try {
      const jobMaterials =
        await fetchJobMaterialsForJob(
          accessToken,
          jobUuid
        );

      if (
        Array.isArray(
          jobMaterials
        )
      ) {
        materials.push(
          ...jobMaterials
        );
      }

      completedJobUuids.push(
        jobUuid
      );

      console.log(
        `[sm8 sync] material fetch ${index + 1}/${queue.length} complete`
      );
    } catch (e) {
      failedJobs.push({
        jobUuid,

        error:
          e?.message ||
          "Unknown ServiceM8 material fetch error",
      });

      console.error(
        `[sm8 sync] material fetch failed for job ${jobUuid}:`,
        e?.message ||
          e
      );

      /*
       * IMPORTANT:
       *
       * Do not stop the entire batch for one
       * failed job.
       *
       * The route will only advance through
       * the contiguous successful prefix.
       */
    }
  }

  const processedCount =
    completedJobUuids.length +
    failedJobs.length;

  const timedOut =
    processedCount <
      queue.length &&
    Date.now() -
      startedAt >=
      timeBudgetMs;

  return {
    materials,

    completedJobUuids,

    failedJobs,

    timedOut,
  };
}

/*
|--------------------------------------------------------------------------
| COMPANIES
|--------------------------------------------------------------------------
*/

export function fetchCompanies(
  accessToken
) {
  return sm8Fetch(
    "company.json",
    accessToken
  );
}

/*
|--------------------------------------------------------------------------
| MATERIAL CATALOG
|--------------------------------------------------------------------------
*/

export function fetchMaterialsCatalog(
  accessToken
) {
  return sm8Fetch(
    "material.json",
    accessToken
  );
}