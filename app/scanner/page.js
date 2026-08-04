"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine, History } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Badge, TradeBadge, inputCls } from "@/components/ui";

export default function ScannerPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [scanValue, setScanValue] = useState("");
  const [scanResult, setScanResult] = useState(null); // undefined = not scanned yet, null = no match, object = found
  const [scanHistory, setScanHistory] = useState([]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUser(user);
      const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
      setOrgId(profile?.org_id || null);
    })();
  }, [router]);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from("parts").select("*").eq("org_id", orgId);
      if (error) setError(error.message);
      else setParts(data || []);
      setLoading(false);
    })();
  }, [orgId]);

  const logActivity = async (message) => {
    if (!user || !orgId) return;
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const handleScan = async (val) => {
    if (!val) return;
    const found = parts.find(
      (p) => p.sku.toLowerCase() === val.toLowerCase() || p.part_no.toLowerCase() === val.toLowerCase()
    );
    setScanResult(found || null);
    setScanHistory((prev) => [
      { id: `${Date.now()}`, code: val, ts: new Date().toLocaleTimeString(), found: !!found },
      ...prev,
    ].slice(0, 12));
    if (found) await logActivity(`Scanned ${found.part_no} (${found.sku})`);
  };

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Barcode Scanner">
      <div className="p-4 md:p-6">
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title="Scan / Enter Code" icon={ScanLine}>
            <div className="flex flex-col items-center py-6">
              <div className="w-full max-w-xs aspect-square border-2 border-dashed border-slate-700 rounded-lg flex items-center justify-center mb-4">
                <ScanLine size={48} className="text-slate-600" />
              </div>
              <input
                autoFocus
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { handleScan(scanValue); setScanValue(""); } }}
                placeholder="Scan barcode or type SKU / Part No. + Enter"
                className={`${inputCls} max-w-xs text-center f-mono`}
                disabled={loading}
              />
              <button
                onClick={() => { handleScan(scanValue); setScanValue(""); }}
                className="mt-3 text-orange-400 text-xs f-mono hover:text-orange-300"
              >
                Simulate Scan ↵
              </button>
            </div>
            {loading && <div className="text-sm text-slate-500 text-center">Loading parts catalog...</div>}
            {!loading && scanResult !== null && scanResult !== undefined && (
              scanResult ? (
                <div className="border border-emerald-400/30 bg-emerald-400/5 rounded p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="f-mono text-slate-100">{scanResult.part_no}</span>
                    <TradeBadge category={scanResult.category} />
                  </div>
                  <div className="text-sm text-slate-400">{scanResult.description || "No description"}</div>
                  <div className="flex gap-6 mt-2 text-sm f-mono">
                    <span>Qty: <b className="text-slate-100">{scanResult.qty}</b></span>
                    <span>Location: <b className="text-slate-100">{scanResult.location || "—"}</b></span>
                  </div>
                </div>
              ) : (
                <div className="border border-red-400/30 bg-red-400/5 rounded p-4 text-sm text-red-400">
                  No matching part found for that code.
                </div>
              )
            )}
          </Panel>

          <Panel title="Scan History" icon={History}>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {scanHistory.length === 0 && <div className="text-sm text-slate-500">No scans yet this session.</div>}
              {scanHistory.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm border-b border-slate-800/60 pb-2">
                  <span className="f-mono text-slate-300">{s.code}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">{s.ts}</span>
                    <Badge className={s.found ? "border-emerald-400/30 text-emerald-400" : "border-red-400/30 text-red-400"}>
                      {s.found ? "Found" : "No Match"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </Nav>
  );
}
