"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileText,
  PackageCheck,
  ShoppingCart,
  Truck,
  XCircle,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, money } from "@/components/ui";

const STATUS_STYLES = {
  Draft: {
    label: "Draft",
    className: "text-slate-400 border-slate-700 bg-slate-800/40",
    icon: FileText,
  },
  Ordered: {
    label: "Ordered",
    className: "text-amber-400 border-amber-500/30 bg-amber-500/5",
    icon: Clock3,
  },
  Received: {
    label: "Received",
    className: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
    icon: CheckCircle2,
  },
  Cancelled: {
    label: "Cancelled",
    className: "text-red-400 border-red-500/30 bg-red-500/5",
    icon: XCircle,
  },
};

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMonth(value) {
  const date = new Date(`${value}-01T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
  });
}

function StatusBadge({ status }) {
  const config = STATUS_STYLES[status] || STATUS_STYLES.Ordered;
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-wider ${config.className}`}
    >
      <Icon size={12} />
      {status || "Ordered"}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, detail }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-slate-600">
            {label}
          </div>

          <div className="mt-2 text-xl font-semibold text-slate-100">
            {value}
          </div>

          {detail && (
            <div className="mt-1 text-[11px] text-slate-500">{detail}</div>
          )}
        </div>

        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-orange-500/20 bg-orange-500/5">
          <Icon size={16} className="text-orange-400" />
        </div>
      </div>
    </div>
  );
}

export default function PurchaseReportPage() {
  const router = useRouter();

  const [orgId, setOrgId] = useState(null);

  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [lineItems, setLineItems] = useState([]);
  const [parts, setParts] = useState([]);
  const [stockIns, setStockIns] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [vendorFilter, setVendorFilter] = useState("All");

  /*
   * ---------------------------------------------------------
   * AUTH / ORGANIZATION
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
   * LOAD PURCHASE DATA
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (!orgId) return;

    let mounted = true;

    (async () => {
      setLoading(true);
      setError("");

      const [
        { data: poData, error: poError },
        { data: lineData, error: lineError },
        { data: partsData, error: partsError },
        { data: stockInData, error: stockInError },
      ] = await Promise.all([
        supabase
          .from("purchase_orders")
          .select("*")
          .eq("org_id", orgId)
          .order("po_date", { ascending: false }),

        supabase
          .from("po_line_items")
          .select("*")
          .order("id", { ascending: true }),

        supabase
          .from("parts")
          .select("id, part_no, sku, description, category, unit_cost")
          .eq("org_id", orgId),

        supabase
          .from("stock_ins")
          .select("*")
          .eq("org_id", orgId)
          .order("received_date", { ascending: false }),
      ]);

      if (!mounted) return;

      const firstError =
        poError?.message ||
        lineError?.message ||
        partsError?.message ||
        stockInError?.message ||
        "";

      setError(firstError);

      setPurchaseOrders(poData || []);
      setLineItems(lineData || []);
      setParts(partsData || []);
      setStockIns(stockInData || []);

      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [orgId]);

  /*
   * ---------------------------------------------------------
   * LOOKUP MAPS
   * ---------------------------------------------------------
   */

  const partMap = useMemo(() => {
    const map = new Map();

    parts.forEach((part) => {
      map.set(part.id, part);
    });

    return map;
  }, [parts]);

  const lineItemsByPo = useMemo(() => {
    const map = new Map();

    lineItems.forEach((line) => {
      if (!map.has(line.po_id)) {
        map.set(line.po_id, []);
      }

      map.get(line.po_id).push(line);
    });

    return map;
  }, [lineItems]);

  const receivedByPo = useMemo(() => {
    const map = new Map();

    stockIns.forEach((stockIn) => {
      const poRef = String(stockIn.po_ref || "").trim();

      if (!poRef) return;

      const current = map.get(poRef) || 0;

      map.set(poRef, current + Number(stockIn.qty || 0));
    });

    return map;
  }, [stockIns]);

  /*
   * ---------------------------------------------------------
   * NORMALIZED PURCHASE ORDERS
   * ---------------------------------------------------------
   */

  const purchaseRows = useMemo(() => {
    return purchaseOrders.map((po) => {
      const lines = lineItemsByPo.get(po.id) || [];

      const totalQty = lines.reduce(
        (sum, line) => sum + Number(line.qty || 0),
        0
      );

      const totalCost = lines.reduce(
        (sum, line) =>
          sum + Number(line.qty || 0) * Number(line.unit_cost || 0),
        0
      );

      const receivedQty = Number(receivedByPo.get(po.po_no) || 0);

      const pendingQty = Math.max(totalQty - receivedQty, 0);

      const status = po.status || "Ordered";

      return {
        ...po,
        lines,
        totalQty,
        totalCost,
        receivedQty,
        pendingQty,
        status,
      };
    });
  }, [purchaseOrders, lineItemsByPo, receivedByPo]);

  /*
   * ---------------------------------------------------------
   * VENDORS
   * ---------------------------------------------------------
   */

  const vendors = useMemo(() => {
    const values = purchaseRows
      .map((po) => String(po.vendor || "").trim())
      .filter(Boolean);

    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
  }, [purchaseRows]);

  /*
   * ---------------------------------------------------------
   * FILTERING
   * ---------------------------------------------------------
   */

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return purchaseRows.filter((po) => {
      const matchesSearch =
        !q ||
        String(po.po_no || "")
          .toLowerCase()
          .includes(q) ||
        String(po.vendor || "")
          .toLowerCase()
          .includes(q);

      const matchesStatus =
        statusFilter === "All" || po.status === statusFilter;

      const matchesVendor =
        vendorFilter === "All" || po.vendor === vendorFilter;

      return matchesSearch && matchesStatus && matchesVendor;
    });
  }, [purchaseRows, search, statusFilter, vendorFilter]);

  /*
   * ---------------------------------------------------------
   * SUMMARY METRICS
   * ---------------------------------------------------------
   */

  const summary = useMemo(() => {
    const activeRows = purchaseRows.filter(
      (po) => po.status !== "Cancelled"
    );

    const totalPurchaseValue = activeRows.reduce(
      (sum, po) => sum + po.totalCost,
      0
    );

    const totalOrderedQty = activeRows.reduce(
      (sum, po) => sum + po.totalQty,
      0
    );

    const totalReceivedQty = activeRows.reduce(
      (sum, po) => sum + po.receivedQty,
      0
    );

    const totalPendingQty = activeRows.reduce(
      (sum, po) => sum + po.pendingQty,
      0
    );

    const receivedOrders = activeRows.filter(
      (po) => po.status === "Received"
    ).length;

    const orderedOrders = activeRows.filter(
      (po) => po.status === "Ordered"
    ).length;

    return {
      totalPurchaseValue,
      totalOrderedQty,
      totalReceivedQty,
      totalPendingQty,
      totalOrders: activeRows.length,
      receivedOrders,
      orderedOrders,
    };
  }, [purchaseRows]);

  /*
   * ---------------------------------------------------------
   * VENDOR SUMMARY
   * ---------------------------------------------------------
   */

  const vendorSummary = useMemo(() => {
    const map = new Map();

    purchaseRows
      .filter((po) => po.status !== "Cancelled")
      .forEach((po) => {
        const vendor = po.vendor || "Unknown Vendor";

        const existing = map.get(vendor) || {
          vendor,
          orders: 0,
          qty: 0,
          value: 0,
          received: 0,
          pending: 0,
        };

        existing.orders += 1;
        existing.qty += po.totalQty;
        existing.value += po.totalCost;
        existing.received += po.receivedQty;
        existing.pending += po.pendingQty;

        map.set(vendor, existing);
      });

    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [purchaseRows]);

  const maxVendorValue = Math.max(
    ...vendorSummary.map((vendor) => vendor.value),
    1
  );

  /*
   * ---------------------------------------------------------
   * MONTHLY PURCHASE TREND
   * ---------------------------------------------------------
   */

  const monthlySummary = useMemo(() => {
    const map = new Map();

    purchaseRows
      .filter((po) => po.status !== "Cancelled")
      .forEach((po) => {
        if (!po.po_date) return;

        const key = String(po.po_date).slice(0, 7);

        const existing = map.get(key) || {
          month: key,
          value: 0,
          orders: 0,
        };

        existing.value += po.totalCost;
        existing.orders += 1;

        map.set(key, existing);
      });

    return [...map.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6);
  }, [purchaseRows]);

  const maxMonthlyValue = Math.max(
    ...monthlySummary.map((month) => month.value),
    1
  );

  /*
   * ---------------------------------------------------------
   * RECENT PURCHASES
   * ---------------------------------------------------------
   */

  const recentRows = filteredRows.slice(0, 50);

  /*
   * ---------------------------------------------------------
   * LOADING STATE
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
    <Nav title="Purchase Report">
      <div className="min-h-full bg-slate-950 p-4 md:p-6 space-y-5">
        {/* HEADER */}

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Link
                href="/reports"
                className="flex h-8 w-8 items-center justify-center rounded border border-slate-800 bg-slate-900 text-slate-500 transition hover:border-slate-700 hover:text-orange-400"
              >
                <ArrowLeft size={15} />
              </Link>

              <div>
                <h1 className="text-lg font-semibold tracking-wide text-slate-100">
                  PURCHASE REPORT
                </h1>

                <p className="mt-1 text-xs text-slate-500">
                  Monitor purchase orders, vendor spending, receiving activity,
                  and outstanding quantities.
                </p>
              </div>
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
            Loading purchase report...
          </div>
        ) : (
          <>
            {/* SUMMARY CARDS */}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                icon={ShoppingCart}
                label="Purchase Value"
                value={money(summary.totalPurchaseValue)}
                detail={`${summary.totalOrders} active purchase orders`}
              />

              <StatCard
                icon={PackageCheck}
                label="Ordered Qty"
                value={summary.totalOrderedQty.toLocaleString()}
                detail={`${summary.totalReceivedQty.toLocaleString()} received`}
              />

              <StatCard
                icon={Truck}
                label="Pending Qty"
                value={summary.totalPendingQty.toLocaleString()}
                detail={`${summary.orderedOrders} orders still open`}
              />

              <StatCard
                icon={CheckCircle2}
                label="Received Orders"
                value={summary.receivedOrders.toLocaleString()}
                detail="Purchase orders completed"
              />
            </div>

            {/* GRAPHS */}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* MONTHLY PURCHASE TREND */}

              <Panel title="Purchase Trend" icon={BarChart3}>
                {monthlySummary.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">
                    No purchase data available.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex h-52 items-end gap-3 border-b border-slate-800 px-2 pb-2">
                      {monthlySummary.map((month) => {
                        const height = Math.max(
                          (month.value / maxMonthlyValue) * 100,
                          3
                        );

                        return (
                          <div
                            key={month.month}
                            className="flex h-full flex-1 flex-col justify-end"
                          >
                            <div className="mb-2 text-center text-[9px] text-slate-500">
                              {money(month.value)}
                            </div>

                            <div
                              className="w-full rounded-t bg-orange-500/70 transition-all hover:bg-orange-400"
                              style={{
                                height: `${height}%`,
                                minHeight: "4px",
                              }}
                              title={`${month.month}: ${money(month.value)}`}
                            />

                            <div className="mt-2 text-center text-[10px] uppercase tracking-wider text-slate-600">
                              {formatMonth(month.month)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Panel>

              {/* VENDOR SPENDING */}

              <Panel title="Purchase Value by Vendor" icon={ShoppingCart}>
                {vendorSummary.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">
                    No vendor purchase data available.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {vendorSummary.slice(0, 6).map((vendor) => (
                      <div key={vendor.vendor}>
                        <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                          <span className="truncate text-slate-400">
                            {vendor.vendor}
                          </span>

                          <span className="f-mono shrink-0 text-slate-300">
                            {money(vendor.value)}
                          </span>
                        </div>

                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-400/70"
                            style={{
                              width: `${
                                (vendor.value / maxVendorValue) * 100
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            {/* FILTERS */}

            <Panel title="Purchase Orders" icon={FileText}>
              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-slate-600">
                    Search
                  </label>

                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="PO number or vendor..."
                    className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none transition placeholder:text-slate-700 focus:border-orange-500/50"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-slate-600">
                    Status
                  </label>

                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-orange-500/50"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Draft">Draft</option>
                    <option value="Ordered">Ordered</option>
                    <option value="Received">Received</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-slate-600">
                    Vendor
                  </label>

                  <select
                    value={vendorFilter}
                    onChange={(event) => setVendorFilter(event.target.value)}
                    className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-orange-500/50"
                  >
                    <option value="All">All Vendors</option>

                    {vendors.map((vendor) => (
                      <option key={vendor} value={vendor}>
                        {vendor}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* TABLE */}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px]">
                  <thead>
                    <tr>
                      <Th>PO No.</Th>
                      <Th>Date</Th>
                      <Th>Vendor</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Lines</Th>
                      <Th className="text-right">Ordered</Th>
                      <Th className="text-right">Received</Th>
                      <Th className="text-right">Pending</Th>
                      <Th className="text-right">Purchase Value</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {recentRows.map((po) => (
                      <tr
                        key={po.id}
                        className="border-t border-slate-800/70 transition hover:bg-slate-900/60"
                      >
                        <Td className="f-mono font-medium text-slate-200">
                          {po.po_no || "—"}
                        </Td>

                        <Td className="text-slate-400">
                          {formatDate(po.po_date)}
                        </Td>

                        <Td className="text-slate-300">
                          {po.vendor || "—"}
                        </Td>

                        <Td>
                          <StatusBadge status={po.status} />
                        </Td>

                        <Td className="text-right f-mono text-slate-400">
                          {po.lines.length}
                        </Td>

                        <Td className="text-right f-mono text-slate-300">
                          {po.totalQty.toLocaleString()}
                        </Td>

                        <Td className="text-right f-mono text-emerald-400">
                          {po.receivedQty.toLocaleString()}
                        </Td>

                        <Td className="text-right f-mono text-amber-400">
                          {po.pendingQty.toLocaleString()}
                        </Td>

                        <Td className="text-right f-mono font-medium text-slate-100">
                          {money(po.totalCost)}
                        </Td>
                      </tr>
                    ))}

                    {recentRows.length === 0 && (
                      <tr>
                        <Td
                          colSpan={9}
                          className="py-10 text-center text-slate-500"
                        >
                          No purchase orders match the current filters.
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-[10px] uppercase tracking-widest text-slate-600">
                <span>
                  Showing {recentRows.length} of {purchaseRows.length} purchase
                  orders
                </span>

                <span>
                  Total: {money(
                    filteredRows
                      .filter((po) => po.status !== "Cancelled")
                      .reduce((sum, po) => sum + po.totalCost, 0)
                  )}
                </span>
              </div>
            </Panel>

            {/* VENDOR DETAIL */}

            <Panel title="Vendor Purchase Summary" icon={BarChart3}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead>
                    <tr>
                      <Th>Vendor</Th>
                      <Th className="text-right">Orders</Th>
                      <Th className="text-right">Ordered Qty</Th>
                      <Th className="text-right">Received</Th>
                      <Th className="text-right">Pending</Th>
                      <Th className="text-right">Purchase Value</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {vendorSummary.map((vendor) => (
                      <tr
                        key={vendor.vendor}
                        className="border-t border-slate-800/70"
                      >
                        <Td className="font-medium text-slate-300">
                          {vendor.vendor}
                        </Td>

                        <Td className="text-right f-mono text-slate-400">
                          {vendor.orders}
                        </Td>

                        <Td className="text-right f-mono text-slate-400">
                          {vendor.qty.toLocaleString()}
                        </Td>

                        <Td className="text-right f-mono text-emerald-400">
                          {vendor.received.toLocaleString()}
                        </Td>

                        <Td className="text-right f-mono text-amber-400">
                          {vendor.pending.toLocaleString()}
                        </Td>

                        <Td className="text-right f-mono text-slate-100">
                          {money(vendor.value)}
                        </Td>
                      </tr>
                    ))}

                    {vendorSummary.length === 0 && (
                      <tr>
                        <Td
                          colSpan={6}
                          className="py-8 text-center text-slate-500"
                        >
                          No vendor purchase data available.
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* REPORT FOOTER */}

            <div className="flex flex-col gap-2 border-t border-slate-900 pt-3 text-[10px] uppercase tracking-widest text-slate-700 md:flex-row md:items-center md:justify-between">
              <span>Purchase Report</span>

              <span>
                Purchase orders • Receiving • Vendor spend • Outstanding qty
              </span>
            </div>
          </>
        )}
      </div>
    </Nav>
  );
}