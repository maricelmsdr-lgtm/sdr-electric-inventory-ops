"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Field, inputCls } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signin"); // signin | signup
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError("");
    const fn = mode === "signin"
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password });
    const { error } = await fn;
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-slate-950 bp-grid flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-lg bg-orange-600 flex items-center justify-center mb-3 shadow-lg shadow-orange-900/40">
            <Zap size={26} className="text-white" />
          </div>
          <div className="f-display uppercase text-3xl text-slate-100 tracking-wide">SDR Electric</div>
          <div className="f-mono text-xs text-slate-500 uppercase tracking-widest mt-1">Inventory Ops</div>
        </div>
        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-6">
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
          </Field>
          {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
          <button
            onClick={submit}
            disabled={loading}
            className="w-full mt-1 bg-orange-600 hover:bg-orange-500 text-white f-display uppercase tracking-wide text-base py-2.5 rounded transition-colors disabled:opacity-50"
          >
            {loading ? "..." : mode === "signin" ? "Log In" : "Create Account"}
          </button>
          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="w-full mt-3 text-xs f-mono text-slate-500 hover:text-slate-300"
          >
            {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Log in"}
          </button>
        </div>
      </div>
    </div>
  );
}
