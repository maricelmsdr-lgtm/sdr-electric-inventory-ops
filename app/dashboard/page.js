"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, Package, AlertTriangle, ShoppingCart, Briefcase, Truck, History,
  Warehouse, ArrowRight, ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, Badge, TradeBadge, money } from "@/components/ui";

const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");
const fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString() : "—");

const STATUS_STYLES = {
  Open: "border-slate-600 text-slate-400",
  Ordered: "border-sky-400/30 text-sky-400",
  Received: "border-emerald-400/30 text-emerald-400",
  Cancelled: "border-red-400/30 text-red-400",
};

function StatCard({ label, value, icon: Icon, accent, warning, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`bg-slate-900/70 border rounded-lg p-4 text-left transition ${
        warning ? "border-red-500/40" : "border-slate-800 hover:border-slate-700"
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] f-mono uppercase text-slate-500">{label}</span>
        {Icon && <Icon size={15} className={accent || "text-orange-500"} />}
      </div>
      <div className={`f-display text-2xl ${accent || "text-slate-100"}`}>{value}</div>
      {warning && (
        <div className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
          <AlertTriangle size={10} /> Unexpected negative value — check inventory data
        </div>
      )}
    </button>
  );
}

const MARGIN_RANGES = [
  { key: "week", label: "This Week", days: 7 },
  { key: "month", label: "This Month", days: 30 },
  { key: "all", label: "All Time", days: null },
];

export default function DashboardPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState(null);
  const [parts, setParts] = useState([]);
  const [lowStockParts, setLowStockParts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [pos, setPos] = useState([]);
  const [fleet, setFleet] = useState([]);
  const [activity, setActivity] = useState([]);
  const [inventoryByType, setInventoryByType] = useState({ warehouse: 0, truck: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [marginRange, setMarginRange] = useState("month");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
      setOrgId(profile?.org_id || null);
    })();
  }, [router]);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      setLoading(true);
      const [
        { data: partsData, error: partsErr },
        { data: lowStockData, error: lowStockErr },
        { data: jobsData, error: jobsErr },
        { data: posData, error: posErr },
        { data: fleetData, error: fleetErr },
        { data: activityData, error: actErr },
        { data: balancesData, error: balErr },
      ] = await Promise.all([
        supabase.from("parts").select("*").eq("org_id", orgId),
        // Real low-stock set, same source of truth the Parts page already
        // uses (is_low_stock generated column) — not a client-side guess.
        supabase.from("parts").select("*").eq("org_id", orgId).eq("is_low_stock", true).order("qty").limit(8),
        supabase.from("jobs").select("*, job_line_items(*)").eq("org_id", orgId).order("job_date", { ascending: false }),
        supabase.from("purchase_orders").select("*, po_line_items(*)").eq("org_id", orgId).order("po_date", { ascending: false }),
        supabase.from("fleet").select("*").eq("org_id", orgId),
        supabase.from("activity_log").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(6),
        supabase.from("inventory_balances").select("quantity_on_hand, part_id, locations(type), parts(unit_cost)").eq("org_id", orgId),
      ]);

      setError(
        partsErr?.message || lowStockErr?.message || jobsErr?.message ||
        posErr?.message || fleetErr?.message || actErr?.message || balErr?.message || ""
      );

      setParts(partsData || []);
      setLowStockParts(lowStockData || []);
      setJobs(jobsData || []);
      setPos(posData || []);
      setFleet(fleetData || []);
      setActivity(activityData || []);

      // Catalog value split by location type — surfaces whether a
      // shortage is at the warehouse or out on a truck, instead of
      // one blended number.
      let warehouse = 0, truck = 0;
      for (const row of balancesData || []) {
        const val = Number(row.quantity_on_hand || 0) * Number(row.parts?.unit_cost || 0);
        if (row.locations?.type === "WAREHOUSE") warehouse += val;
        else if (row.locations?.type === "TRUCK") truck += val;
      }
      setInventoryByType({ warehouse, truck });

      setLoading(false);
    })();
  }, [orgId]);

  const totalPartsValue = inventoryByType.warehouse + inventoryByType.truck;
  const openPOs = pos.filter((p) => p.status === "Open" || p.status === "Ordered");

  const marginCutoffDays = MARGIN_RANGES.find((r) => r.key === marginRange)?.days;
  const jobsInRange = marginCutoffDays
    ? jobs.filter((j) => {
        const days = (Date.now() - new Date(j.job_date).getTime()) / 86400000;
        return days <= marginCutoffDays;
      })
    : jobs;

  const salesTotal = jobsInRange.reduce((s, j) => s + (j.job_line_items || []).reduce((a, li) => a + li.qty * li.sale_cost, 0), 0);
  const costTotal = jobsInRange.reduce((s, j) => s + (j.job_line_items || []).reduce((a, li) => a + li.qty * li.part_cost, 0), 0);
  const margin = salesTotal - costTotal;

  const poReceivable = (po) =>
    (po.po_line_items || []).reduce((s, li) => s + (Number(li.qty) - Number(li.qty_received || 0)), 0);

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Dashboard">
      <div className="p-4 md:p-6 space-y-6">
        {error && <div className="text-sm text-red-400">{error}</div>}
        {loading ? (
          <div className="text-sm text-slate-500">Loading dashboard...</div>
        ) : (
          <>
            {/* ================= STAT CARDS ================= */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Low Stock"
                value={lowStockParts.length}
                icon={AlertTriangle}
                accent={lowStockParts.length > 0 ? "text-red-400" : "text-emerald-400"}
                onClick={() => router.push("/parts?lowStock=1")}
              />
              <StatCard
                label="Open POs"
                value={openPOs.length}
                icon={ShoppingCart}
                accent="text-sky-400"
                onClick={() => router.push("/purchase-orders")}
              />
              <StatCard
                label="Catalog Value"
                value={money(totalPartsValue)}
                icon={Package}
                warning={totalPartsValue < 0}
                onClick={() => router.push("/parts")}
              />
              <StatCard
                label={`Job Margin (${MARGIN_RANGES.find((r) => r.key === marginRange)?.label})`}
                value={money(margin)}
                icon={Briefcase}
                accent="text-emerald-400"
                warning={margin < 0}
                onClick={() => router.push("/jobs")}
              />
            </div>

            <div className="flex justify-end gap-1.5 -mt-3">
              {MARGIN_RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setMarginRange(r.key)}
                  className={`text-[11px] f-mono px-2 py-1 rounded border ${
                    marginRange === r.key
                      ? "border-orange-500/50 text-orange-400 bg-orange-500/10"
                      : "border-slate-800 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* ================= WAREHOUSE VS TRUCK VALUE ================= */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs f-mono uppercase text-slate-500">
                  <Warehouse size={13} /> Warehouse Value
                </div>
                <div className={`f-mono text-sm ${inventoryByType.warehouse < 0 ? "text-red-400" : "text-slate-200"}`}>
                  {money(inventoryByType.warehouse)}
                </div>
              </div>
              <div className="bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs f-mono uppercase text-slate-500">
                  <Truck size={13} /> Truck Value
                </div>
                <div className={`f-mono text-sm ${inventoryByType.truck < 0 ? "text-red-400" : "text-slate-200"}`}>
                  {money(inventoryByType.truck)}
                </div>
              </div>
            </div>

            {/* ================= ALERTS + PURCHASE ORDERS (LEAD POSITION) ================= */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Reorder Alerts" icon={AlertTriangle}>
                <div className="space-y-2">
                  {lowStockParts.length === 0 && <div className="text-sm text-slate-500">All parts above minimum. Nice.</div>}
                  {lowStockParts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => router.push("/parts")}
                      className="w-full flex items-center justify-between bg-red-500/5 border border-red-500/20 rounded px-3 py-2 hover:bg-red-500/10 text-left"
                    >
                      <div>
                        <div className="f-mono text-sm text-slate-200">{p.part_no}</div>
                        <div className="text-[11px] text-slate-500">{p.sku}</div>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <div>
                          <div className="f-mono text-sm text-red-400">{p.qty}/{p.min_reorder}</div>
                          <TradeBadge category={p.category} />
                        </div>
                        <ChevronRight size={14} className="text-slate-600" />
                      </div>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Open Purchase Orders" icon={ShoppingCart}>
                <div className="space-y-2">
                  {openPOs.length === 0 && <div className="text-sm text-slate-500">No open purchase orders.</div>}
                  {openPOs.slice(0, 8).map((po) => {
                    const receivable = poReceivable(po);
                    return (
                      <button
                        key={po.id}
                        onClick={() => router.push(`/purchase-orders/${po.id}`)}
                        className="w-full flex items-center justify-between border border-slate-800 rounded px-3 py-2 hover:bg-slate-900/60 text-left"
                      >
                        <div>
                          <div className="f-mono text-sm text-orange-400">{po.po_no}</div>
                          <div className="text-[11px] text-slate-500">{po.vendor}</div>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <div>
                            <Badge className={STATUS_STYLES[po.status] || STATUS_STYLES.Open}>{po.status}</Badge>
                            {receivable > 0 && (
                              <div className="text-[10px] f-mono text-sky-400 mt-0.5">{receivable} receivable</div>
                            )}
                          </div>
                          <ChevronRight size={14} className="text-slate-600" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            </div>

            {/* ================= RECENT JOBS ================= */}
            <Panel title="Recent Jobs" icon={Briefcase}>
              <table className="w-full">
                <thead><tr><Th>Job No.</Th><Th>Client</Th><Th>Date</Th><Th className="text-right">Sales</Th><Th></Th></tr></thead>
                <tbody>
                  {jobs.slice(0, 5).map((j) => (
                    <tr
                      key={j.id}
                      onClick={() => router.push(`/jobs/${j.id}`)}
                      className="border-t border-slate-800/70 hover:bg-slate-900/40 cursor-pointer"
                    >
                      <Td className="f-mono text-orange-400">{j.job_no}</Td>
                      <Td>{j.client}</Td>
                      <Td className="text-slate-400">{fmtDate(j.job_date)}</Td>
                      <Td className="text-right f-mono text-emerald-400">
                        {money((j.job_line_items || []).reduce((a, li) => a + li.qty * li.sale_cost, 0))}
                      </Td>
                      <Td><ArrowRight size={13} className="text-slate-600" /></Td>
                    </tr>
                  ))}
                  {jobs.length === 0 && <tr><Td colSpan={5} className="text-slate-500">No jobs logged yet.</Td></tr>}
                </tbody>
              </table>
            </Panel>

            {/* ================= FLEET + ACTIVITY ================= */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Fleet Snapshot" icon={Truck}>
                <div className="grid grid-cols-2 gap-3">
                  {fleet.map((t) => (
                    <div key={t.id} className="border border-slate-800 rounded px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="f-mono text-sm text-slate-200">{t.truck_number}</span>
                        <Badge className={t.status === "Active" ? "border-emerald-400/30 text-emerald-400" : "border-slate-600 text-slate-400"}>{t.status}</Badge>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{t.nickname} · {t.driver || "Unassigned"}</div>
                    </div>
                  ))}
                  {fleet.length === 0 && <div className="text-sm text-slate-500 col-span-2">No trucks added yet.</div>}
                </div>
              </Panel>
              <Panel title="Latest Activity" icon={History}>
                <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                  {activity.map((a) => (
                    <div key={a.id} className="text-sm text-slate-400 border-l-2 border-slate-800 pl-3">
                      <span className="text-slate-200">{a.message}</span>
                      <div className="text-[11px] f-mono text-slate-600 mt-0.5">{fmtDateTime(a.created_at)}</div>
                    </div>
                  ))}
                  {activity.length === 0 && <div className="text-sm text-slate-500">No activity yet.</div>}
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
    </Nav>
  );
}