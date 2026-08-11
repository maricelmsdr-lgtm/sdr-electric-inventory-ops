"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Package,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel,
  Th,
  Td,
  TradeBadge,
  money,
  TRADE_STYLES,
} from "@/components/ui";

const CATEGORIES = ["Electrical", "Plumbing", "HVAC", "General"];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatQty(value) {
  return num(value).toLocaleString();
}

export default function StockMovementReportPage() {
  const router = useRouter();

  const [orgId, setOrgId] = useState(null);
  const [parts, setParts] = useState([]);
  const [stockIns, setStockIns] = useState([]);
  const [jobs, setJobs] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  useEffect(() => {
    let mounted = true;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) return;

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

  useEffect(() => {
    if (!orgId) return;

    let mounted = true;

    (async () => {
      setLoading(true);
      setError("");

      const [
        { data: partsData, error: partsError },
        { data: stockInData, error: stockInError },
        { data: jobsData, error: jobsError },
      ] = await Promise.all([
        supabase
          .from("parts")
          .select("*")
          .eq("org_id", orgId),

        supabase
          .from("stock_ins")
          .select("*")
          .eq("org_id", orgId)
          .order("received_date", { ascending: false }),

        supabase
          .from("jobs")
          .select("*, job_line_items(*)")
          .eq("org_id", orgId),
      ]);

      if (!mounted) return;

      const errors = [
        partsError?.message,
        stockInError?.message,
        jobsError?.message,
      ].filter(Boolean);

      setError(errors.join(" | "));

      setParts(partsData || []);
      setStockIns(stockInData || []);
      setJobs(jobsData || []);

      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [orgId]);

  /*
   * Build movement information from the existing inventory records.
   *
   * INBOUND:
   *   stock_ins = received inventory
   *
   * OUTBOUND:
   *   completed/recorded job line items = material consumed
   *
   * Current quantity:
   *   parts.qty
   */
  const movementRows = useMemo(() => {
    const map = new Map();

    for (const part of parts) {
      map.set(part.id, {
        id: part.id,
        part_no: part.part_no || "—",
        sku: part.sku || "—",
        category: part.category || "General",
        unit_cost: num(part.unit_cost),
        current_qty: num(part.qty),
        inbound_qty: 0,
        outbound_qty: 0,
        inbound_value: 0,
        outbound_value: 0,
      });
    }

    // Stock received
    for (const receipt of stockIns) {
      if (!receipt.part_id) continue;

      if (!map.has(receipt.part_id)) {
        map.set(receipt.part_id, {
          id: receipt.part_id,
          part_no: "Unknown",
          sku: "—",
          category: "General",
          unit_cost: 0,
          current_qty: 0,
          inbound_qty: 0,
          outbound_qty: 0,
          inbound_value: 0,
          outbound_value: 0,
        });
      }

      const row = map.get(receipt.part_id);
      const qty = num(receipt.qty);

      row.inbound_qty += qty;
      row.inbound_value += qty * row.unit_cost;
    }

    // Material consumed through jobs
    for (const job of jobs) {
      const lines = Array.isArray(job.job_line_items)
        ? job.job_line_items
        : [];

      for (const line of lines) {
        if (!line.part_id) continue;

        if (!map.has(line.part_id)) {
          map.set(line.part_id, {
            id: line.part_id,
            part_no: "Unknown",
            sku: "—",
            category: "General",
            unit_cost: num(line.part_cost),
            current_qty: 0,
            inbound_qty: 0,
            outbound_qty: 0,
            inbound_value: 0,
            outbound_value: 0,
          });
        }

        const row = map.get(line.part_id);
        const qty = num(line.qty);
        const cost = num(line.part_cost) || row.unit_cost;

        row.outbound_qty += qty;
        row.outbound_value += qty * cost;
      }
    }

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        net_qty: row.inbound_qty - row.outbound_qty,
        net_value: row.inbound_value - row.outbound_value,
      }))
      .sort((a, b) => a.part_no.localeCompare(b.part_no));
  }, [parts, stockIns, jobs]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return movementRows.filter((row) => {
      const matchesSearch =
        !q ||
        row.part_no.toLowerCase().includes(q) ||
        row.sku.toLowerCase().includes(q) ||
        row.category.toLowerCase().includes(q);

      const matchesCategory =
        category === "All" || row.category === category;

      return matchesSearch && matchesCategory;
    });
  }, [movementRows, search, category]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.inbound += row.inbound_qty;
        acc.outbound += row.outbound_qty;
        acc.inboundValue += row.inbound_value;
        acc.outboundValue += row.outbound_value;
        acc.net += row.net_qty;
        acc.netValue += row.net_value;

        return acc;
      },
      {
        inbound: 0,
        outbound: 0,
        inboundValue: 0,
        outboundValue: 0,
        net: 0,
        netValue: 0,
      }
    );
  }, [filteredRows]);

  const categorySummary = useMemo(() => {
    return CATEGORIES.map((cat) => {
      const rows = movementRows.filter((row) => row.category === cat);

      return {
        category: cat,
        inbound: rows.reduce((sum, row) => sum + row.inbound_qty, 0),
        outbound: rows.reduce((sum, row) => sum + row.outbound_qty, 0),
        net: rows.reduce((sum, row) => sum + row.net_qty, 0),
      };
    }).filter(
      (row) =>
        row.inbound > 0 ||
        row.outbound > 0 ||
        row.net !== 0
    );
  }, [movementRows]);

  const maxCategoryMovement = Math.max(
    ...categorySummary.flatMap((row) => [
      row.inbound,
      row.outbound,
    ]),
    1
  );

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
    <Nav title="Stock Movement Summary">
      <div className="p-4 md:p-6 space-y-4">
        {error && (
          <div className="rounded border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div>
          <h1 className="text-lg font-semibold tracking-wide text-slate-100">
            STOCK MOVEMENT SUMMARY
          </h1>

          <p className="mt-1 text-xs text-slate-500">
            Analyze inbound and outbound inventory movements by product.
          </p>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">
            Loading stock movement report...
          </div>
        ) : (
          <>
            {/* KPI CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-md border border-emerald-500/20 bg-emerald-500/5 flex items-center justify-center">
                    <ArrowDownToLine
                      size={17}
                      className="text-emerald-400"
                    />
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-600">
                      Inbound
                    </div>

                    <div className="mt-1 text-xl f-mono text-emerald-400">
                      {formatQty(totals.inbound)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-500">
                  Received quantity
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-md border border-red-500/20 bg-red-500/5 flex items-center justify-center">
                    <ArrowUpFromLine
                      size={17}
                      className="text-red-400"
                    />
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-600">
                      Outbound
                    </div>

                    <div className="mt-1 text-xl f-mono text-red-400">
                      {formatQty(totals.outbound)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-500">
                  Material consumed on jobs
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-md border border-orange-500/20 bg-orange-500/5 flex items-center justify-center">
                    {totals.net >= 0 ? (
                      <TrendingUp
                        size={17}
                        className="text-orange-400"
                      />
                    ) : (
                      <TrendingDown
                        size={17}
                        className="text-orange-400"
                      />
                    )}
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-600">
                      Net Movement
                    </div>

                    <div className="mt-1 text-xl f-mono text-slate-100">
                      {formatQty(totals.net)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-500">
                  Inbound minus outbound
                </div>
              </div>
            </div>

            {/* CATEGORY GRAPH */}
            <Panel title="Movement by Trade" icon={BarChartIcon}>
              {categorySummary.length === 0 ? (
                <div className="text-sm text-slate-500">
                  No stock movement data available yet.
                </div>
              ) : (
                <div className="space-y-5">
                  {categorySummary.map((row) => {
                    const style =
                      TRADE_STYLES[row.category] ||
                      TRADE_STYLES.General;

                    return (
                      <div key={row.category}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${style.dot}`}
                            />

                            <span className="text-xs text-slate-300">
                              {row.category}
                            </span>
                          </div>

                          <div className="text-xs f-mono text-slate-500">
                            Net {formatQty(row.net)}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <div className="w-16 text-[10px] uppercase tracking-wider text-slate-600">
                              In
                            </div>

                            <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className="h-full bg-emerald-500/70"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    (row.inbound /
                                      maxCategoryMovement) *
                                      100
                                  )}%`,
                                }}
                              />
                            </div>

                            <div className="w-16 text-right text-xs f-mono text-emerald-400">
                              {formatQty(row.inbound)}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="w-16 text-[10px] uppercase tracking-wider text-slate-600">
                              Out
                            </div>

                            <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className="h-full bg-red-500/70"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    (row.outbound /
                                      maxCategoryMovement) *
                                      100
                                  )}%`,
                                }}
                              />
                            </div>

                            <div className="w-16 text-right text-xs f-mono text-red-400">
                              {formatQty(row.outbound)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* FILTERS */}
            <Panel title="Stock Movement Detail" icon={ArrowLeftRight}>
              <div className="flex flex-col md:flex-row gap-3 mb-5">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search part no., SKU, category..."
                  className="flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-orange-500/50"
                />

                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-orange-500/50"
                >
                  <option value="All">All Trades</option>

                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr>
                      <Th>Part No.</Th>
                      <Th>SKU</Th>
                      <Th>Category</Th>
                      <Th className="text-right">On Hand</Th>
                      <Th className="text-right">Inbound</Th>
                      <Th className="text-right">Outbound</Th>
                      <Th className="text-right">Net Movement</Th>
                      <Th className="text-right">Net Value</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-t border-slate-800/70"
                      >
                        <Td className="f-mono text-slate-100">
                          {row.part_no}
                        </Td>

                        <Td className="f-mono text-slate-400">
                          {row.sku}
                        </Td>

                        <Td>
                          <TradeBadge category={row.category} />
                        </Td>

                        <Td className="text-right f-mono text-slate-300">
                          {formatQty(row.current_qty)}
                        </Td>

                        <Td className="text-right f-mono text-emerald-400">
                          +{formatQty(row.inbound_qty)}
                        </Td>

                        <Td className="text-right f-mono text-red-400">
                          -{formatQty(row.outbound_qty)}
                        </Td>

                        <Td
                          className={`text-right f-mono ${
                            row.net_qty >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {row.net_qty >= 0 ? "+" : ""}
                          {formatQty(row.net_qty)}
                        </Td>

                        <Td
                          className={`text-right f-mono ${
                            row.net_value >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {money(row.net_value)}
                        </Td>
                      </tr>
                    ))}

                    {filteredRows.length === 0 && (
                      <tr>
                        <Td
                          className="text-slate-500"
                          colSpan={8}
                        >
                          No stock movement records found.
                        </Td>
                      </tr>
                    )}
                  </tbody>

                  {filteredRows.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-slate-700">
                        <Td
                          colSpan={3}
                          className="text-slate-300 font-medium"
                        >
                          TOTAL
                        </Td>

                        <Td className="text-right f-mono text-slate-100">
                          {formatQty(
                            filteredRows.reduce(
                              (sum, row) =>
                                sum + row.current_qty,
                              0
                            )
                          )}
                        </Td>

                        <Td className="text-right f-mono text-emerald-400">
                          +{formatQty(totals.inbound)}
                        </Td>

                        <Td className="text-right f-mono text-red-400">
                          -{formatQty(totals.outbound)}
                        </Td>

                        <Td
                          className={`text-right f-mono ${
                            totals.net >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {totals.net >= 0 ? "+" : ""}
                          {formatQty(totals.net)}
                        </Td>

                        <Td
                          className={`text-right f-mono ${
                            totals.netValue >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {money(totals.netValue)}
                        </Td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Panel>

            {/* VALUE SUMMARY */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
                <div className="flex items-center gap-3">
                  <ArrowDownToLine
                    size={17}
                    className="text-emerald-400"
                  />

                  <span className="text-xs uppercase tracking-widest text-slate-500">
                    Inbound Value
                  </span>
                </div>

                <div className="mt-3 text-xl f-mono text-emerald-400">
                  {money(totals.inboundValue)}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
                <div className="flex items-center gap-3">
                  <ArrowUpFromLine
                    size={17}
                    className="text-red-400"
                  />

                  <span className="text-xs uppercase tracking-widest text-slate-500">
                    Outbound Value
                  </span>
                </div>

                <div className="mt-3 text-xl f-mono text-red-400">
                  {money(totals.outboundValue)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Nav>
  );
}

function BarChartIcon(props) {
  return <Package {...props} />;
}