"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Package,
  TriangleAlert,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, TradeBadge, money } from "@/components/ui";

const CATEGORIES = ["Electrical", "Plumbing", "HVAC", "General"];

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatCard({ icon: Icon, label, value, detail, tone = "orange" }) {
  const toneClasses = {
    orange: "border-orange-500/20 bg-orange-500/5 text-orange-400",
    emerald: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
    red: "border-red-500/20 bg-red-500/5 text-red-400",
    amber: "border-amber-500/20 bg-amber-500/5 text-amber-400",
  };

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

        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${toneClasses[tone]}`}
        >
          <Icon size={16} />
        </div>
      </div>
    </div>
  );
}

function AccuracyBadge({ accuracy }) {
  let className =
    "text-emerald-400 border-emerald-500/30 bg-emerald-500/5";

  if (accuracy < 100 && accuracy >= 95) {
    className =
      "text-amber-400 border-amber-500/30 bg-amber-500/5";
  }

  if (accuracy < 95) {
    className =
      "text-red-400 border-red-500/30 bg-red-500/5";
  }

  return (
    <span
      className={`inline-flex rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-wider ${className}`}
    >
      {accuracy.toFixed(1)}%
    </span>
  );
}

function VarianceBadge({ variance }) {
  if (variance === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-400">
        <CheckCircle2 size={12} />
        Exact
      </span>
    );
  }

  if (variance > 0) {
    return (
      <span className="inline-flex rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-400">
        +{variance}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-red-400">
      <TriangleAlert size={12} />
      {variance}
    </span>
  );
}

export default function CycleCountReportPage() {
  const router = useRouter();

  const [orgId, setOrgId] = useState(null);
  const [parts, setParts] = useState([]);
  const [cycleCounts, setCycleCounts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [locationFilter, setLocationFilter] = useState("All");
  const [varianceFilter, setVarianceFilter] = useState("All");

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
        { data: countData, error: countError },
        { data: partsData, error: partsError },
      ] = await Promise.all([
        supabase
          .from("cycle_counts")
          .select("*")
          .eq("org_id", orgId)
          .order("count_date", { ascending: false }),

        supabase
          .from("parts")
          .select(
            "id, part_no, sku, description, category, qty, unit_cost, min_reorder"
          )
          .eq("org_id", orgId),
      ]);

      if (!mounted) return;

      setError(countError?.message || partsError?.message || "");
      setCycleCounts(countData || []);
      setParts(partsData || []);
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [orgId]);

  /*
   * ---------------------------------------------------------
   * PART MAP
   * ---------------------------------------------------------
   */

  const partMap = useMemo(() => {
    const map = new Map();

    parts.forEach((part) => {
      map.set(part.id, part);
    });

    return map;
  }, [parts]);

  /*
   * ---------------------------------------------------------
   * NORMALIZE CYCLE COUNTS
   * ---------------------------------------------------------
   */

  const countRows = useMemo(() => {
    return cycleCounts.map((count) => {
      const part = partMap.get(count.part_id);

      const systemQty = Number(count.system_qty || 0);
      const countedQty = Number(count.counted_qty || 0);

      const varianceQty = countedQty - systemQty;

      const absoluteVariance = Math.abs(varianceQty);

      /*
       * Accuracy is based on the counted quantity versus
       * the system quantity.
       *
       * Exact match = 100%.
       *
       * When system quantity is zero:
       * - counted zero = 100%
       * - counted non-zero = 0%
       */
      let accuracy = 100;

      if (systemQty === 0) {
        accuracy = countedQty === 0 ? 100 : 0;
      } else {
        accuracy = Math.max(
          0,
          100 - (absoluteVariance / Math.abs(systemQty)) * 100
        );
      }

      const unitCost = Number(part?.unit_cost || 0);

      const varianceValue = varianceQty * unitCost;

      return {
        ...count,
        part,
        systemQty,
        countedQty,
        varianceQty,
        absoluteVariance,
        accuracy,
        unitCost,
        varianceValue,
      };
    });
  }, [cycleCounts, partMap]);

  /*
   * ---------------------------------------------------------
   * FILTER VALUES
   * ---------------------------------------------------------
   */

  const locations = useMemo(() => {
    const values = countRows
      .map((row) => String(row.location || "").trim())
      .filter(Boolean);

    return [...new Set(values)].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [countRows]);

  /*
   * ---------------------------------------------------------
   * FILTERED DATA
   * ---------------------------------------------------------
   */

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return countRows.filter((row) => {
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
        String(row.location || "")
          .toLowerCase()
          .includes(q) ||
        String(row.counted_by || "")
          .toLowerCase()
          .includes(q);

      const matchesCategory =
        categoryFilter === "All" ||
        part?.category === categoryFilter;

      const matchesLocation =
        locationFilter === "All" ||
        row.location === locationFilter;

      const matchesVariance =
        varianceFilter === "All" ||
        (varianceFilter === "Exact" && row.varianceQty === 0) ||
        (varianceFilter === "Variance" && row.varianceQty !== 0) ||
        (varianceFilter === "Shortage" && row.varianceQty < 0) ||
        (varianceFilter === "Overage" && row.varianceQty > 0);

      return (
        matchesSearch &&
        matchesCategory &&
        matchesLocation &&
        matchesVariance
      );
    });
  }, [
    countRows,
    search,
    categoryFilter,
    locationFilter,
    varianceFilter,
  ]);

  /*
   * ---------------------------------------------------------
   * SUMMARY METRICS
   * ---------------------------------------------------------
   */

  const summary = useMemo(() => {
    const totalCounts = filteredRows.length;

    const exactCounts = filteredRows.filter(
      (row) => row.varianceQty === 0
    ).length;

    const varianceCounts = filteredRows.filter(
      (row) => row.varianceQty !== 0
    ).length;

    const shortageCounts = filteredRows.filter(
      (row) => row.varianceQty < 0
    ).length;

    const overageCounts = filteredRows.filter(
      (row) => row.varianceQty > 0
    ).length;

    const systemQty = filteredRows.reduce(
      (sum, row) => sum + row.systemQty,
      0
    );

    const countedQty = filteredRows.reduce(
      (sum, row) => sum + row.countedQty,
      0
    );

    const absoluteVariance = filteredRows.reduce(
      (sum, row) => sum + row.absoluteVariance,
      0
    );

    const varianceValue = filteredRows.reduce(
      (sum, row) => sum + row.varianceValue,
      0
    );

    const averageAccuracy =
      totalCounts > 0
        ? filteredRows.reduce(
            (sum, row) => sum + row.accuracy,
            0
          ) / totalCounts
        : 100;

    const exactRate =
      totalCounts > 0
        ? (exactCounts / totalCounts) * 100
        : 100;

    return {
      totalCounts,
      exactCounts,
      varianceCounts,
      shortageCounts,
      overageCounts,
      systemQty,
      countedQty,
      absoluteVariance,
      varianceValue,
      averageAccuracy,
      exactRate,
    };
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
        counts: 0,
        exact: 0,
        variance: 0,
        varianceValue: 0,
      };

      existing.counts += 1;

      if (row.varianceQty === 0) {
        existing.exact += 1;
      } else {
        existing.variance += 1;
      }

      existing.varianceValue += row.varianceValue;

      map.set(category, existing);
    });

    return CATEGORIES.map((category) => {
      return (
        map.get(category) || {
          category,
          counts: 0,
          exact: 0,
          variance: 0,
          varianceValue: 0,
        }
      );
    }).filter((row) => row.counts > 0);
  }, [filteredRows]);

  /*
   * ---------------------------------------------------------
   * TOP VARIANCES
   * ---------------------------------------------------------
   */

  const topVariances = useMemo(() => {
    return [...filteredRows]
      .filter((row) => row.varianceQty !== 0)
      .sort(
        (a, b) =>
          b.absoluteVariance - a.absoluteVariance
      )
      .slice(0, 8);
  }, [filteredRows]);

  const maxVariance = Math.max(
    ...topVariances.map((row) => row.absoluteVariance),
    1
  );

  /*
   * ---------------------------------------------------------
   * DATE SUMMARY
   * ---------------------------------------------------------
   */

  const dateSummary = useMemo(() => {
    const map = new Map();

    filteredRows.forEach((row) => {
      const date = row.count_date || "Unknown";

      const existing = map.get(date) || {
        date,
        counts: 0,
        exact: 0,
        variance: 0,
      };

      existing.counts += 1;

      if (row.varianceQty === 0) {
        existing.exact += 1;
      } else {
        existing.variance += 1;
      }

      map.set(date, existing);
    });

    return [...map.values()]
      .sort((a, b) =>
        String(b.date).localeCompare(String(a.date))
      )
      .slice(0, 8);
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
    <Nav title="Cycle Count Report">
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
                CYCLE COUNT REPORT
              </h1>

              <p className="mt-1 text-xs text-slate-500">
                Analyze physical inventory counts against system quantities,
                variances, accuracy, and inventory value differences.
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
            Loading cycle count report...
          </div>
        ) : (
          <>
            {/* KPI CARDS */}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">

              <StatCard
                icon={ClipboardCheck}
                label="Count Accuracy"
                value={`${summary.averageAccuracy.toFixed(1)}%`}
                detail={`${summary.totalCounts} counts reviewed`}
                tone="emerald"
              />

              <StatCard
                icon={CheckCircle2}
                label="Exact Counts"
                value={summary.exactCounts.toLocaleString()}
                detail={`${summary.exactRate.toFixed(1)}% exact match`}
                tone="emerald"
              />

              <StatCard
                icon={TriangleAlert}
                label="Variances"
                value={summary.varianceCounts.toLocaleString()}
                detail={`${summary.shortageCounts} shortages / ${summary.overageCounts} overages`}
                tone="amber"
              />

              <StatCard
                icon={Package}
                label="Variance Value"
                value={money(summary.varianceValue)}
                detail={`${summary.absoluteVariance.toLocaleString()} units variance`}
                tone={summary.varianceValue < 0 ? "red" : "orange"}
              />

            </div>

            {/* SECONDARY METRICS */}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">

              <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
                <div className="text-[10px] uppercase tracking-widest text-slate-600">
                  System Quantity
                </div>

                <div className="mt-2 text-lg font-semibold text-slate-200">
                  {summary.systemQty.toLocaleString()}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
                <div className="text-[10px] uppercase tracking-widest text-slate-600">
                  Physical Count
                </div>

                <div className="mt-2 text-lg font-semibold text-slate-200">
                  {summary.countedQty.toLocaleString()}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
                <div className="text-[10px] uppercase tracking-widest text-slate-600">
                  Absolute Variance
                </div>

                <div className="mt-2 text-lg font-semibold text-red-400">
                  {summary.absoluteVariance.toLocaleString()}
                </div>
              </div>

            </div>

            {/* GRAPHS */}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

              {/* VARIANCE GRAPH */}

              <Panel title="Largest Count Variances" icon={BarChart3}>
                {topVariances.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">
                    No inventory variances found.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {topVariances.map((row) => {
                      const width = Math.max(
                        (row.absoluteVariance / maxVariance) * 100,
                        3
                      );

                      return (
                        <div key={row.id}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <div className="truncate text-slate-300">
                                {row.part?.part_no ||
                                  row.part?.sku ||
                                  "Unknown Part"}
                              </div>

                              <div className="truncate text-[10px] text-slate-600">
                                {row.location || "No location"}
                              </div>
                            </div>

                            <span
                              className={`f-mono shrink-0 ${
                                row.varianceQty < 0
                                  ? "text-red-400"
                                  : "text-emerald-400"
                              }`}
                            >
                              {row.varianceQty > 0
                                ? `+${row.varianceQty}`
                                : row.varianceQty}
                            </span>
                          </div>

                          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full ${
                                row.varianceQty < 0
                                  ? "bg-red-400/70"
                                  : "bg-emerald-400/70"
                              }`}
                              style={{
                                width: `${width}%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              {/* CATEGORY ACCURACY */}

              <Panel title="Accuracy by Trade" icon={BarChart3}>
                {categorySummary.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">
                    No cycle count data available.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {categorySummary.map((row) => {
                      const accuracy =
                        row.counts > 0
                          ? (row.exact / row.counts) * 100
                          : 100;

                      return (
                        <div key={row.category}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="text-slate-400">
                              {row.category}
                            </span>

                            <span className="f-mono text-slate-300">
                              {accuracy.toFixed(1)}%
                            </span>
                          </div>

                          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full ${
                                accuracy >= 95
                                  ? "bg-emerald-400/70"
                                  : accuracy >= 90
                                  ? "bg-amber-400/70"
                                  : "bg-red-400/70"
                              }`}
                              style={{
                                width: `${Math.max(
                                  Math.min(accuracy, 100),
                                  2
                                )}%`,
                              }}
                            />
                          </div>

                          <div className="mt-1 flex justify-between text-[10px] text-slate-600">
                            <span>
                              {row.exact} exact
                            </span>

                            <span>
                              {row.variance} variance
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

            </div>

            {/* RECENT COUNT DATES */}

            <Panel title="Count Activity" icon={ClipboardCheck}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[650px]">
                  <thead>
                    <tr>
                      <Th>Count Date</Th>
                      <Th className="text-right">Counts</Th>
                      <Th className="text-right">Exact</Th>
                      <Th className="text-right">Variance</Th>
                      <Th className="text-right">Accuracy</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {dateSummary.map((row) => {
                      const accuracy =
                        row.counts > 0
                          ? (row.exact / row.counts) * 100
                          : 100;

                      return (
                        <tr
                          key={row.date}
                          className="border-t border-slate-800/70"
                        >
                          <Td className="text-slate-300">
                            {formatDate(row.date)}
                          </Td>

                          <Td className="text-right f-mono text-slate-400">
                            {row.counts}
                          </Td>

                          <Td className="text-right f-mono text-emerald-400">
                            {row.exact}
                          </Td>

                          <Td className="text-right f-mono text-red-400">
                            {row.variance}
                          </Td>

                          <Td className="text-right">
                            <AccuracyBadge accuracy={accuracy} />
                          </Td>
                        </tr>
                      );
                    })}

                    {dateSummary.length === 0 && (
                      <tr>
                        <Td
                          colSpan={5}
                          className="py-8 text-center text-slate-500"
                        >
                          No count activity available.
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* FILTERS + DETAIL */}

            <Panel title="Cycle Count Detail" icon={ClipboardCheck}>

              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">

                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-slate-600">
                    Search
                  </label>

                  <input
                    type="text"
                    value={search}
                    onChange={(event) =>
                      setSearch(event.target.value)
                    }
                    placeholder="Part, SKU, location, counter..."
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

                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-slate-600">
                    Location
                  </label>

                  <select
                    value={locationFilter}
                    onChange={(event) =>
                      setLocationFilter(event.target.value)
                    }
                    className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-orange-500/50"
                  >
                    <option value="All">All Locations</option>

                    {locations.map((location) => (
                      <option key={location} value={location}>
                        {location}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-slate-600">
                    Variance
                  </label>

                  <select
                    value={varianceFilter}
                    onChange={(event) =>
                      setVarianceFilter(event.target.value)
                    }
                    className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-orange-500/50"
                  >
                    <option value="All">All Counts</option>
                    <option value="Exact">Exact Only</option>
                    <option value="Variance">With Variance</option>
                    <option value="Shortage">Shortages</option>
                    <option value="Overage">Overages</option>
                  </select>
                </div>

              </div>

              {/* DETAIL TABLE */}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px]">
                  <thead>
                    <tr>
                      <Th>Count Date</Th>
                      <Th>Part No.</Th>
                      <Th>SKU</Th>
                      <Th>Category</Th>
                      <Th>Location</Th>
                      <Th className="text-right">
                        System Qty
                      </Th>
                      <Th className="text-right">
                        Counted Qty
                      </Th>
                      <Th className="text-right">
                        Variance
                      </Th>
                      <Th className="text-right">
                        Variance Value
                      </Th>
                      <Th className="text-right">
                        Accuracy
                      </Th>
                      <Th>Counted By</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-t border-slate-800/70 transition hover:bg-slate-900/60"
                      >
                        <Td className="text-slate-500">
                          {formatDate(row.count_date)}
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

                        <Td className="text-slate-400">
                          {row.location || "—"}
                        </Td>

                        <Td className="text-right f-mono text-slate-300">
                          {row.systemQty.toLocaleString()}
                        </Td>

                        <Td className="text-right f-mono text-slate-200">
                          {row.countedQty.toLocaleString()}
                        </Td>

                        <Td className="text-right">
                          <VarianceBadge
                            variance={row.varianceQty}
                          />
                        </Td>

                        <Td
                          className={`text-right f-mono ${
                            row.varianceValue < 0
                              ? "text-red-400"
                              : row.varianceValue > 0
                              ? "text-emerald-400"
                              : "text-slate-500"
                          }`}
                        >
                          {money(row.varianceValue)}
                        </Td>

                        <Td className="text-right">
                          <AccuracyBadge
                            accuracy={row.accuracy}
                          />
                        </Td>

                        <Td className="text-slate-400">
                          {row.counted_by || "—"}
                        </Td>
                      </tr>
                    ))}

                    {filteredRows.length === 0 && (
                      <tr>
                        <Td
                          colSpan={11}
                          className="py-10 text-center text-slate-500"
                        >
                          No cycle count records match the
                          current filters.
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-col gap-2 border-t border-slate-800 pt-3 text-[10px] uppercase tracking-widest text-slate-600 md:flex-row md:items-center md:justify-between">
                <span>
                  Showing {filteredRows.length} of{" "}
                  {countRows.length} cycle counts
                </span>

                <span>
                  Accuracy:{" "}
                  {summary.averageAccuracy.toFixed(1)}%
                </span>
              </div>
            </Panel>

            {/* REPORT FOOTER */}

            <div className="flex flex-col gap-2 border-t border-slate-900 pt-3 text-[10px] uppercase tracking-widest text-slate-700 md:flex-row md:items-center md:justify-between">
              <span>Cycle Count Report</span>

              <span>
                Physical counts • System comparison • Variance • Accuracy
              </span>
            </div>
          </>
        )}
      </div>
    </Nav>
  );
}