// SERVER-ONLY.
// Talks to ServiceM8 using the organization's stored OAuth tokens.
// Never import this from a "use client" component.

const TOKEN_URL =
  "https://go.servicem8.com/oauth/access_token";

const API_BASE =
  "https://api.servicem8.com/api_1.0";

/* ============================================================
   SERVICE M8 REQUEST CONTROL
   ============================================================

   IMPORTANT:

   ServiceM8 has a per-minute API request limit.

   We intentionally use a conservative request interval.

   We DO NOT aggressively retry 429 responses.

   When ServiceM8 says we are rate limited, we stop the
   current material fetch and let the sync checkpoint
   resume later.
   ============================================================ */

const REQUEST_MIN_INTERVAL_MS = 1_500;

const RATE_LIMIT_COOLDOWN_MS = 15_000;

/* ============================================================
   LOCAL REQUEST PACER
   ============================================================

   This protects requests made inside the same server instance.

   IMPORTANT:
   This is NOT the distributed lock.

   The sync route must also prevent two sync executions from
   running at the same time.
   ============================================================ */

let lastRequestStartedAt = 0;

let requestQueue = Promise.resolve();

/* ============================================================
   HELPERS
   ============================================================ */

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

/* ============================================================
   LOCAL REQUEST QUEUE
   ============================================================ */

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
   * Keep the queue alive even when a request fails.
   */
  requestQueue = run.catch(() => {});

  return run;
}

/* ============================================================
   OAUTH TOKEN
   ============================================================ */

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

/* ============================================================
   SERVICE M8 FETCH
   ============================================================

   IMPORTANT:

   A 429 is NOT retried repeatedly.

   We return a special error so the sync route can stop safely.
   ============================================================ */

async function sm8Fetch(
  path,
  accessToken
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

      /* ======================================================
         RATE LIMITED
         ====================================================== */

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

        const retryAfterMs =
          Number.isFinite(
            retryAfterSeconds
          ) &&
          retryAfterSeconds > 0
            ? retryAfterSeconds *
              1000
            : RATE_LIMIT_COOLDOWN_MS;

        console.warn(
          `[ServiceM8] RATE LIMITED (429) on ${path}. Retry-After: ${retryAfterMs}ms`
        );

        throw new Error(
          `SERVICEM8_RATE_LIMITED|${Math.max(
            retryAfterMs,
            RATE_LIMIT_COOLDOWN_MS
          )}|${path}`
        );
      }

      /* ======================================================
         OTHER HTTP ERRORS
         ====================================================== */

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

/* ============================================================
   JOBS
   ============================================================ */

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

/* ============================================================
   SINGLE JOB MATERIALS
   ============================================================ */

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

/* ============================================================
   JOB MATERIAL BATCH
   ============================================================

   IMPORTANT:

   We deliberately process ONE job at a time.

   There is NO Promise.all() here.
   There is NO concurrency.

   If ServiceM8 returns 429:

   - stop immediately
   - preserve completed jobs
   - return failed job
   - route must NOT advance past that job
   ============================================================ */

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
    /* ======================================================
       TIME BUDGET
       ====================================================== */

    if (
      Date.now() -
        startedAt >=
      timeBudgetMs
    ) {
      console.warn(
        `[sm8 sync] material time budget reached at ${index}/${queue.length}`
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
      const errorMessage =
        e?.message ||
        "Unknown ServiceM8 material fetch error";

      /* ====================================================
         RATE LIMIT

         STOP immediately.

         Do NOT continue requesting more jobs.
         ==================================================== */

      if (
        errorMessage.startsWith(
          "SERVICEM8_RATE_LIMITED|"
        )
      ) {
        failedJobs.push({
          jobUuid,

          error:
            errorMessage,
        });

        console.warn(
          `[sm8 sync] ServiceM8 rate limit reached. Stopping material fetch at job ${index + 1}/${queue.length}.`
        );

        break;
      }

      /* ====================================================
         OTHER ERROR
         ==================================================== */

      failedJobs.push({
        jobUuid,

        error:
          errorMessage,
      });

      console.error(
        `[sm8 sync] material fetch failed for job ${jobUuid}:`,
        errorMessage
      );

      /*
       * Stop here as well.

       * This preserves a clean sequential checkpoint.
       */
      break;
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

/* ============================================================
   COMPANIES
   ============================================================ */

export function fetchCompanies(
  accessToken
) {
  return sm8Fetch(
    "company.json",
    accessToken
  );
}

/* ============================================================
   MATERIAL CATALOG
   ============================================================ */

export function fetchMaterialsCatalog(
  accessToken
) {
  return sm8Fetch(
    "material.json",
    accessToken
  );
}