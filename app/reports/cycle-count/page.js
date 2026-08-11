"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardCheck,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Search,
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

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function CycleCountReportPage() {
  const router = useRouter();

  const [orgId, setOrgId] = useState(null);
  const [counts, setCounts] = useState([]);
  const [parts, setParts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");

  useEffect(() => {
    let active = true;

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

      if (!active) return;

      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }

      setOrgId(profile?.org_id || null);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!orgId) return;

    let active = true;

    (async () => {
      setLoading(true);
      setError("");

      const [
        { data: countsData, error: countsError },
        { data: partsData, error: partsError },
      ] = await Promise.all([
        supabase
          .from("cycle_counts")
          .select("*")
          .eq("org_id", orgId)
          .order("count_date", { ascending: false }),

        supabase
          .from("parts")
          .select("*")
          .eq("org_id", orgId)
          .order("part_no", { ascending: true }),
      ]);

      if (!active) return;

      if (countsError || partsError) {
        setError(
          countsError?.message ||
            partsError?.message ||
            "Unable to load cycle count data."
        );
      }

      setCounts(countsData || []);
      setParts(partsData || []);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [orgId]);

  const partMap = useMemo(() => {
    const map = new Map();

    for (const part of parts) {
      map.set(part.id, part);
    }

    return map;
  }, [parts]);

  const enrichedCounts = useMemo(() => {
    return counts.map((count) => {
      const part = partMap.get(count.part_id);

      const systemQty = numberValue(count.system_qty);
      const countedQty = numberValue(count.counted_qty);
      const variance = countedQty - systemQty;

      return {
        ...count,
        part,
        systemQty,
        countedQty,
        variance,
        varianceValue: variance * numberValue(part?.unit_cost),
        status: variance === 0 ? "MATCH" : "VARIANCE",
      };
    });
  }, [counts, partMap]);

  const filteredCounts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return enrichedCounts.filter((row) => {
      const part = row.part;

      const matchesSearch =
        !q ||
        part?.part_no?.toLowerCase().includes(q) ||
        part?.sku?.toLowerCase().includes(q) ||
        part?.description?.toLowerCase().includes(q) ||
        row.location?.toLowerCase().includes(q) ||
        row.counted_by?.toLowerCase().includes(q);

      const matchesCategory =
        category === "All" || part?.category === category;

      const matchesStatus =
        status === "All" || row.status === status;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [enrichedCounts, search, category, status]);

  const summary = useMemo(() => {
    const total = enrichedCounts.length;

    const matched = enrichedCounts.filter(
      (row) => row.variance === 0
    ).length;

    const varianceRows = enrichedCounts.filter(
      (row) => row.variance !== 0
    );

    const positive = varianceRows.filter(
      (row) => row.variance > 0
    ).length;

    const negative = varianceRows.filter(
      (row) => row.variance < 0
    ).length;

    const totalSystemQty = enrichedCounts.reduce(
      (sum, row) => sum + row.systemQty,
      0
    );

    const totalCountedQty = enrichedCounts.reduce(
      (sum, row) => sum + row.countedQty,
      0
    );

    const totalVarianceQty = enrichedCounts.reduce(
      (sum, row) => sum + row.variance,
      0
    );

    const varianceValue = enrichedCounts.reduce(
      (sum, row) => sum + row.varianceValue,
      0
    );

    const accuracy =
      totalSystemQty > 0
        ? Math.max(
            0,
            100 -
              (enrichedCounts.reduce(
                (sum, row) => sum + Math.abs(row.variance),
                0
              ) /
                totalSystemQty) *
                100
          )
        : total === 0
        ? 0
        : (matched / total) * 100;

    return {
      total,
      matched,
      varianceRows: varianceRows.length,
      positive,
      negative,
      totalSystemQty,
      totalCountedQty,
      totalVarianceQty,
      varianceValue,
      accuracy,
    };
  }, [enrichedCounts]);

  if (!orgId) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="f-mono text-xs text-slate-500 uppercase tracking-widest">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <Nav title="Cycle Count Report">
      <div className="p-4 md:p-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[10px] f-mono uppercase tracking-widest text-orange-400">
              Inventory Control
            </div>

            <h1 className="mt-1 text-lg font-semibold tracking-wide text-slate-100">
              CYCLE COUNT REPORT
            </h1>

            <p className="mt-1 text-xs text-slate-500">
              Compare physical inventory counts against system quantities and
              identify inventory variances.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">
            Loading cycle count report...
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] f-mono uppercase tracking-widest text-slate-500">
                    Counts
                  </span>

                  <ClipboardCheck
                    size={16}
                    className="text-orange-400"
                  />
                </div>

                <div className="mt-2 text-2xl f-mono text-slate-100">
                  {summary.total}
                </div>

                <div className="mt-1 text-xs text-slate-600">
                  Total count records
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] f-mono uppercase tracking-widest text-slate-500">
                    Matched
                  </span>

                  <CheckCircle2
                    size={16}
                    className="text-emerald-400"
                  />
                </div>

                <div className="mt-2 text-2xl f-mono text-emerald-400">
                  {summary.matched}
                </div>

                <div className="mt-1 text-xs text-slate-600">
                  No quantity variance
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] f-mono uppercase tracking-widest text-slate-500">
                    Variances
                  </span>

                  <AlertTriangle
                    size={16}
                    className="text-amber-400"
                  />
                </div>

                <div className="mt-2 text-2xl f-mono text-amber-400">
                  {summary.varianceRows}
                </div>

                <div className="mt-1 text-xs text-slate-600">
                  Require review
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] f-mono uppercase tracking-widest text-slate-500">
                    Accuracy
                  </span>

                  <TrendingUp
                    size={16}
                    className="text-emerald-400"
                  />
                </div>

                <div className="mt-2 text-2xl f-mono text-emerald-400">
                  {summary.accuracy.toFixed(1)}%
                </div>

                <div className="mt-1 text-xs text-slate-600">
                  Quantity accuracy
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] f-mono uppercase tracking-widest text-slate-500">
                    Variance Value
                  </span>

                  <AlertTriangle
                    size={16}
                    className={
                      summary.varianceValue < 0
                        ? "text-red-400"
                        : "text-slate-500"
                    }
                  />
                </div>

                <div
                  className={`mt-2 text-2xl f-mono ${
                    summary.varianceValue < 0
                      ? "text-red-400"
                      : summary.varianceValue > 0
                      ? "text-emerald-400"
                      : "text-slate-100"
                  }`}
                >
                  {money(summary.varianceValue)}
                </div>

                <div className="mt-1 text-xs text-slate-600">
                  Net inventory variance
                </div>
              </div>
            </div>

            {/* Variance Overview */}
            <Panel title="Variance Overview" icon={BarChartIcon}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs f-mono text-slate-500">
                    <span>SYSTEM QTY</span>
                    <span>{summary.totalSystemQty}</span>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-slate-500"
                      style={{
                        width: `${
                          summary.totalSystemQty > 0
                            ? Math.min(
                                100,
                                (summary.totalSystemQty /
                                  Math.max(
                                    summary.totalSystemQty,
                                    summary.totalCountedQty,
                                    1
                                  )) *
                                  100
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-xs f-mono text-slate-500">
                    <span>COUNTED QTY</span>
                    <span>{summary.totalCountedQty}</span>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-emerald-500"
                      style={{
                        width: `${
                          summary.totalCountedQty > 0
                            ? Math.min(
                                100,
                                (summary.totalCountedQty /
                                  Math.max(
                                    summary.totalSystemQty,
                                    summary.totalCountedQty,
                                    1
                                  )) *
                                  100
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-xs f-mono text-slate-500">
                    <span>NET VARIANCE</span>
                    <span
                      className={
                        summary.totalVarianceQty < 0
                          ? "text-red-400"
                          : summary.totalVarianceQty > 0
                          ? "text-emerald-400"
                          : "text-slate-400"
                      }
                    >
                      {summary.totalVarianceQty > 0 ? "+" : ""}
                      {summary.totalVarianceQty}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <div className="flex items-center gap-1 text-[10px] f-mono text-emerald-400">
                      <TrendingUp size={12} />
                      {summary.positive}
                    </div>

                    <div className="flex items-center gap-1 text-[10px] f-mono text-red-400">
                      <TrendingDown size={12} />
                      {summary.negative}
                    </div>
                  </div>
                </div>
              </div>
            </Panel>

            {/* Filters */}
            <Panel title="Cycle Count Detail" icon={ClipboardCheck}>
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="relative md:col-span-2">
                  <Search
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
                  />

                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search part, SKU, location, counter..."
                    className="w-full rounded-md border border-slate-800 bg-slate-950 py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-slate-600"
                  />
                </div>

                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-slate-600"
                >
                  <option value="All">All Categories</option>

                  {CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>

                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-slate-600"
                >
                  <option value="All">All Statuses</option>
                  <option value="MATCH">Matched</option>
                  <option value="VARIANCE">Variance</option>
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px]">
                  <thead>
                    <tr>
                      <Th>Date</Th>
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
                      <Th>Status</Th>
                      <Th>Counted By</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredCounts.map((row) => (
                      <tr
                        key={row.id}
                        className="border-t border-slate-800/70 hover:bg-slate-900/50"
                      >
                        <Td className="f-mono text-slate-400">
                          {formatDate(row.count_date)}
                        </Td>

                        <Td className="f-mono text-slate-100">
                          {row.part?.part_no || "—"}
                        </Td>

                        <Td className="f-mono text-slate-400">
                          {row.part?.sku || "—"}
                        </Td>

                        <Td>
                          {row.part?.category ? (
                            <TradeBadge
                              category={row.part.category}
                            />
                          ) : (
                            "—"
                          )}
                        </Td>

                        <Td className="text-slate-400">
                          {row.location || "—"}
                        </Td>

                        <Td className="text-right f-mono text-slate-400">
                          {row.systemQty}
                        </Td>

                        <Td className="text-right f-mono text-slate-100">
                          {row.countedQty}
                        </Td>

                        <Td
                          className={`text-right f-mono font-medium ${
                            row.variance < 0
                              ? "text-red-400"
                              : row.variance > 0
                              ? "text-emerald-400"
                              : "text-slate-500"
                          }`}
                        >
                          {row.variance > 0 ? "+" : ""}
                          {row.variance}
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

                        <Td>
                          {row.status === "MATCH" ? (
                            <span className="inline-flex items-center gap-1.5 rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-[10px] f-mono uppercase tracking-wide text-emerald-400">
                              <CheckCircle2 size={11} />
                              MATCH
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[10px] f-mono uppercase tracking-wide text-amber-400">
                              <AlertTriangle size={11} />
                              VARIANCE
                            </span>
                          )}
                        </Td>

                        <Td className="text-slate-400">
                          {row.counted_by || "—"}
                        </Td>
                      </tr>
                    ))}

                    {filteredCounts.length === 0 && (
                      <tr>
                        <Td
                          className="py-10 text-center text-slate-500"
                          colSpan={11}
                        >
                          {enrichedCounts.length === 0
                            ? "No cycle count records found."
                            : "No cycle count records match your filters."}
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-col gap-1 border-t border-slate-800/70 pt-3 text-[10px] f-mono uppercase tracking-widest text-slate-600 md:flex-row md:justify-between">
                <span>
                  Showing {filteredCounts.length} of{" "}
                  {enrichedCounts.length} count records
                </span>

                <span>
                  {summary.matched} matched /{" "}
                  {summary.varianceRows} variance
                </span>
              </div>
            </Panel>
          </>
        )}
      </div>
    </Nav>
  );
}

/*
 * Lightweight icon component so this report does not require
 * another icon dependency.
 */
function BarChartIcon({ size = 18, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="M7 16v-5" />
      <path d="M12 16V7" />
      <path d="M17 16v-8" />
    </svg>
  );
}