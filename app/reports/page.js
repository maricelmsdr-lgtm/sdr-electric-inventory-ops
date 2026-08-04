"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Briefcase, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, TradeBadge, Gauge, money, TRADE_STYLES } from "@/components/ui";

const CATEGORIES = ["Electrical", "Plumbing", "HVAC", "General"];

export default function ReportsPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState(null);
  const [parts, setParts] = useState([]);
  const [jobs, setJobs] = useState([]);
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
      ] = await Promise.all([
        supabase.from("parts").select("*").eq("org_id", orgId),
        supabase.from("jobs").select("*, job_line_items(*)").eq("org_id", orgId),
      ]);
      setError(partsErr?.message || jobsErr?.message || "");
      setParts(partsData || []);
      setJobs(jobsData || []);
      setLoading(false);
    })();
  }, [orgId]);

  const byCategory = CATEGORIES.map((cat) => ({
    cat,
    value: parts.filter((p) => p.category === cat).reduce((s, p) => s + p.qty * p.unit_cost, 0),
  })).filter((c) => c.value > 0);
  const maxVal = Math.max(...byCategory.map((c) => c.value), 1);

  const jobsSales = jobs.reduce((s, j) => s + (j.job_line_items || []).reduce((a, li) => a + li.qty * li.sale_cost, 0), 0);
  const jobsCost = jobs.reduce((s, j) => s + (j.job_line_items || []).reduce((a, li) => a + li.qty * li.part_cost, 0), 0);

  const lowStockParts = parts.filter((p) => p.qty <= p.min_reorder);

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 f-body">
      <Nav />
      <div className="p-4 md:p-6 space-y-4">
        {error && <div className="text-sm text-red-400">{error}</div>}
        {loading ? (
          <div className="text-sm text-slate-500">Loading reports...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Inventory Value by Trade" icon={BarChart3}>
                <div className="space-y-3">
                  {byCategory.map((c) => {
                    const s = TRADE_STYLES[c.cat];
                    return (
                      <div key={c.cat}>
                        <div className="flex justify-between text-xs f-mono text-slate-400 mb-1">
                          <span>{c.cat}</span><span>{money(c.value)}</span>
                        </div>
                        <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className={`h-full ${s.dot}`} style={{ width: `${(c.value / maxVal) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {byCategory.length === 0 && <div className="text-sm text-slate-500">No inventory value yet.</div>}
                </div>
              </Panel>
              <Panel title="Job Profitability" icon={Briefcase}>
                <div className="flex items-center justify-around py-3">
                  <Gauge value={Math.round(jobsCost)} max={Math.max(jobsSales, 100)} label="Parts Cost" color="#f97316" />
                  <Gauge value={Math.round(jobsSales)} max={Math.max(jobsSales, 100)} label="Sales Total" color="#34d399" />
                </div>
                <div className="text-center text-sm text-slate-400 mt-1">
                  Margin: <b className="text-emerald-400">{money(jobsSales - jobsCost)}</b>{" "}
                  ({jobsSales ? Math.round(((jobsSales - jobsCost) / jobsSales) * 100) : 0}%)
                </div>
              </Panel>
            </div>

            <Panel title="Reorder Report" icon={AlertTriangle}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr>
                      <Th>Part No.</Th><Th>SKU</Th><Th>Category</Th>
                      <Th className="text-right">On Hand</Th><Th className="text-right">Min</Th><Th className="text-right">Suggested Order Qty</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockParts.map((p) => (
                      <tr key={p.id} className="border-t border-slate-800/70">
                        <Td className="f-mono">{p.part_no}</Td>
                        <Td className="f-mono text-slate-400">{p.sku}</Td>
                        <Td><TradeBadge category={p.category} /></Td>
                        <Td className="text-right f-mono text-red-400">{p.qty}</Td>
                        <Td className="text-right f-mono text-slate-500">{p.min_reorder}</Td>
                        <Td className="text-right f-mono text-emerald-400">
                          {Math.max(p.min_reorder * 2 - p.qty, p.min_reorder)}
                        </Td>
                      </tr>
                    ))}
                    {lowStockParts.length === 0 && (
                      <tr><Td className="text-slate-500" colSpan={6}>Nothing to reorder right now.</Td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
