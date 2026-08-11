"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";

export default function ReorderReportPage() {
  const router = useRouter();

  const [orgId, setOrgId] = useState(null);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // ------------------------------------------------------------
  // Load authenticated user's organization
  // ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadOrganization() {
      setLoading(true);
      setError("");

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (cancelled) return;

      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }

      if (!profile?.org_id) {
        setError("No organization is assigned to this user.");
        setLoading(false);
        return;
      }

      setOrgId(profile.org_id);
    }

    loadOrganization();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // ------------------------------------------------------------
  // Load inventory parts
  // ------------------------------------------------------------
  useEffect(() => {
    if (!orgId) return;

    let cancelled = false;

    async function loadParts() {
      setLoading(true);
      setError("");

      const { data, error: partsError } = await supabase
        .from("parts")
        .select(
          "id, part_no, sku, category, qty, min_reorder, org_id"
        )
        .eq("org_id", orgId)
        .order("part_no", { ascending: true });

      if (cancelled) return;

      if (partsError) {
        setError(partsError.message);
        setParts([]);
      } else {
        setParts(data || []);
      }

      setLoading(false);
    }

    loadParts();

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // ------------------------------------------------------------
  // Low-stock parts
  // ------------------------------------------------------------
  const lowStockParts = useMemo(() => {
    return parts.filter((part) => {
      const qty = Number(part.qty || 0);
      const minReorder = Number(part.min_reorder || 0);

      return qty <= minReorder;
    });
  }, [parts]);

  // ------------------------------------------------------------
  // Search
  // ------------------------------------------------------------
  const filteredParts = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) {
      return lowStockParts;
    }

    return lowStockParts.filter((part) => {
      const partNo = part.part_no?.toLowerCase() || "";
      const sku = part.sku?.toLowerCase() || "";
      const category = part.category?.toLowerCase() || "";

      return (
        partNo.includes(q) ||
        sku.includes(q) ||
        category.includes(q)
      );
    });
  }, [lowStockParts, search]);

  // ------------------------------------------------------------
  // Loading organization
  // ------------------------------------------------------------
  if (!orgId && loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="font-mono text-xs text-slate-500 uppercase tracking-widest">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <Nav title="Reorder Report">
      <div className="p-4 md:p-6 space-y-4">

        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">

          {/* Header */}
          <div className="flex flex-col gap-4 border-b border-slate-800 p-4 md:flex-row md:items-center md:justify-between">

            <div className="flex items-center gap-3">

              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10">
                <AlertTriangle
                  size={18}
                  className="text-amber-400"
                />
              </div>

              <div>
                <h1 className="text-sm font-semibold text-slate-100">
                  Reorder Report
                </h1>

                <p className="text-xs text-slate-500">
                  Parts currently at or below minimum stock
                </p>
              </div>

            </div>

            {/* Search */}
            <div className="w-full md:w-80">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search part no., SKU, category..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-slate-500"
              />
            </div>

          </div>

          {/* Table */}
          {loading ? (
            <div className="p-6 text-sm text-slate-500">
              Loading inventory...
            </div>
          ) : (
            <div className="overflow-x-auto">

              <table className="w-full min-w-[760px]">

                <thead>
                  <tr className="border-b border-slate-800">

                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      Part No.
                    </th>

                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      SKU
                    </th>

                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                      Category
                    </th>

                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">
                      On Hand
                    </th>

                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">
                      Min
                    </th>

                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">
                      Suggested Order Qty
                    </th>

                  </tr>
                </thead>

                <tbody>

                  {filteredParts.map((part) => {
                    const qty = Number(part.qty || 0);
                    const minReorder = Number(part.min_reorder || 0);

                    const suggestedOrderQty = Math.max(
                      minReorder * 2 - qty,
                      minReorder
                    );

                    return (
                      <tr
                        key={part.id}
                        className="border-b border-slate-800/70 hover:bg-slate-800/30"
                      >

                        <td className="px-4 py-3 font-mono text-sm text-slate-200">
                          {part.part_no || "—"}
                        </td>

                        <td className="px-4 py-3 font-mono text-sm text-slate-400">
                          {part.sku || "—"}
                        </td>

                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300">
                            {part.category || "Uncategorized"}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right font-mono text-sm text-red-400">
                          {qty}
                        </td>

                        <td className="px-4 py-3 text-right font-mono text-sm text-slate-500">
                          {minReorder}
                        </td>

                        <td className="px-4 py-3 text-right font-mono text-sm text-emerald-400">
                          {suggestedOrderQty}
                        </td>

                      </tr>
                    );
                  })}

                  {filteredParts.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-sm text-slate-500"
                      >
                        {lowStockParts.length === 0
                          ? "Nothing to reorder right now."
                          : "No parts match your search."}
                      </td>
                    </tr>
                  )}

                </tbody>

              </table>

            </div>
          )}

        </section>
      </div>
    </Nav>
  );
}