"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Badge } from "@/components/ui";

const PROVIDERS = [
  { key: "qbo", name: "QuickBooks Online", blurb: "Sync parts costs, POs, and job invoices to your books.", color: "text-emerald-400", border: "border-emerald-400/30", live: false },
  { key: "servicem8", name: "ServiceM8", blurb: "Pull job details and push parts usage back to jobs.", color: "text-sky-400", border: "border-sky-400/30", live: true },
  { key: "housecallpro", name: "Housecall Pro", blurb: "Match dispatched jobs to parts consumption automatically.", color: "text-violet-400", border: "border-violet-400/30", live: false },
  { key: "ghl", name: "GoHighLevel", blurb: "Trigger reorder & low-stock alerts into your automations.", color: "text-amber-400", border: "border-amber-400/30", live: false },
];

const ERROR_MESSAGES = {
  missing_session: "Your session expired — please refresh and try again.",
  invalid_session: "Couldn't verify your login — please refresh and try again.",
  no_org: "Couldn't find your organization.",
  not_configured: "ServiceM8 connection isn't configured on the server yet.",
  servicem8_denied: "ServiceM8 connection was cancelled.",
  invalid_callback: "Something went wrong completing the ServiceM8 connection.",
  state_mismatch: "That connection request looked suspicious, so we blocked it. Please try connecting again.",
  token_exchange_failed: "ServiceM8 rejected the connection request.",
  save_failed: "Connected to ServiceM8, but saving the connection failed. Try again.",
  unexpected: "Something unexpected went wrong connecting to ServiceM8.",
};

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>}>
      <IntegrationsPageInner />
    </Suspense>
  );
}

function IntegrationsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [rows, setRows] = useState([]); // rows from the integrations table
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    fetchIntegrations();
  }, [orgId]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const errKey = searchParams.get("error");
    if (connected) setNotice(`Connected to ${PROVIDERS.find((p) => p.key === connected)?.name || connected}.`);
    if (errKey) setError(ERROR_MESSAGES[errKey] || "Something went wrong.");
    if (connected || errKey) router.replace("/integrations");
  }, [searchParams, router]);

  const fetchIntegrations = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("integrations").select("*").eq("org_id", orgId);
    if (error) setError(error.message);
    else setRows(data || []);
    setLoading(false);
  };

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const isConnected = (key) => !!rows.find((r) => r.provider === key)?.connected;

  // Demo providers: just a status flag in our own database, no real API calls.
  const toggle = async (provider, name) => {
    setBusyKey(provider);
    setError("");
    const nowConnected = !isConnected(provider);
    const { error } = await supabase
      .from("integrations")
      .upsert(
        { org_id: orgId, provider, connected: nowConnected, connected_at: nowConnected ? new Date().toISOString() : null },
        { onConflict: "org_id,provider" }
      );
    if (error) {
      setError(error.message);
    } else {
      await logActivity(`${nowConnected ? "Connected" : "Disconnected"} ${name} integration`);
      await fetchIntegrations();
    }
    setBusyKey(null);
  };

  // ServiceM8: real OAuth 2.0 connection.
  const connectServiceM8 = async () => {
    setBusyKey("servicem8");
    setError("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError("Your session expired — please refresh and try again.");
      setBusyKey(null);
      return;
    }
    const res = await fetch("/api/integrations/servicem8/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: session.access_token }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) {
      setError(body.error || "Couldn't start the ServiceM8 connection.");
      setBusyKey(null);
      return;
    }
    window.location.href = body.url;
  };

  const disconnectServiceM8 = async () => {
    setBusyKey("servicem8");
    setError("");
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/integrations/servicem8/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: session?.access_token }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Failed to disconnect ServiceM8.");
    } else {
      await fetchIntegrations();
    }
    setBusyKey(null);
  };

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Integrations">
      <div className="p-4 md:p-6">
        {notice && <div className="text-sm text-emerald-400 mb-3">{notice}</div>}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        {loading ? (
          <div className="text-sm text-slate-500">Loading integrations...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PROVIDERS.map((i) => {
              const connected = isConnected(i.key);
              return (
                <div key={i.key} className={`bg-slate-900/70 border ${i.border} rounded-lg p-5`}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className={`f-display uppercase text-lg ${i.color}`}>{i.name}</h4>
                    <Badge className={connected ? "border-emerald-400/30 text-emerald-400" : "border-slate-600 text-slate-500"}>
                      {connected ? "Connected" : "Not Connected"}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-400 mb-1">{i.blurb}</p>
                  <p className="text-[11px] f-mono uppercase tracking-wide mb-4 text-slate-600">
                    {i.live ? "Real OAuth connection" : "Status tracker only — not a live API connection"}
                  </p>
                  <button
                    onClick={() => {
                      if (i.key === "servicem8") return connected ? disconnectServiceM8() : connectServiceM8();
                      return toggle(i.key, i.name);
                    }}
                    disabled={busyKey === i.key}
                    className={`text-sm f-display uppercase tracking-wide px-3.5 py-2 rounded border transition-colors disabled:opacity-50 ${
                      connected
                        ? "border-slate-700 text-slate-400 hover:bg-slate-800"
                        : "bg-orange-600 border-orange-600 hover:bg-orange-500 text-white"
                    }`}
                  >
                    {busyKey === i.key ? "Working..." : connected ? "Disconnect" : "Connect"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Nav>
  );
}
