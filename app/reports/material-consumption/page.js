"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  DollarSign,
  Package,
  TrendingDown,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, TradeBadge, money } from "@/components/ui";

const CATEGORIES = ["Electrical", "Plumbing", "HVAC", "General"];

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatCard({ icon: Icon, label, value, detail }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-slate-600">
            {label}
          </div>

          <div className="mt-2 text-xl font-semibold text-slate-100">
            {value}
          </div>

          {detail && (
            <div className="mt-1 text-[11px] text-slate-500">
              {detail}
            </div>
          )}
        </div>

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-orange-500/20 bg-orange-500/5">
          <Icon size={16} className="text-orange-400" />
        </div>
      </div>
    </div>
  );
}

export default function MaterialConsumptionReportPage() {
  const router = useRouter();

  const [orgId, setOrgId] = useState(null);

  const [parts, setParts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [lineItems, setLineItems] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");

  /*
   * ---------------------------------------------------------
   * AUTH
   * ---------------------------------------------------------
   */

  useEffect(() => {
    let mounted = true;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (!mounted) return;

      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }

      setOrgId(profile?.org_id || null);
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  /*
   * ---------------------------------------------------------
   * LOAD DATA
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (!orgId) return;

    let mounted = true;

    (async () => {
      setLoading(true);
      setError("");

      const [
        { data: partsData, error: partsError },
        { data: jobsData, error: jobsError },
        { data: lineData, error: lineError },
      ] = await Promise.all([
        supabase
          .from("parts")
          .select(
            "id, part_no, sku, description, category, qty, unit_cost, min_reorder"
          )
          .eq("org_id", orgId),

        supabase
          .from("jobs")
          .select("*")
          .eq("org_id", orgId),

        supabase
          .from("job_line_items")
          .select("*")
          .order("id", { ascending: true }),
      ]);

      if (!mounted) return;

      const firstError =
        partsError?.message ||
        jobsError?.message ||
        lineError?.message ||
        "";

      setError(firstError);

      setParts(partsData || []);
      setJobs(jobsData || []);
      setLineItems(lineData || []);

      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [orgId]);

  /*
   * ---------------------------------------------------------
   * MAPS
   * ---------------------------------------------------------
   */

  const partMap = useMemo(() => {
    const map = new Map();

    parts.forEach((part) => {
      map.set(part.id, part);
    });

    return map;
  }, [parts]);

  const jobMap = useMemo(() => {
    const map = new Map();

    jobs.forEach((job) => {
      map.set(job.id, job);
    });

    return map;
  }, [jobs]);

  /*
   * ---------------------------------------------------------
   * MATERIAL CONSUMPTION
   *
   * Every job line item represents material consumed/used
   * against a job.
   * ---------------------------------------------------------
   */

  const consumptionRows = useMemo(() => {
    return lineItems
      .map((line) => {
        const job = jobMap.get(line.job_id);
        const part = partMap.get(line.part_id);

        const qty = Number(line.qty || 0);
        const partCost = Number(line.part_cost || 0);
        const saleCost = Number(line.sale_cost || 0);

        return {
          ...line,
          job,
          part,
          qty,
          partCost,
          saleCost,
          materialCost: qty * partCost,
          materialRevenue: qty * saleCost,
          margin: qty * (saleCost - partCost),
        };
      })
      .filter((row) => row.part);
  }, [lineItems, jobMap, partMap]);

  /*
   * ---------------------------------------------------------
   * SEARCH / FILTER
   * ---------------------------------------------------------
   */

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return consumptionRows.filter((row) => {
      const part = row.part;

      const matchesSearch =
        !q ||
        String(part?.part_no || "")
          .toLowerCase()
          .includes(q) ||
        String(part?.sku || "")
          .toLowerCase()
          .includes(q) ||
        String(part?.description || "")
          .toLowerCase()
          .includes(q) ||
        String(row.job?.job_no || "")
          .toLowerCase()
          .includes(q) ||
        String(row.job?.job_number || "")
          .toLowerCase()
          .includes(q) ||
        String(row.job?.customer_name || "")
          .toLowerCase()
          .includes(q);

      const matchesCategory =
        categoryFilter === "All" ||
        part?.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [consumptionRows, search, categoryFilter]);

  /*
   * ---------------------------------------------------------
   * SUMMARY
   * ---------------------------------------------------------
   */

  const summary = useMemo(() => {
    const totalQty = filteredRows.reduce(
      (sum, row) => sum + row.qty,
      0
    );

    const materialCost = filteredRows.reduce(
      (sum, row) => sum + row.materialCost,
      0
    );

    const materialRevenue = filteredRows.reduce(
      (sum, row) => sum + row.materialRevenue,
      0
    );

    const margin = materialRevenue - materialCost;

    const uniqueParts = new Set(
      filteredRows
        .map((row) => row.part?.id)
        .filter(Boolean)
    ).size;

    const uniqueJobs = new Set(
      filteredRows
        .map((row) => row.job_id)
        .filter(Boolean)
    ).size;

    return {
      totalQty,
      materialCost,
      materialRevenue,
      margin,
      uniqueParts,
      uniqueJobs,
    };
  }, [filteredRows]);

  /*
   * ---------------------------------------------------------
   * PART CONSUMPTION SUMMARY
   * ---------------------------------------------------------
   */

  const partSummary = useMemo(() => {
    const map = new Map();

    filteredRows.forEach((row) => {
      const partId = row.part?.id;

      if (!partId) return;

      const existing = map.get(partId) || {
        part: row.part,
        qty: 0,
        cost: 0,
        revenue: 0,
        jobs: new Set(),
      };

      existing.qty += row.qty;
      existing.cost += row.materialCost;
      existing.revenue += row.materialRevenue;

      if (row.job_id) {
        existing.jobs.add(row.job_id);
      }

      map.set(partId, existing);
    });

    return [...map.values()]
      .map((row) => ({
        ...row,
        jobCount: row.jobs.size,
        margin: row.revenue - row.cost,
      }))
      .sort((a, b) => b.qty - a.qty);
  }, [filteredRows]);

  /*
   * ---------------------------------------------------------
   * CATEGORY SUMMARY
   * ---------------------------------------------------------
   */

  const categorySummary = useMemo(() => {
    const map = new Map();

    filteredRows.forEach((row) => {
      const category = row.part?.category || "General";

      const existing = map.get(category) || {
        category,
        qty: 0,
        cost: 0,
        revenue: 0,
      };

      existing.qty += row.qty;
      existing.cost += row.materialCost;
      existing.revenue += row.materialRevenue;

      map.set(category, existing);
    });

    return CATEGORIES.map((category) => {
      const row = map.get(category);

      return (
        row || {
          category,
          qty: 0,
          cost: 0,
          revenue: 0,
        }
      );
    }).filter((row) => row.qty > 0);
  }, [filteredRows]);

  const maxCategoryQty = Math.max(
    ...categorySummary.map((row) => row.qty),
    1
  );

  /*
   * ---------------------------------------------------------
   * TOP CONSUMED MATERIALS
   * ---------------------------------------------------------
   */

  const topMaterials = partSummary.slice(0, 8);

  const maxMaterialQty = Math.max(
    ...topMaterials.map((row) => row.qty),
    1
  );

  /*
   * ---------------------------------------------------------
   * RECENT CONSUMPTION
   * ---------------------------------------------------------
   */

  const recentRows = useMemo(() => {
    return [...filteredRows]
      .sort((a, b) => {
        const aDate =
          a.job?.completed_at ||
          a.job?.job_date ||
          a.job?.created_at ||
          "";

        const bDate =
          b.job?.completed_at ||
          b.job?.job_date ||
          b.job?.created_at ||
          "";

        return String(bDate).localeCompare(String(aDate));
      })
      .slice(0, 100);
  }, [filteredRows]);

  /*
   * ---------------------------------------------------------
   * LOADING
   * ---------------------------------------------------------
   */

  if (!orgId) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-xs uppercase tracking-widest text-slate-500">
          Loading...
        </div>
      </div>
    );
  }

  /*
   * ---------------------------------------------------------
   * PAGE
   * ---------------------------------------------------------
   */

  return (
    <Nav title="Material Consumption Report">
      <div className="min-h-full bg-slate-950 p-4 md:p-6 space-y-5">

        {/* HEADER */}

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/reports"
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-800 bg-slate-900 text-slate-500 transition hover:border-slate-700 hover:text-orange-400"
            >
              <ArrowLeft size={15} />
            </Link>

            <div>
              <h1 className="text-lg font-semibold tracking-wide text-slate-100">
                MATERIAL CONSUMPTION REPORT
              </h1>

              <p className="mt-1 text-xs text-slate-500">
                Analyze materials consumed through completed and active jobs,
                including quantities, costs, revenue, and margin.
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
            Loading material consumption report...
          </div>
        ) : (
          <>
            {/* KPI CARDS */}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                icon={Package}
                label="Materials Used"
                value={summary.totalQty.toLocaleString()}
                detail={`${summary.uniqueParts} unique parts consumed`}
              />

              <StatCard
                icon={DollarSign}
                label="Material Cost"
                value={money(summary.materialCost)}
                detail="Inventory cost consumed"
              />

              <StatCard
                icon={Briefcase}
                label="Jobs Using Materials"
                value={summary.uniqueJobs.toLocaleString()}
                detail="Jobs with material usage"
              />

              <StatCard
                icon={TrendingDown}
                label="Material Margin"
                value={money(summary.margin)}
                detail={`Revenue ${money(summary.materialRevenue)}`}
              />
            </div>

            {/* GRAPH AREA */}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

              {/* TOP MATERIALS */}

              <Panel title="Top Consumed Materials" icon={BarChart3}>
                {topMaterials.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">
                    No material consumption data available.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {topMaterials.map((row) => {
                      const width = Math.max(
                        (row.qty / maxMaterialQty) * 100,
                        3
                      );

                      return (
                        <div key={row.part.id}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <div className="truncate text-slate-300">
                                {row.part.part_no || row.part.sku || "Unknown"}
                              </div>

                              <div className="truncate text-[10px] text-slate-600">
                                {row.part.description || "No description"}
                              </div>
                            </div>

                            <span className="f-mono shrink-0 text-slate-400">
                              {row.qty.toLocaleString()}
                            </span>
                          </div>

                          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-orange-500/70"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              {/* CONSUMPTION BY TRADE */}

              <Panel title="Consumption by Trade" icon={BarChart3}>
                {categorySummary.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">
                    No category consumption data available.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {categorySummary.map((row) => {
                      const width = Math.max(
                        (row.qty / maxCategoryQty) * 100,
                        3
                      );

                      return (
                        <div key={row.category}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="text-slate-400">
                              {row.category}
                            </span>

                            <span className="f-mono text-slate-300">
                              {row.qty.toLocaleString()} units
                            </span>
                          </div>

                          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-emerald-400/70"
                              style={{ width: `${width}%` }}
                            />
                          </div>

                          <div className="mt-1 flex justify-between text-[10px] text-slate-600">
                            <span>
                              Cost {money(row.cost)}
                            </span>

                            <span>
                              Revenue {money(row.revenue)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </div>

            {/* FILTERS */}

            <Panel title="Consumption Detail" icon={Package}>
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-slate-600">
                    Search
                  </label>

                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Part no., SKU, description, job..."
                    className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none transition placeholder:text-slate-700 focus:border-orange-500/50"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-slate-600">
                    Trade
                  </label>

                  <select
                    value={categoryFilter}
                    onChange={(event) =>
                      setCategoryFilter(event.target.value)
                    }
                    className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-orange-500/50"
                  >
                    <option value="All">All Trades</option>

                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* DETAIL TABLE */}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px]">
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Job</Th>
                      <Th>Part No.</Th>
                      <Th>SKU</Th>
                      <Th>Category</Th>
                      <Th className="text-right">Qty Used</Th>
                      <Th className="text-right">Unit Cost</Th>
                      <Th className="text-right">Material Cost</Th>
                      <Th className="text-right">Sale Value</Th>
                      <Th className="text-right">Margin</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {recentRows.map((row) => {
                      const jobNumber =
                        row.job?.job_no ||
                        row.job?.job_number ||
                        row.job?.id?.slice(0, 8) ||
                        "—";

                      const date =
                        row.job?.completed_at ||
                        row.job?.job_date ||
                        row.job?.created_at;

                      return (
                        <tr
                          key={row.id}
                          className="border-t border-slate-800/70 transition hover:bg-slate-900/60"
                        >
                          <Td className="text-slate-500">
                            {formatDate(date)}
                          </Td>

                          <Td className="f-mono text-slate-300">
                            {jobNumber}
                          </Td>

                          <Td className="f-mono text-slate-200">
                            {row.part?.part_no || "—"}
                          </Td>

                          <Td className="f-mono text-slate-500">
                            {row.part?.sku || "—"}
                          </Td>

                          <Td>
                            <TradeBadge
                              category={row.part?.category}
                            />
                          </Td>

                          <Td className="text-right f-mono text-red-400">
                            {row.qty.toLocaleString()}
                          </Td>

                          <Td className="text-right f-mono text-slate-400">
                            {money(row.partCost)}
                          </Td>

                          <Td className="text-right f-mono text-slate-300">
                            {money(row.materialCost)}
                          </Td>

                          <Td className="text-right f-mono text-emerald-400">
                            {money(row.materialRevenue)}
                          </Td>

                          <Td
                            className={`text-right f-mono ${
                              row.margin >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {money(row.margin)}
                          </Td>
                        </tr>
                      );
                    })}

                    {recentRows.length === 0 && (
                      <tr>
                        <Td
                          colSpan={10}
                          className="py-10 text-center text-slate-500"
                        >
                          No material consumption records match the
                          current filters.
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* FOOTER */}

              <div className="mt-4 flex flex-col gap-2 border-t border-slate-800 pt-3 text-[10px] uppercase tracking-widest text-slate-600 md:flex-row md:items-center md:justify-between">
                <span>
                  Showing {recentRows.length} of{" "}
                  {filteredRows.length} consumption records
                </span>

                <span>
                  Material Cost: {money(summary.materialCost)}
                </span>
              </div>
            </Panel>

            {/* MATERIAL SUMMARY */}

            <Panel title="Material Consumption Summary" icon={BarChart3}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr>
                      <Th>Part No.</Th>
                      <Th>SKU</Th>
                      <Th>Description</Th>
                      <Th>Category</Th>
                      <Th className="text-right">Qty Used</Th>
                      <Th className="text-right">Jobs</Th>
                      <Th className="text-right">Material Cost</Th>
                      <Th className="text-right">Sale Value</Th>
                      <Th className="text-right">Margin</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {partSummary.map((row) => (
                      <tr
                        key={row.part.id}
                        className="border-t border-slate-800/70"
                      >
                        <Td className="f-mono text-slate-200">
                          {row.part.part_no || "—"}
                        </Td>

                        <Td className="f-mono text-slate-500">
                          {row.part.sku || "—"}
                        </Td>

                        <Td className="max-w-[250px] truncate text-slate-400">
                          {row.part.description || "—"}
                        </Td>

                        <Td>
                          <TradeBadge category={row.part.category} />
                        </Td>

                        <Td className="text-right f-mono text-red-400">
                          {row.qty.toLocaleString()}
                        </Td>

                        <Td className="text-right f-mono text-slate-400">
                          {row.jobCount}
                        </Td>

                        <Td className="text-right f-mono text-slate-300">
                          {money(row.cost)}
                        </Td>

                        <Td className="text-right f-mono text-emerald-400">
                          {money(row.revenue)}
                        </Td>

                        <Td
                          className={`text-right f-mono ${
                            row.margin >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {money(row.margin)}
                        </Td>
                      </tr>
                    ))}

                    {partSummary.length === 0 && (
                      <tr>
                        <Td
                          colSpan={9}
                          className="py-8 text-center text-slate-500"
                        >
                          No material consumption data available.
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* REPORT FOOTER */}

            <div className="flex flex-col gap-2 border-t border-slate-900 pt-3 text-[10px] uppercase tracking-widest text-slate-700 md:flex-row md:items-center md:justify-between">
              <span>Material Consumption Report</span>

              <span>
                Job usage • Material cost • Revenue • Margin • Trade analysis
              </span>
            </div>
          </>
        )}
      </div>
    </Nav>
  );
}