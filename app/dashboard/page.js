"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, Package, AlertTriangle, ShoppingCart, Briefcase, Truck, History,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, Badge, TradeBadge, money } from "@/components/ui";

const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");
const fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString() : "—");

function StatCard({ label, value, icon: Icon, accent }) {
  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] f-mono uppercase text-slate-500">{label}</span>
        {Icon && <Icon size={15} className={accent || "text-orange-500"} />}
      </div>
      <div className={`f-display text-2xl ${accent || "text-slate-100"}`}>{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState(null);
  const [parts, setParts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [pos, setPos] = useState([]);
  const [fleet, setFleet] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
        { data: jobsData, error: jobsErr },
        { data: posData, error: posErr },
        { data: fleetData, error: fleetErr },
        { data: activityData, error: actErr },
      ] = await Promise.all([
        supabase.from("parts").select("*").eq("org_id", orgId),
        supabase.from("jobs").select("*, job_line_items(*)").eq("org_id", orgId).order("job_date", { ascending: false }),
        supabase.from("purchase_orders").select("*").eq("org_id", orgId),
        supabase.from("fleet").select("*").eq("org_id", orgId),
        supabase.from("activity_log").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(6),
      ]);
      setError(partsErr?.message || jobsErr?.message || posErr?.message || fleetErr?.message || actErr?.message || "");
      setParts(partsData || []);
      setJobs(jobsData || []);
      setPos(posData || []);
      setFleet(fleetData || []);
      setActivity(activityData || []);
      setLoading(false);
    })();
  }, [orgId]);

  const lowStock = parts.filter((p) => p.qty <= p.min_reorder);
  const totalPartsValue = parts.reduce((s, p) => s + p.qty * p.unit_cost, 0);
  const openPOs = pos.filter((p) => p.status === "Ordered").length;
  const jobsSalesTotal = jobs.reduce((s, j) => s + (j.job_line_items || []).reduce((a, li) => a + li.qty * li.sale_cost, 0), 0);
  const jobsCostTotal = jobs.reduce((s, j) => s + (j.job_line_items || []).reduce((a, li) => a + li.qty * li.part_cost, 0), 0);

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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Catalog Value" value={money(totalPartsValue)} icon={Package} />
              <StatCard label="Low Stock" value={lowStock.length} icon={AlertTriangle} accent={lowStock.length > 0 ? "text-red-400" : "text-emerald-400"} />
              <StatCard label="Open POs" value={openPOs} icon={ShoppingCart} accent="text-sky-400" />
              <StatCard label="Job Margin" value={money(jobsSalesTotal - jobsCostTotal)} icon={Briefcase} accent="text-emerald-400" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Panel title="Recent Jobs" icon={Briefcase} className="lg:col-span-2">
                <table className="w-full">
                  <thead><tr><Th>Job No.</Th><Th>Client</Th><Th>Date</Th><Th className="text-right">Sales</Th></tr></thead>
                  <tbody>
                    {jobs.slice(0, 5).map((j) => (
                      <tr key={j.id} className="border-t border-slate-800/70">
                        <Td className="f-mono text-orange-400">{j.job_no}</Td>
                        <Td>{j.client}</Td>
                        <Td className="text-slate-400">{fmtDate(j.job_date)}</Td>
                        <Td className="text-right f-mono text-emerald-400">
                          {money((j.job_line_items || []).reduce((a, li) => a + li.qty * li.sale_cost, 0))}
                        </Td>
                      </tr>
                    ))}
                    {jobs.length === 0 && <tr><Td colSpan={4} className="text-slate-500">No jobs logged yet.</Td></tr>}
                  </tbody>
                </table>
              </Panel>

              <Panel title="Reorder Alerts" icon={AlertTriangle}>
                <div className="space-y-2">
                  {lowStock.length === 0 && <div className="text-sm text-slate-500">All parts above minimum. Nice.</div>}
                  {lowStock.map((p) => (
                    <div key={p.id} className="flex items-center justify-between bg-red-500/5 border border-red-500/20 rounded px-3 py-2">
                      <div>
                        <div className="f-mono text-sm text-slate-200">{p.part_no}</div>
                        <div className="text-[11px] text-slate-500">{p.sku}</div>
                      </div>
                      <div className="text-right">
                        <div className="f-mono text-sm text-red-400">{p.qty}/{p.min_reorder}</div>
                        <TradeBadge category={p.category} />
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

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