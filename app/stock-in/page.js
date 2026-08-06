"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, Plus, Pencil, Trash2, Paperclip } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { uploadOrgFile, getSignedUrl } from "@/lib/storage";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls, PartPicker,
} from "@/components/ui";

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");

const emptyStockIn = (parts, locations) => ({
  received_date: todayISO(), part_id: parts[0]?.id || "", qty: 1,
  location_id: locations[0]?.id || "", vendor: "", po_ref: "", received_by: "",
  po_id: null, invoice_path: null,
});

export default function StockInPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [stockIns, setStockIns] = useState([]);
  const [parts, setParts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // { mode, data, originalQty?, originalPartId?, originalLocationId? }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);

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
    const [{ data: partsData }, { data: locData }, { data: siData, error: siErr }, { data: poData }] = await Promise.all([
      supabase.from("parts").select("*").eq("org_id", orgId).order("part_no"),
      supabase.from("locations").select("*").eq("org_id", orgId).eq("active", true).order("type").order("name"),
      supabase.from("stock_ins").select("*").eq("org_id", orgId).order("received_date", { ascending: false }),
      supabase.from("purchase_orders").select("id, po_no, vendor").eq("org_id", orgId).order("po_date", { ascending: false }),
    ]);
    setError(siErr?.message || "");
    setParts(partsData || []);
    setLocations(locData || []);
    setStockIns(siData || []);
    setPurchaseOrders(poData || []);
    setLoading(false);
  };

  const poById = (id) => purchaseOrders.find((p) => p.id === id);

  const partById = (id) => parts.find((p) => p.id === id);
  const locationById = (id) => locations.find((l) => l.id === id);

  const openCreate = () => setModal({ mode: "create", data: emptyStockIn(parts, locations) });
  const openEdit = (s) => setModal({ mode: "edit", data: { ...s }, originalQty: s.qty, originalPartId: s.part_id, originalLocationId: s.location_id });

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const handleInvoiceChange = async (file) => {
    if (!file) return;
    setUploadingInvoice(true);
    setError("");
    try {
      const path = await uploadOrgFile("receiving-invoices", orgId, file);
      setModal((prev) => ({ ...prev, data: { ...prev.data, invoice_path: path } }));
    } catch (e) {
      setError(e.message || "Invoice upload failed.");
    } finally {
      setUploadingInvoice(false);
    }
  };

  const viewInvoice = async (path) => {
    const url = await getSignedUrl("receiving-invoices", path);
    if (url) window.open(url, "_blank");
    else setError("Couldn't open that invoice.");
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
        const { error: insErr } = await supabase.from("stock_ins").insert({ ...d, org_id: orgId });
        if (insErr) throw insErr;
        { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: d.part_id, p_location_id: d.location_id, p_delta: Number(d.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        await logActivity(`Received ${d.qty} × ${partById(d.part_id)?.part_no || ""} into ${locationById(d.location_id)?.name || ""}`);
      } else {
        const { id, ...rest } = d;
        const { error: updErr } = await supabase.from("stock_ins").update(rest).eq("id", id);
        if (updErr) throw updErr;
        // Reverse the original receipt at its original location, then apply the new one
        { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: modal.originalPartId, p_location_id: modal.originalLocationId, p_delta: -Number(modal.originalQty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: d.part_id, p_location_id: d.location_id, p_delta: Number(d.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        await logActivity(`Updated stock-in for ${partById(d.part_id)?.part_no || ""}`);
      }
      setModal(null);
      fetchAll();
    } catch (e) {
      setError(e.message || "Something went wrong saving the receipt.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const s = confirmDelete;
    setError("");
    const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: s.part_id, p_location_id: s.location_id, p_delta: -Number(s.qty) });
    const { error: delErr } = await supabase.from("stock_ins").delete().eq("id", s.id);
    if (delErr) {
      setError(delErr.message || "Something went wrong deleting the receipt.");
    } else {
      await logActivity(
        rpcErr
          ? `Deleted stock-in for ${partById(s.part_id)?.part_no || ""} (stock quantity could not be auto-reversed — check inventory manually)`
          : `Deleted stock-in for ${partById(s.part_id)?.part_no || ""}`
      );
      if (rpcErr) {
        setError("Receipt deleted, but the stock quantity couldn't be auto-reversed (it may already be out of sync). Double-check that part's quantity.");
      }
    }
    setConfirmDelete(null);
    fetchAll();
  };

  const filtered = stockIns.filter((s) =>
    `${partById(s.part_id)?.part_no || ""} ${s.vendor || ""} ${s.po_ref || ""} ${s.received_by || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Stock In">
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search part, vendor, PO ref..." />
          <PrimaryBtn onClick={openCreate} disabled={parts.length === 0 || locations.length === 0}><Plus size={15} /> Receive Stock</PrimaryBtn>
        </div>
        {parts.length === 0 && <div className="text-sm text-amber-400 mb-3">Add at least one part before receiving stock.</div>}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        <Panel title="Stock In (Receiving)" icon={PackagePlus}>
          {loading ? <div className="text-sm text-slate-500 p-2">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead><tr><Th>Date</Th><Th>Part</Th><Th className="text-right">Qty Received</Th><Th>Into</Th><Th>Vendor</Th><Th>PO</Th><Th>Received By</Th><Th>Invoice</Th><Th></Th></tr></thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                      <Td className="text-slate-400">{fmtDate(s.received_date)}</Td>
                      <Td className="f-mono text-slate-200">{partById(s.part_id)?.part_no || "—"}</Td>
                      <Td className="text-right f-mono text-emerald-400">+{s.qty}</Td>
                      <Td className="text-slate-400 text-xs">{locationById(s.location_id)?.name || "—"}</Td>
                      <Td className="text-slate-300">{s.vendor || "—"}</Td>
                      <Td className="text-slate-400">{poById(s.po_id)?.po_no || s.po_ref || "—"}</Td>
                      <Td className="text-slate-400">{s.received_by || "—"}</Td>
                      <Td>
                        {s.invoice_path ? (
                          <button onClick={() => viewInvoice(s.invoice_path)} className="inline-flex items-center gap-1 text-orange-400 hover:underline text-xs">
                            <Paperclip size={12} /> View
                          </button>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </Td>
                      <Td>
                        <div className="flex gap-1.5 justify-end">
                          <IconBtn onClick={() => openEdit(s)}><Pencil size={13} /></IconBtn>
                          <IconBtn danger onClick={() => setConfirmDelete(s)}><Trash2 size={13} /></IconBtn>
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><Td colSpan={9} className="text-slate-500">No stock received yet.</Td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {modal && (
        <ModalShell title={`${modal.mode === "create" ? "Receive" : "Edit"} Stock`} icon={PackagePlus} onClose={() => setModal(null)}>
          <Field label="Date"><input type="date" className={inputCls} value={modal.data.received_date} onChange={(e) => setModal({ ...modal, data: { ...modal.data, received_date: e.target.value } })} /></Field>
          <Field label="Part">
            <PartPicker parts={parts} value={modal.data.part_id} onChange={(partId) => setModal({ ...modal, data: { ...modal.data, part_id: partId } })} />
          </Field>
          <Field label="Qty Received"><input type="number" min="1" className={inputCls} value={modal.data.qty} onChange={(e) => setModal({ ...modal, data: { ...modal.data, qty: Number(e.target.value) } })} /></Field>
          <Field label="Receive Into">
            <select className={inputCls} value={modal.data.location_id} onChange={(e) => setModal({ ...modal, data: { ...modal.data, location_id: e.target.value } })}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Vendor"><input className={inputCls} value={modal.data.vendor || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, vendor: e.target.value } })} /></Field>
          <Field label="Linked Purchase Order (optional)">
            <select
              className={inputCls}
              value={modal.data.po_id || ""}
              onChange={(e) => {
                const po = poById(e.target.value);
                setModal({ ...modal, data: { ...modal.data, po_id: e.target.value || null, vendor: modal.data.vendor || po?.vendor || "" } });
              }}
            >
              <option value="">None</option>
              {purchaseOrders.map((po) => <option key={po.id} value={po.id}>{po.po_no} — {po.vendor}</option>)}
            </select>
          </Field>
          <Field label="PO Reference (freeform, optional)"><input className={inputCls} value={modal.data.po_ref || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, po_ref: e.target.value } })} /></Field>
          <Field label="Received By"><input className={inputCls} value={modal.data.received_by || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, received_by: e.target.value } })} /></Field>
          <Field label="Supplier Invoice (optional)">
            <div className="flex items-center gap-3">
              {modal.data.invoice_path && (
                <button type="button" onClick={() => viewInvoice(modal.data.invoice_path)} className="inline-flex items-center gap-1 text-orange-400 hover:underline text-xs">
                  <Paperclip size={12} /> View current
                </button>
              )}
              <input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => handleInvoiceChange(e.target.files?.[0])}
                disabled={uploadingInvoice}
                className="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-slate-700 file:bg-slate-900 file:text-slate-300 file:text-xs"
              />
            </div>
            {uploadingInvoice && <div className="text-xs text-slate-500 mt-1">Uploading...</div>}
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
            <PrimaryBtn onClick={save} disabled={uploadingInvoice} className={saving ? "opacity-60 pointer-events-none" : ""}>{saving ? "Saving..." : "Save"}</PrimaryBtn>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ConfirmModal title="Delete Receipt" message="Delete this stock-in record? The quantity received will be reversed at its location. This can't be undone." onCancel={() => setConfirmDelete(null)} onConfirm={remove} />
      )}
    </Nav>
  );
}
