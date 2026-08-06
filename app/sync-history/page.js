"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Briefcase, CheckCircle2, XCircle, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, Badge, SearchInput, money } from "@/components/ui";

const fmtDateTime = (d) => (d ? new Date(d).toLocaleString() : "—");
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");

const REVIEW_STATUS_STYLES = {
  pending: "border-amber-400/30 text-amber-400",
  resolved: "border-emerald-400/30 text-emerald-400",
  ignored: "border-slate-600 text-slate-500",
};

export default function SyncHistoryPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [reviewLog, setReviewLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
      setOrgId(profile?.org_id || null);
    })();
  }, [router]);

  useEffect(() => { if (orgId) fetchAll(); }, [orgId]);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: jobsData, error: jobsErr }, { data: reviewData, error: reviewErr }] = await Promise.all([
      supabase
        .from("jobs")
        .select("*, job_line_items(*, parts(part_no, sku))")
        .eq("org_id", orgId)
        .eq("synced_from_servicem8", true)
        .order("job_date", { ascending: false }),
      supabase
        .from("unmatched_materials")
        .select("*, jobs(job_no, client)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
    ]);
    setError(jobsErr?.message || reviewErr?.message || "");
    setJobs(jobsData || []);
    setReviewLog(reviewData || []);
    setLoading(false);
  };

  const filteredJobs = jobs.filter((j) =>
    `${j.job_no} ${j.client} ${j.address || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  const totalJobs = jobs.length;
  const syncedLineItems = jobs.flatMap((j) => (j.job_line_items || []).filter((li) => li.servicem8_material_uuid));
  const totalMaterials = syncedLineItems.length;
  const totalValueDeducted = syncedLineItems.reduce((sum, li) => sum + Number(li.qty) * Number(li.part_cost || 0), 0);
  const pendingReview = reviewLog.filter((r) => r.status === "pending").length;

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="ServiceM8 Sync History">
      <div className="p-4 md:p-6">
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4">
            <div className="text-2xl f-display text-slate-100">{totalJobs}</div>
            <div className="text-[11px] f-mono uppercase text-slate-500">Jobs Synced</div>
          </div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4">
            <div className="text-2xl f-display text-slate-100">{totalMaterials}</div>
            <div className="text-[11px] f-mono uppercase text-slate-500">Materials Deducted</div>
          </div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4">
            <div className="text-2xl f-display text-slate-100">{money(totalValueDeducted)}</div>
            <div className="text-[11px] f-mono uppercase text-slate-500">Value Deducted</div>
          </div>
          <div className={`bg-slate-900/70 border rounded-lg p-4 ${pendingReview > 0 ? "border-amber-400/30" : "border-slate-800"}`}>
            <div className={`text-2xl f-display ${pendingReview > 0 ? "text-amber-400" : "text-slate-100"}`}>{pendingReview}</div>
            <div className="text-[11px] f-mono uppercase text-slate-500">Pending Review</div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search job no, client, address..." />
        </div>

        <Panel title="Synced Jobs" icon={Briefcase} className="mb-6">
          {loading ? (
            <div className="text-sm text-slate-500 p-2">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr><Th>Job No.</Th><Th>Client</Th><Th>Date</Th><Th>Materials Deducted</Th><Th>Synced</Th></tr>
                </thead>
                <tbody>
                  {filteredJobs.map((j) => {
                    const lines = (j.job_line_items || []).filter((li) => li.servicem8_material_uuid);
                    return (
                      <tr key={j.id} className="border-t border-slate-800/70 hover:bg-slate-900/40 align-top">
                        <Td className="f-mono text-orange-400">{j.job_no}</Td>
                        <Td className="text-slate-200">{j.client}</Td>
                        <Td className="text-slate-400">{fmtDate(j.job_date)}</Td>
                        <Td>
                          {lines.length === 0 ? (
                            <span className="text-slate-600 text-xs">No materials</span>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              {lines.map((li) => (
                                <span key={li.id} className="text-xs text-slate-300">
                                  {li.qty} × {li.parts?.part_no || "—"} <span className="text-slate-500">({money(li.qty * li.part_cost)})</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </Td>
                        <Td className="text-slate-500 text-xs">{fmtDateTime(j.created_at)}</Td>
                      </tr>
                    );
                  })}
                  {filteredJobs.length === 0 && <tr><Td colSpan={5} className="text-slate-500">No jobs synced from ServiceM8 yet.</Td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Material Review Log" icon={History}>
          {loading ? (
            <div className="text-sm text-slate-500 p-2">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr><Th>Material</Th><Th>Job</Th><Th className="text-right">Qty</Th><Th>Reason</Th><Th>Status</Th><Th>Flagged</Th></tr>
                </thead>
                <tbody>
                  {reviewLog.map((r) => (
                    <tr key={r.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                      <Td className="text-slate-200">{r.raw_name}</Td>
                      <Td className="text-slate-400 text-xs">{r.jobs?.job_no || "—"} · {r.jobs?.client || "—"}</Td>
                      <Td className="text-right f-mono text-slate-300">{r.qty}</Td>
                      <Td className="text-slate-500 text-xs">{r.reason === "insufficient_stock" ? "Not enough stock" : "No matching part"}</Td>
                      <Td>
                        <Badge className={REVIEW_STATUS_STYLES[r.status] || REVIEW_STATUS_STYLES.pending}>
                          {r.status === "resolved" && <CheckCircle2 size={11} className="inline mr-1" />}
                          {r.status === "ignored" && <XCircle size={11} className="inline mr-1" />}
                          {r.status === "pending" && <Clock size={11} className="inline mr-1" />}
                          {r.status}
                        </Badge>
                      </Td>
                      <Td className="text-slate-500 text-xs">{fmtDateTime(r.created_at)}</Td>
                    </tr>
                  ))}
                  {reviewLog.length === 0 && <tr><Td colSpan={6} className="text-slate-500">Nothing flagged yet.</Td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </Nav>
  );
}
