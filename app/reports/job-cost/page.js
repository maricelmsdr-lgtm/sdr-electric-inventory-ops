"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  FileText,
  Search,
  X,
  BarChart3,
  Table2,
  Briefcase,
  DollarSign,
  TrendingUp,
  Package,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";

const PAGE_SIZES = [10, 25, 50, 100];

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function number(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function dateValue(value) {
  if (!value) return 0;

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function escapeCsv(value) {
  const text = String(value ?? "");

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], {
    type,
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function getFirstValue(object, keys, fallback = "") {
  for (const key of keys) {
    const value = object?.[key];

    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      return value;
    }
  }

  return fallback;
}

export default function JobCostReportPage() {
  const [orgId, setOrgId] = useState(null);

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [sortField, setSortField] = useState("date");
  const [sortDirection, setSortDirection] =
    useState("desc");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [viewMode, setViewMode] = useState("report");

  /*
   * =========================================================
   * AUTH
   * =========================================================
   */

  useEffect(() => {
    let cancelled = false;

    async function loadOrganization() {
      try {
        setLoading(true);
        setError("");

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) {
          throw authError;
        }

        if (!user) {
          window.location.href = "/login";
          return;
        }

        const {
          data: profile,
          error: profileError,
        } = await supabase
          .from("profiles")
          .select("org_id")
          .eq("id", user.id)
          .single();

        if (profileError) {
          throw profileError;
        }

        if (!profile?.org_id) {
          throw new Error(
            "No organization is assigned to this user."
          );
        }

        if (!cancelled) {
          setOrgId(profile.org_id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.message ||
              "Unable to load organization."
          );

          setLoading(false);
        }
      }
    }

    loadOrganization();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * =========================================================
   * LOAD JOBS
   * =========================================================
   */

  useEffect(() => {
    if (!orgId) return;

    let cancelled = false;

    async function loadJobs() {
      try {
        setLoading(true);
        setError("");

        const result = await supabase
          .from("jobs")
          .select(
            `
              *,
              job_line_items(*)
            `
          )
          .eq("org_id", orgId);

        if (result.error) {
          throw result.error;
        }

        if (!cancelled) {
          setJobs(result.data || []);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err?.message ||
              "Unable to load job cost data."
          );

          setJobs([]);
          setLoading(false);
        }
      }
    }

    loadJobs();

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  /*
   * =========================================================
   * NORMALIZE JOB DATA
   * =========================================================
   */

  const normalizedJobs = useMemo(() => {
    return jobs.map((job) => {
      const lineItems = Array.isArray(
        job.job_line_items
      )
        ? job.job_line_items
        : [];

      let materialCost = 0;
      let materialSales = 0;
      let materialQuantity = 0;

      for (const item of lineItems) {
        const qty = Number(
          getFirstValue(
            item,
            [
              "qty",
              "quantity",
              "used_qty",
            ],
            0
          )
        );

        const partCost = Number(
          getFirstValue(
            item,
            [
              "part_cost",
              "unit_cost",
              "cost",
              "unit_cost",
            ],
            0
          )
        );

        const saleCost = Number(
          getFirstValue(
            item,
            [
              "sale_cost",
              "unit_sale",
              "sale_price",
              "price",
            ],
            0
          )
        );

        materialQuantity += qty;

        materialCost +=
          qty * partCost;

        materialSales +=
          qty * saleCost;
      }

      /*
       * The existing application uses job_line_items
       * for the material cost / sales calculation.
       *
       * If a job has an explicit total field, we prefer
       * that as the job revenue when available.
       */

      const explicitRevenue = Number(
        getFirstValue(
          job,
          [
            "total",
            "total_amount",
            "invoice_total",
            "sale_total",
            "sales_total",
            "revenue",
            "amount",
          ],
          0
        )
      );

      const revenue =
        explicitRevenue > 0
          ? explicitRevenue
          : materialSales;

      const grossProfit =
        revenue - materialCost;

      const margin =
        revenue > 0
          ? (grossProfit / revenue) * 100
          : 0;

      const jobNumber = getFirstValue(
        job,
        [
          "job_number",
          "job_no",
          "job_code",
          "job_id",
          "number",
        ],
        job.id
      );

      const customer = getFirstValue(
        job,
        [
          "customer_name",
          "customer",
          "client_name",
          "client",
          "company_name",
        ],
        "Unknown Customer"
      );

      const status = getFirstValue(
        job,
        [
          "status",
          "job_status",
          "state",
        ],
        "Unknown"
      );

      const jobDate = getFirstValue(
        job,
        [
          "job_date",
          "date",
          "scheduled_date",
          "completed_at",
          "created_at",
        ],
        null
      );

      return {
        id: job.id,
        jobNumber,
        customer,
        status,
        jobDate,

        materialQuantity,
        materialCost,
        materialSales,

        revenue,
        grossProfit,
        margin,

        lineItemCount: lineItems.length,

        raw: job,
      };
    });
  }, [jobs]);

  /*
   * =========================================================
   * FILTER OPTIONS
   * =========================================================
   */

  const statusOptions = useMemo(() => {
    const statuses = new Set();

    for (const job of normalizedJobs) {
      if (job.status) {
        statuses.add(String(job.status));
      }
    }

    return Array.from(statuses).sort(
      (a, b) => a.localeCompare(b)
    );
  }, [normalizedJobs]);

  /*
   * =========================================================
   * FILTER DATA
   * =========================================================
   */

  const filteredJobs = useMemo(() => {
    const query =
      search.trim().toLowerCase();

    return normalizedJobs.filter((job) => {
      if (
        statusFilter &&
        String(job.status) !==
          String(statusFilter)
      ) {
        return false;
      }

      const jobDate =
        dateValue(job.jobDate);

      if (dateFrom) {
        const from =
          new Date(
            `${dateFrom}T00:00:00`
          ).getTime();

        if (jobDate < from) {
          return false;
        }
      }

      if (dateTo) {
        const to =
          new Date(
            `${dateTo}T23:59:59`
          ).getTime();

        if (jobDate > to) {
          return false;
        }
      }

      if (query) {
        const searchable = [
          job.jobNumber,
          job.customer,
          job.status,
        ]
          .join(" ")
          .toLowerCase();

        if (
          !searchable.includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    normalizedJobs,
    statusFilter,
    dateFrom,
    dateTo,
    search,
  ]);

  /*
   * =========================================================
   * SUMMARY
   * =========================================================
   */

  const totalJobs = filteredJobs.length;

  const totalRevenue = useMemo(
    () =>
      filteredJobs.reduce(
        (sum, job) =>
          sum + job.revenue,
        0
      ),
    [filteredJobs]
  );

  const totalMaterialCost = useMemo(
    () =>
      filteredJobs.reduce(
        (sum, job) =>
          sum + job.materialCost,
        0
      ),
    [filteredJobs]
  );

  const totalProfit =
    totalRevenue -
    totalMaterialCost;

  const overallMargin =
    totalRevenue > 0
      ? (totalProfit / totalRevenue) *
        100
      : 0;

  const totalMaterialQuantity =
    filteredJobs.reduce(
      (sum, job) =>
        sum + job.materialQuantity,
      0
    );

  /*
   * =========================================================
   * SORT
   * =========================================================
   */

  const sortedJobs = useMemo(() => {
    const rows = [...filteredJobs];

    rows.sort((a, b) => {
      let av;
      let bv;

      switch (sortField) {
        case "job":
          av = a.jobNumber;
          bv = b.jobNumber;
          break;

        case "customer":
          av = a.customer;
          bv = b.customer;
          break;

        case "status":
          av = a.status;
          bv = b.status;
          break;

        case "date":
          av = dateValue(a.jobDate);
          bv = dateValue(b.jobDate);
          break;

        case "materials":
          av = a.materialCost;
          bv = b.materialCost;
          break;

        case "revenue":
          av = a.revenue;
          bv = b.revenue;
          break;

        case "profit":
          av = a.grossProfit;
          bv = b.grossProfit;
          break;

        case "margin":
          av = a.margin;
          bv = b.margin;
          break;

        default:
          av = dateValue(a.jobDate);
          bv = dateValue(b.jobDate);
      }

      if (
        typeof av === "number" &&
        typeof bv === "number"
      ) {
        return sortDirection === "asc"
          ? av - bv
          : bv - av;
      }

      return sortDirection === "asc"
        ? String(av ?? "").localeCompare(
            String(bv ?? "")
          )
        : String(bv ?? "").localeCompare(
            String(av ?? "")
          );
    });

    return rows;
  }, [
    filteredJobs,
    sortField,
    sortDirection,
  ]);

  function handleSort(field) {
    if (sortField === field) {
      setSortDirection(
        (current) =>
          current === "asc"
            ? "desc"
            : "asc"
      );

      return;
    }

    setSortField(field);
    setSortDirection("asc");
  }

  function sortIndicator(field) {
    if (sortField !== field) {
      return "↕";
    }

    return sortDirection === "asc"
      ? "↑"
      : "↓";
  }

  /*
   * =========================================================
   * PAGINATION
   * =========================================================
   */

  const totalPages = Math.max(
    1,
    Math.ceil(
      sortedJobs.length / pageSize
    )
  );

  const safePage = Math.min(
    page,
    totalPages
  );

  const pageRows = useMemo(() => {
    const start =
      (safePage - 1) * pageSize;

    return sortedJobs.slice(
      start,
      start + pageSize
    );
  }, [
    sortedJobs,
    safePage,
    pageSize,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    statusFilter,
    dateFrom,
    dateTo,
    pageSize,
  ]);

  /*
   * =========================================================
   * GRAPH DATA
   * =========================================================
   */

  const topJobsByCost = useMemo(() => {
    return [...filteredJobs]
      .sort(
        (a, b) =>
          b.materialCost -
          a.materialCost
      )
      .slice(0, 15);
  }, [filteredJobs]);

  const maxJobCost = Math.max(
    ...topJobsByCost.map(
      (job) => job.materialCost
    ),
    1
  );

  const profitabilityJobs = useMemo(() => {
    return [...filteredJobs]
      .sort(
        (a, b) =>
          b.grossProfit -
          a.grossProfit
      )
      .slice(0, 15);
  }, [filteredJobs]);

  const maxProfit = Math.max(
    ...profitabilityJobs.map(
      (job) =>
        Math.abs(job.grossProfit)
    ),
    1
  );

  /*
   * =========================================================
   * EXPORT CSV
   * =========================================================
   */

  function exportExcel() {
    const rows = [
      [
        "Job Number",
        "Customer",
        "Date",
        "Status",
        "Material Qty",
        "Material Cost",
        "Revenue",
        "Gross Profit",
        "Gross Margin %",
      ],

      ...sortedJobs.map((job) => [
        job.jobNumber,
        job.customer,
        formatDate(job.jobDate),
        job.status,
        job.materialQuantity,
        job.materialCost,
        job.revenue,
        job.grossProfit,
        job.margin / 100,
      ]),
    ];

    const csv = rows
      .map((row) =>
        row.map(escapeCsv).join(",")
      )
      .join("\n");

    downloadFile(
      csv,
      `job-cost-report-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`,
      "text/csv;charset=utf-8;"
    );
  }

  /*
   * =========================================================
   * EXPORT PDF
   * =========================================================
   */

  function exportPdf() {
    const printWindow =
      window.open(
        "",
        "_blank",
        "width=1300,height=900"
      );

    if (!printWindow) {
      alert(
        "Please allow popups to export the report."
      );

      return;
    }

    const rowsHtml =
      sortedJobs
        .map(
          (job) => `
            <tr>
              <td>${escapeHtml(
                job.jobNumber
              )}</td>

              <td>${escapeHtml(
                job.customer
              )}</td>

              <td>${escapeHtml(
                formatDate(
                  job.jobDate
                )
              )}</td>

              <td>${escapeHtml(
                job.status
              )}</td>

              <td class="number">
                ${number(
                  job.materialQuantity
                )}
              </td>

              <td class="number">
                ${money(
                  job.materialCost
                )}
              </td>

              <td class="number">
                ${money(job.revenue)}
              </td>

              <td class="number">
                ${money(
                  job.grossProfit
                )}
              </td>

              <td class="number">
                ${percent(job.margin)}
              </td>
            </tr>
          `
        )
        .join("");

    printWindow.document.write(`
      <!doctype html>

      <html>

        <head>

          <title>Job Cost Report</title>

          <style>

            * {
              box-sizing: border-box;
            }

            body {
              font-family: Arial, sans-serif;
              padding: 32px;
              color: #111827;
            }

            h1 {
              margin: 0 0 8px;
              font-size: 24px;
            }

            h2 {
              margin: 28px 0 12px;
              font-size: 16px;
            }

            .meta {
              color: #6b7280;
              font-size: 12px;
              margin-bottom: 24px;
            }

            .summary {
              display: flex;
              gap: 16px;
              margin-bottom: 24px;
            }

            .card {
              flex: 1;
              border: 1px solid #e5e7eb;
              border-radius: 8px;
              padding: 14px;
            }

            .label {
              color: #6b7280;
              font-size: 11px;
              margin-bottom: 6px;
            }

            .value {
              font-size: 20px;
              font-weight: 700;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 10px;
            }

            th {
              background: #f3f4f6;
              text-align: left;
              font-weight: 700;
            }

            th,
            td {
              border: 1px solid #e5e7eb;
              padding: 7px;
            }

            .number {
              text-align: right;
            }

            @media print {

              body {
                padding: 0;
              }

            }

          </style>

        </head>

        <body>

          <h1>
            Job Cost Report
          </h1>

          <div class="meta">
            Generated ${escapeHtml(
              new Date().toLocaleString()
            )}
          </div>

          <div class="summary">

            <div class="card">

              <div class="label">
                Jobs
              </div>

              <div class="value">
                ${number(totalJobs)}
              </div>

            </div>

            <div class="card">

              <div class="label">
                Revenue
              </div>

              <div class="value">
                ${money(totalRevenue)}
              </div>

            </div>

            <div class="card">

              <div class="label">
                Material Cost
              </div>

              <div class="value">
                ${money(
                  totalMaterialCost
                )}
              </div>

            </div>

            <div class="card">

              <div class="label">
                Gross Profit
              </div>

              <div class="value">
                ${money(totalProfit)}
              </div>

            </div>

            <div class="card">

              <div class="label">
                Gross Margin
              </div>

              <div class="value">
                ${percent(
                  overallMargin
                )}
              </div>

            </div>

          </div>

          <h2>
            Job Cost Detail
          </h2>

          <table>

            <thead>

              <tr>

                <th>Job Number</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Status</th>
                <th>Material Qty</th>
                <th>Material Cost</th>
                <th>Revenue</th>
                <th>Gross Profit</th>
                <th>Margin</th>

              </tr>

            </thead>

            <tbody>

              ${rowsHtml}

            </tbody>

          </table>

        </body>

      </html>
    `);

    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
    }, 300);
  }

  /*
   * =========================================================
   * CLEAR FILTERS
   * =========================================================
   */

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  /*
   * =========================================================
   * LOADING
   * =========================================================
   */

  if (!orgId && loading) {
    return (
      <Nav title="Job Cost Report">

        <div className="min-h-full bg-slate-950 p-6">

          <div className="flex min-h-[300px] items-center justify-center">

            <div className="text-xs uppercase tracking-widest text-slate-500">
              Loading job cost report...
            </div>

          </div>

        </div>

      </Nav>
    );
  }

  /*
   * =========================================================
   * PAGE
   * =========================================================
   */

  return (
    <Nav title="Job Cost Report">

      <div className="min-h-full bg-slate-950 p-4 md:p-6">

        {/* HEADER */}

        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

          <div>

            <h1 className="text-xl font-semibold tracking-wide text-slate-100">
              Job Cost Report
            </h1>

            <p className="mt-1 text-xs text-slate-500">
              Track job revenue, material costs and gross profitability.
            </p>

          </div>

          <div className="flex gap-2">

            <button
              type="button"
              onClick={exportExcel}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >

              <Download size={15} />

              Export Excel

            </button>

            <button
              type="button"
              onClick={exportPdf}
              className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-500"
            >

              <FileText size={15} />

              Export PDF

            </button>

          </div>

        </div>

        {/* ERROR */}

        {error && (

          <div className="mb-5 rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-400">

            <div className="font-semibold">
              Unable to load job cost report
            </div>

            <div className="mt-1 text-xs text-red-400/80">
              {error}
            </div>

          </div>

        )}

        {/* KPI CARDS */}

        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">

            <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Total Jobs
            </div>

            <div className="flex items-center justify-between">

              <div className="text-2xl font-semibold text-slate-100">
                {number(totalJobs)}
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
                <Briefcase size={18} />
              </div>

            </div>

          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">

            <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Revenue
            </div>

            <div className="flex items-center justify-between">

              <div className="text-2xl font-semibold text-emerald-400">
                {money(totalRevenue)}
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                <DollarSign size={18} />
              </div>

            </div>

          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">

            <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Material Cost
            </div>

            <div className="flex items-center justify-between">

              <div className="text-2xl font-semibold text-orange-400">
                {money(
                  totalMaterialCost
                )}
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500/10 text-orange-400">
                <Package size={18} />
              </div>

            </div>

          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">

            <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Gross Profit
            </div>

            <div className="flex items-center justify-between">

              <div
                className={`text-2xl font-semibold ${
                  totalProfit >= 0
                    ? "text-emerald-400"
                    : "text-red-400"
                }`}
              >
                {money(totalProfit)}
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-500/10 text-purple-400">
                <TrendingUp size={18} />
              </div>

            </div>

          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">

            <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Gross Margin
            </div>

            <div className="flex items-center justify-between">

              <div
                className={`text-2xl font-semibold ${
                  overallMargin >= 0
                    ? "text-emerald-400"
                    : "text-red-400"
                }`}
              >
                {percent(
                  overallMargin
                )}
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-400">
                <BarChart3 size={18} />
              </div>

            </div>

          </div>

        </div>

        {/* FILTERS */}

        <div className="mb-5 rounded-lg border border-slate-800 bg-slate-900/50 p-4">

          <div className="mb-4 text-xs font-medium uppercase tracking-widest text-slate-400">
            Filters
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">

            {/* SEARCH */}

            <div>

              <label className="mb-1.5 block text-xs text-slate-400">
                Search
              </label>

              <div className="relative">

                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
                />

                <input
                  value={search}
                  onChange={(event) =>
                    setSearch(
                      event.target.value
                    )
                  }
                  placeholder="Job number or customer..."
                  className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-orange-500"
                />

              </div>

            </div>

            {/* STATUS */}

            <div>

              <label className="mb-1.5 block text-xs text-slate-400">
                Status
              </label>

              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value
                  )
                }
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-orange-500"
              >

                <option value="">
                  All Statuses
                </option>

                {statusOptions.map(
                  (status) => (
                    <option
                      key={status}
                      value={status}
                    >
                      {status}
                    </option>
                  )
                )}

              </select>

            </div>

            {/* FROM */}

            <div>

              <label className="mb-1.5 block text-xs text-slate-400">
                Date From
              </label>

              <input
                type="date"
                value={dateFrom}
                onChange={(event) =>
                  setDateFrom(
                    event.target.value
                  )
                }
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-orange-500"
              />

            </div>

            {/* TO */}

            <div>

              <label className="mb-1.5 block text-xs text-slate-400">
                Date To
              </label>

              <input
                type="date"
                value={dateTo}
                onChange={(event) =>
                  setDateTo(
                    event.target.value
                  )
                }
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-orange-500"
              />

            </div>

          </div>

          {(search ||
            statusFilter ||
            dateFrom ||
            dateTo) && (

            <div className="mt-4 flex justify-end">

              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-orange-400"
              >

                <X size={13} />

                Clear Filters

              </button>

            </div>

          )}

        </div>

        {/* PROFITABILITY SUMMARY */}

        <div className="mb-5 rounded-lg border border-slate-800 bg-slate-900/30 p-5">

          <div className="mb-5">

            <h2 className="text-sm font-medium text-slate-200">
              Cost vs Revenue
            </h2>

            <p className="mt-1 text-xs text-slate-500">
              Overall material cost compared with job revenue.
            </p>

          </div>

          <div className="space-y-4">

            <div>

              <div className="mb-2 flex justify-between text-xs">

                <span className="text-slate-400">
                  Material Cost
                </span>

                <span className="font-mono text-orange-400">
                  {money(
                    totalMaterialCost
                  )}
                </span>

              </div>

              <div className="h-3 overflow-hidden rounded-full bg-slate-800">

                <div
                  className="h-full rounded-full bg-orange-500"
                  style={{
                    width: `${
                      totalRevenue > 0
                        ? Math.min(
                            100,
                            (totalMaterialCost /
                              totalRevenue) *
                              100
                          )
                        : 0
                    }%`,
                  }}
                />

              </div>

            </div>

            <div>

              <div className="mb-2 flex justify-between text-xs">

                <span className="text-slate-400">
                  Gross Profit
                </span>

                <span className="font-mono text-emerald-400">
                  {money(totalProfit)}
                </span>

              </div>

              <div className="h-3 overflow-hidden rounded-full bg-slate-800">

                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{
                    width: `${
                      totalRevenue > 0
                        ? Math.min(
                            100,
                            Math.max(
                              0,
                              (totalProfit /
                                totalRevenue) *
                                100
                            )
                          )
                        : 0
                    }%`,
                  }}
                />

              </div>

            </div>

          </div>

          <div className="mt-4 flex justify-between border-t border-slate-800 pt-4 text-xs">

            <span className="text-slate-500">
              Material usage
            </span>

            <span className="font-mono text-slate-300">
              {number(
                totalMaterialQuantity
              )} units
            </span>

          </div>

        </div>

        {/* VIEW SWITCHER */}

        <div className="mb-4 flex items-center justify-between">

          <div>

            <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Job Cost Analysis
            </div>

            <div className="mt-1 text-xs text-slate-600">
              {viewMode === "report"
                ? "Detailed job profitability"
                : "Visual job cost analysis"}
            </div>

          </div>

          <div className="flex overflow-hidden rounded-md border border-slate-800 bg-slate-950">

            <button
              type="button"
              onClick={() =>
                setViewMode("report")
              }
              className={`inline-flex items-center gap-2 px-3 py-2 text-xs transition ${
                viewMode === "report"
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >

              <Table2 size={14} />

              Report View

            </button>

            <button
              type="button"
              onClick={() =>
                setViewMode("graph")
              }
              className={`inline-flex items-center gap-2 px-3 py-2 text-xs transition ${
                viewMode === "graph"
                  ? "bg-orange-600 text-white"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >

              <BarChart3 size={14} />

              Graph View

            </button>

          </div>

        </div>

        {/* =====================================================
            REPORT VIEW
            ===================================================== */}

        {viewMode === "report" ? (

          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">

            <div className="border-b border-slate-800 px-4 py-3">

              <div className="text-xs text-slate-400">

                Showing{" "}

                <span className="font-medium text-slate-200">
                  {sortedJobs.length}
                </span>{" "}

                jobs

              </div>

            </div>

            <div className="overflow-x-auto">

              <table className="w-full min-w-[1100px]">

                <thead>

                  <tr className="border-b border-slate-800 bg-slate-950/70">

                    <th
                      onClick={() =>
                        handleSort("job")
                      }
                      className="cursor-pointer px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                    >
                      Job #{" "}
                      {sortIndicator("job")}
                    </th>

                    <th
                      onClick={() =>
                        handleSort(
                          "customer"
                        )
                      }
                      className="cursor-pointer px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                    >
                      Customer{" "}
                      {sortIndicator(
                        "customer"
                      )}
                    </th>

                    <th
                      onClick={() =>
                        handleSort("date")
                      }
                      className="cursor-pointer px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                    >
                      Date{" "}
                      {sortIndicator("date")}
                    </th>

                    <th
                      onClick={() =>
                        handleSort("status")
                      }
                      className="cursor-pointer px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                    >
                      Status{" "}
                      {sortIndicator(
                        "status"
                      )}
                    </th>

                    <th
                      onClick={() =>
                        handleSort("materials")
                      }
                      className="cursor-pointer px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                    >
                      Material Cost{" "}
                      {sortIndicator(
                        "materials"
                      )}
                    </th>

                    <th
                      onClick={() =>
                        handleSort("revenue")
                      }
                      className="cursor-pointer px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                    >
                      Revenue{" "}
                      {sortIndicator(
                        "revenue"
                      )}
                    </th>

                    <th
                      onClick={() =>
                        handleSort("profit")
                      }
                      className="cursor-pointer px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                    >
                      Gross Profit{" "}
                      {sortIndicator(
                        "profit"
                      )}
                    </th>

                    <th
                      onClick={() =>
                        handleSort("margin")
                      }
                      className="cursor-pointer px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                    >
                      Margin{" "}
                      {sortIndicator(
                        "margin"
                      )}
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {loading ? (

                    <tr>

                      <td
                        colSpan={8}
                        className="px-4 py-12 text-center text-xs text-slate-600"
                      >
                        Loading job cost report...
                      </td>

                    </tr>

                  ) : pageRows.length === 0 ? (

                    <tr>

                      <td
                        colSpan={8}
                        className="px-4 py-12 text-center text-xs text-slate-600"
                      >
                        No job cost data available.
                      </td>

                    </tr>

                  ) : (

                    pageRows.map((job) => (

                      <tr
                        key={job.id}
                        className="border-b border-slate-800/70 transition hover:bg-slate-900/70"
                      >

                        <td className="px-4 py-3 font-mono text-xs font-medium text-slate-200">
                          {job.jobNumber}
                        </td>

                        <td className="px-4 py-3 text-xs text-slate-300">
                          {job.customer}
                        </td>

                        <td className="px-4 py-3 text-xs text-slate-400">
                          {formatDate(
                            job.jobDate
                          )}
                        </td>

                        <td className="px-4 py-3">

                          <span className="inline-flex rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-400">
                            {job.status}
                          </span>

                        </td>

                        <td className="px-4 py-3 text-right font-mono text-xs text-orange-400">
                          {money(
                            job.materialCost
                          )}
                        </td>

                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-300">
                          {money(
                            job.revenue
                          )}
                        </td>

                        <td
                          className={`px-4 py-3 text-right font-mono text-xs font-medium ${
                            job.grossProfit >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {money(
                            job.grossProfit
                          )}
                        </td>

                        <td
                          className={`px-4 py-3 text-right font-mono text-xs font-medium ${
                            job.margin >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {percent(
                            job.margin
                          )}
                        </td>

                      </tr>

                    ))

                  )}

                </tbody>

              </table>

            </div>

            {/* PAGINATION */}

            <div className="flex flex-col gap-3 border-t border-slate-800 px-4 py-3 md:flex-row md:items-center md:justify-between">

              <div className="text-xs text-slate-500">

                Showing{" "}

                {sortedJobs.length === 0
                  ? 0
                  : (safePage - 1) *
                      pageSize +
                    1}

                {" "}to{" "}

                {Math.min(
                  safePage * pageSize,
                  sortedJobs.length
                )}

                {" "}of{" "}

                {sortedJobs.length} jobs

              </div>

              <div className="flex items-center gap-2">

                <select
                  value={pageSize}
                  onChange={(event) =>
                    setPageSize(
                      Number(
                        event.target.value
                      )
                    )
                  }
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300 outline-none"
                >

                  {PAGE_SIZES.map(
                    (size) => (
                      <option
                        key={size}
                        value={size}
                      >
                        {size} per page
                      </option>
                    )
                  )}

                </select>

                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() =>
                    setPage(1)
                  }
                  className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 hover:text-slate-200"
                >
                  First
                </button>

                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() =>
                    setPage((current) =>
                      Math.max(
                        1,
                        current - 1
                      )
                    )
                  }
                  className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 hover:text-slate-200"
                >
                  Previous
                </button>

                <div className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
                  {safePage}
                </div>

                <button
                  type="button"
                  disabled={
                    safePage >=
                    totalPages
                  }
                  onClick={() =>
                    setPage((current) =>
                      Math.min(
                        totalPages,
                        current + 1
                      )
                    )
                  }
                  className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 hover:text-slate-200"
                >
                  Next
                </button>

                <button
                  type="button"
                  disabled={
                    safePage >=
                    totalPages
                  }
                  onClick={() =>
                    setPage(totalPages)
                  }
                  className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 hover:text-slate-200"
                >
                  Last
                </button>

              </div>

            </div>

          </div>

        ) : (

          /* ===================================================
             GRAPH VIEW
             =================================================== */

          <div className="space-y-5">

            {/* TOP JOBS BY MATERIAL COST */}

            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5">

              <div className="mb-6">

                <h2 className="text-sm font-medium text-slate-200">
                  Material Cost by Job
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Jobs with the highest material cost.
                </p>

              </div>

              {topJobsByCost.length === 0 ? (

                <div className="flex min-h-[250px] items-center justify-center text-xs text-slate-600">
                  No job cost data available.
                </div>

              ) : (

                <div className="space-y-5">

                  {topJobsByCost.map(
                    (job) => {

                      const width =
                        Math.max(
                          2,
                          (job.materialCost /
                            maxJobCost) *
                            100
                        );

                      return (

                        <div
                          key={job.id}
                        >

                          <div className="mb-2 flex items-end justify-between gap-4">

                            <div className="min-w-0">

                              <div className="truncate text-xs font-medium text-slate-200">
                                {job.jobNumber}
                              </div>

                              <div className="mt-1 truncate text-[10px] text-slate-600">
                                {job.customer}
                              </div>

                            </div>

                            <div className="shrink-0 font-mono text-xs font-medium text-orange-400">
                              {money(
                                job.materialCost
                              )}
                            </div>

                          </div>

                          <div className="h-4 overflow-hidden rounded-full bg-slate-800">

                            <div
                              className="h-full rounded-full bg-orange-500 transition-all duration-500"
                              style={{
                                width: `${width}%`,
                              }}
                            />

                          </div>

                        </div>

                      );
                    }
                  )}

                </div>

              )}

            </div>

            {/* PROFITABILITY */}

            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-5">

              <div className="mb-6">

                <h2 className="text-sm font-medium text-slate-200">
                  Gross Profit by Job
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Jobs ranked by gross profit after material cost.
                </p>

              </div>

              {profitabilityJobs.length === 0 ? (

                <div className="flex min-h-[250px] items-center justify-center text-xs text-slate-600">
                  No profitability data available.
                </div>

              ) : (

                <div className="space-y-5">

                  {profitabilityJobs.map(
                    (job) => {

                      const width =
                        Math.max(
                          2,
                          (Math.abs(
                            job.grossProfit
                          ) /
                            maxProfit) *
                            100
                        );

                      const positive =
                        job.grossProfit >=
                        0;

                      return (

                        <div
                          key={job.id}
                        >

                          <div className="mb-2 flex items-end justify-between gap-4">

                            <div className="min-w-0">

                              <div className="truncate text-xs font-medium text-slate-200">
                                {job.jobNumber}
                              </div>

                              <div className="mt-1 truncate text-[10px] text-slate-600">
                                {job.customer}
                              </div>

                            </div>

                            <div
                              className={`shrink-0 font-mono text-xs font-medium ${
                                positive
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              {money(
                                job.grossProfit
                              )}

                              <span className="ml-2 text-slate-600">
                                {percent(
                                  job.margin
                                )}
                              </span>

                            </div>

                          </div>

                          <div className="h-4 overflow-hidden rounded-full bg-slate-800">

                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                positive
                                  ? "bg-emerald-500"
                                  : "bg-red-500"
                              }`}
                              style={{
                                width: `${width}%`,
                              }}
                            />

                          </div>

                        </div>

                      );
                    }
                  )}

                </div>

              )}

            </div>

          </div>

        )}

      </div>

    </Nav>
  );
}