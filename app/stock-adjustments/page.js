"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, Badge, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls,
} from "@/components/ui";

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");
const REASONS = ["Damaged", "Lost", "Found", "Correction", "Return"];

const emptyAdj = (parts, locations) => ({
  adj_date: todayISO(), part_id: parts[0]?.id || "", location_id: locations[0]?.id || "",
  qty_change: 0, reason: "Correction", adjusted_by: "", notes: "",
});

export default function StockAdjustmentsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [parts, setParts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // { mode, data, originalQtyChange?, originalPartId?, originalLocationId? }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUser(user);
      const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
      setOrgId(profile?.org_id || null);
    })();
  }, [router]);

  useEffect(() => { if (orgId) fetchAll(); }, [orgId]);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: partsData }, { data: locData }, { data: adjData, error: adjErr }] = await Promise.all([
      supabase.from("parts").select("*").eq("org_id", orgId).order("part_no"),
      supabase.from("locations").select("*").eq("org_id", orgId).eq("active", true).order("type").order("name"),
      supabase.from("stock_adjustments").select("*").eq("org_id", orgId).order("adj_date", { ascending: false }),
    ]);
    setError(adjErr?.message || "");
    setParts(partsData || []);
    setLocations(locData || []);
    setAdjustments(adjData || []);
    setLoading(false);
  };

  const partById = (id) => parts.find((p) => p.id === id);
  const locationById = (id) => locations.find((l) => l.id === id);

  const openCreate = () => setModal({ mode: "create", data: emptyAdj(parts, locations) });
  const openEdit = (a) => setModal({ mode: "edit", data: { ...a }, originalQtyChange: a.qty_change, originalPartId: a.part_id, originalLocationId: a.location_id });

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const save = async () => {
    const d = modal.data;
    if (!d.location_id) {
      setError("A location is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (modal.mode === "create") {
        const { error: insErr } = await supabase.from("stock_adjustments").insert({ ...d, org_id: orgId });
        if (insErr) throw insErr;
        { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: d.part_id, p_location_id: d.location_id, p_delta: Number(d.qty_change) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        await logActivity(`Stock adjustment on ${partById(d.part_id)?.part_no || ""} at ${locationById(d.location_id)?.name || ""} (${d.qty_change > 0 ? "+" : ""}${d.qty_change})`);
      } else {
        const { id, ...rest } = d;
        const { error: updErr } = await supabase.from("stock_adjustments").update(rest).eq("id", id);
        if (updErr) throw updErr;
        // Reverse the original delta at the original location, then apply the new one
        { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: modal.originalPartId, p_location_id: modal.originalLocationId, p_delta: -Number(modal.originalQtyChange) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: d.part_id, p_location_id: d.location_id, p_delta: Number(d.qty_change) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        await logActivity(`Updated stock adjustment on ${partById(d.part_id)?.part_no || ""}`);
      }
      setModal(null);
      fetchAll();
    } catch (e) {
      setError(e.message || "Something went wrong saving the adjustment.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const a = confirmDelete;
    setError("");
    const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: a.part_id, p_location_id: a.location_id, p_delta: -Number(a.qty_change) });
    const { error: delErr } = await supabase.from("stock_adjustments").delete().eq("id", a.id);
    if (delErr) {
      setError(delErr.message || "Something went wrong deleting the adjustment.");
    } else {
      await logActivity(
        rpcErr
          ? `Deleted stock adjustment on ${partById(a.part_id)?.part_no || ""} (stock quantity could not be auto-reversed — check inventory manually)`
          : `Deleted stock adjustment on ${partById(a.part_id)?.part_no || ""}`
      );
      if (rpcErr) {
        setError("Adjustment deleted, but the stock quantity couldn't be auto-reversed (it may already be out of sync). Double-check that part's quantity.");
      }
    }
    setConfirmDelete(null);
    fetchAll();
  };

  const filtered = adjustments.filter((a) =>
    `${partById(a.part_id)?.part_no || ""} ${a.reason || ""} ${a.adjusted_by || ""} ${a.notes || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Stock Adjustments">
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search part, reason, adjusted by..." />
          <PrimaryBtn onClick={openCreate} disabled={parts.length === 0 || locations.length === 0}><Plus size={15} /> New Adjustment</PrimaryBtn>
        </div>
        {parts.length === 0 && <div className="text-sm text-amber-400 mb-3">Add at least one part before logging an adjustment.</div>}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        <Panel title="Stock Adjustments" icon={SlidersHorizontal}>
          {loading ? <div className="text-sm text-slate-500 p-2">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead><tr><Th>Date</Th><Th>Part</Th><Th>Location</Th><Th className="text-right">Qty Change</Th><Th>Reason</Th><Th>Adjusted By</Th><Th>Notes</Th><Th></Th></tr></thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                      <Td className="text-slate-400">{fmtDate(a.adj_date)}</Td>
                      <Td className="f-mono text-slate-200">{partById(a.part_id)?.part_no || "—"}</Td>
                      <Td className="text-slate-400 text-xs">{locationById(a.location_id)?.name || "—"}</Td>
                      <Td className={`text-right f-mono ${a.qty_change < 0 ? "text-red-400" : "text-emerald-400"}`}>{a.qty_change > 0 ? "+" : ""}{a.qty_change}</Td>
                      <Td><Badge className="border-slate-600 text-slate-300">{a.reason}</Badge></Td>
                      <Td className="text-slate-400">{a.adjusted_by || "—"}</Td>
                      <Td className="text-slate-400 text-xs max-w-[160px] truncate">{a.notes || "—"}</Td>
                      <Td>
                        <div className="flex gap-1.5 justify-end">
                          <IconBtn onClick={() => openEdit(a)}><Pencil size={13} /></IconBtn>
                          <IconBtn danger onClick={() => setConfirmDelete(a)}><Trash2 size={13} /></IconBtn>
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><Td colSpan={8} className="text-slate-500">No stock adjustments yet.</Td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {modal && (
        <ModalShell title={`${modal.mode === "create" ? "New" : "Edit"} Stock Adjustment`} icon={SlidersHorizontal} onClose={() => setModal(null)}>
          <Field label="Date"><input type="date" className={inputCls} value={modal.data.adj_date} onChange={(e) => setModal({ ...modal, data: { ...modal.data, adj_date: e.target.value } })} /></Field>
          <Field label="Part">
            <select className={inputCls} value={modal.data.part_id} onChange={(e) => setModal({ ...modal, data: { ...modal.data, part_id: e.target.value } })}>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.part_no} — {p.sku}</option>)}
            </select>
          </Field>
          <Field label="Location">
            <select className={inputCls} value={modal.data.location_id} onChange={(e) => setModal({ ...modal, data: { ...modal.data, location_id: e.target.value } })}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Qty Change (+/-)"><input type="number" className={inputCls} value={modal.data.qty_change} onChange={(e) => setModal({ ...modal, data: { ...modal.data, qty_change: Number(e.target.value) } })} /></Field>
          <Field label="Reason">
            <select className={inputCls} value={modal.data.reason} onChange={(e) => setModal({ ...modal, data: { ...modal.data, reason: e.target.value } })}>
              {REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Adjusted By"><input className={inputCls} value={modal.data.adjusted_by || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, adjusted_by: e.target.value } })} /></Field>
          <Field label="Notes"><input className={inputCls} value={modal.data.notes || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, notes: e.target.value } })} /></Field>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
            <PrimaryBtn onClick={save} className={saving ? "opacity-60 pointer-events-none" : ""}>{saving ? "Saving..." : "Save"}</PrimaryBtn>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ConfirmModal title="Delete Adjustment" message="Delete this stock adjustment? The quantity change will be reversed at its location. This can't be undone." onCancel={() => setConfirmDelete(null)} onConfirm={remove} />
      )}
    </Nav>
  );
}
