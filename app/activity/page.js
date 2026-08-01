"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel } from "@/components/ui";

const fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString() : "—");

export default function ActivityLogPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState(null);
  const [log, setLog] = useState([]);
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
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(200);
      setError(error?.message || "");
      setLog(data || []);
      setLoading(false);
    })();
  }, [orgId]);

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 f-body">
      <Nav />
      <div className="p-4 md:p-6">
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        <Panel title="Activity Log" icon={History}>
          {loading ? (
            <div className="text-sm text-slate-500 p-2">Loading...</div>
          ) : (
            <div className="space-y-2.5 max-h-[70vh] overflow-y-auto pr-1">
              {log.map((a) => (
                <div key={a.id} className="text-sm text-slate-400 border-l-2 border-slate-800 pl-3 py-0.5">
                  <span className="text-slate-200">{a.message}</span>
                  <div className="text-[11px] f-mono text-slate-600 mt-0.5">{fmtDateTime(a.created_at)}</div>
                </div>
              ))}
              {log.length === 0 && <div className="text-sm text-slate-500">No activity recorded yet.</div>}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
