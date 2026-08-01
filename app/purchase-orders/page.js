"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Plus, Pencil, Trash2, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, Badge, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls, money,
} from "@/components/ui";

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");
const STATUSES = ["Draft", "Ordered", "Received", "Cancelled"];
const STATUS_STYLES = {
  Draft: "border-slate-600 text-slate-400",
  Ordered: "border-sky-400/30 text-sky-400",
  Received: "border-emerald-400/30 text-emerald-400",
  Cancelled: "border-red-400/30 text-red-400",
};

const emptyLine = (parts) => ({ part_id: parts[0]?.id || "", qty: 1, unit_cost: parts[0]?.unit_cost || 0 });
const emptyPO = (parts) => ({
  po_no: "", vendor: "", po_date: todayISO(), status: "Ordered",
  lineItems: [emptyLine(parts)],
});

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [pos, setPos] = useState([]);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
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
    const [{ data: partsData, error: partsErr }, { data: posData, error: posErr }] = await Promise.all([
      supabase.from("parts").select("*").eq("org_id", orgId).order("part_no"),
      supabase.from("purchase_orders").select("*, po_line_items(*)").eq("org_id", orgId).order("po_date", { ascending: false }),
    ]);
    setError(partsErr?.message || posErr?.message || "");
    setParts(partsData || []);
    setPos(posData || []);
    setLoading(false);
  };

  const openCreate = () => setModal({ mode: "create", data: emptyPO(parts) });
  const openEdit = (p) => {
    const lineItems = (p.po_line_items || []).map((li) => ({ part_id: li.part_id, qty: li.qty, unit_cost: li.unit_cost }));
    setModal({
      mode: "edit",
      data: {
        id: p.id, po_no: p.po_no, vendor: p.vendor, po_date: p.po_date, status: p.status,
        lineItems: lineItems.length ? lineItems : [emptyLine(parts)],
      },
    });
  };

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const save = async () => {
    const d = modal.data;
    if (!d.po_no || !d.vendor || d.lineItems.length === 0) {
      setError("PO No., Vendor, and at least one line item are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let poId = d.id;
      if (modal.mode === "create") {
        const { data: poRow, error: poErr } = await supabase
          .from("purchase_orders")
          .insert({ org_id: orgId, po_no: d.po_no, vendor: d.vendor, po_date: d.po_date, status: d.status })
          .select().single();
        if (poErr) throw poErr;
        poId = poRow.id;
        const { error: liErr } = await supabase.from("po_line_items").insert(
          d.lineItems.map((li) => ({ po_id: poId, part_id: li.part_id, qty: li.qty, unit_cost: li.unit_cost }))
        );
        if (liErr) throw liErr;
        await logActivity(`Created PO ${d.po_no} — ${d.vendor}`);
      } else {
        const { error: poErr } = await supabase
          .from("purchase_orders")
          .update({ po_no: d.po_no, vendor: d.vendor, po_date: d.po_date, status: d.status })
          .eq("id", poId);
        if (poErr) throw poErr;
        const { error: delErr } = await supabase.from("po_line_items").delete().eq("po_id", poId);
        if (delErr) throw delErr;
        const { error: liErr } = await supabase.from("po_line_items").insert(
          d.lineItems.map((li) => ({ po_id: poId, part_id: li.part_id, qty: li.qty, unit_cost: li.unit_cost }))
        );
        if (liErr) throw liErr;
        await logActivity(`Updated PO ${d.po_no}`);
      }
      setModal(null);
      fetchAll();
    } catch (e) {
      setError(e.message || "Something went wrong saving the PO.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const po = confirmDelete;
    setError("");
    const { error: delErr } = await supabase.from("purchase_orders").delete().eq("id", po.id);
    if (delErr) setError(delErr.message);
    else await logActivity(`Deleted PO ${po.po_no}`);
    setConfirmDelete(null);
    fetchAll();
  };

  const filtered = pos.filter((p) => `${p.po_no} ${p.vendor}`.toLowerCase().includes(q.toLowerCase()));

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 f-body">
      <Nav />
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search PO no, vendor..." />
          <PrimaryBtn onClick={openCreate} disabled={parts.length === 0}><Plus size={15} /> New PO</PrimaryBtn>
        </div>
        {parts.length === 0 && <div className="text-sm text-amber-400 mb-3">Add at least one part before creating a PO.</div>}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        <Panel title="Purchase Orders" icon={ShoppingCart}>
          {loading ? <div className="text-sm text-slate-500 p-2">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead><tr><Th>PO No.</Th><Th>Vendor</Th><Th>Date</Th><Th>Line Items</Th><Th className="text-right">Total</Th><Th>Status</Th><Th></Th></tr></thead>
                <tbody>
                  {filtered.map((p) => {
                    const total = (p.po_line_items || []).reduce((s, li) => s + li.qty * li.unit_cost, 0);
                    return (
                      <tr key={p.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                        <Td className="f-mono text-orange-400">{p.po_no}</Td>
                        <Td>{p.vendor}</Td>
                        <Td className="text-slate-400">{fmtDate(p.po_date)}</Td>
                        <Td className="text-slate-400 text-xs">{(p.po_line_items || []).length} item{(p.po_line_items || []).length !== 1 ? "s" : ""}</Td>
                        <Td className="text-right f-mono">{money(total)}</Td>
                        <Td><Badge className={STATUS_STYLES[p.status] || STATUS_STYLES.Draft}>{p.status}</Badge></Td>
                        <Td>
                          <div className="flex gap-1.5 justify-end">
                            <IconBtn onClick={() => openEdit(p)}><Pencil size={13} /></IconBtn>
                            <IconBtn danger onClick={() => setConfirmDelete(p)}><Trash2 size={13} /></IconBtn>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && <tr><Td colSpan={7} className="text-slate-500">No purchase orders yet.</Td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {modal && <POModal modal={modal} setModal={setModal} parts={parts} saving={saving} onCancel={() => setModal(null)} onSave={save} />}
      {confirmDelete && (
        <ConfirmModal title="Delete PO" message={`Delete "${confirmDelete.po_no}"? This can't be undone.`} onCancel={() => setConfirmDelete(null)} onConfirm={remove} />
      )}
    </div>
  );
}

function POModal({ modal, setModal, parts, saving, onCancel, onSave }) {
  const d = modal.data;
  const updateField = (key, val) => setModal({ ...modal, data: { ...d, [key]: val } });
  const updateLine = (i, key, val) => {
    const items = [...d.lineItems];
    items[i] = { ...items[i], [key]: val };
    if (key === "part_id") {
      const p = parts.find((p) => p.id === val);
      if (p) items[i].unit_cost = p.unit_cost;
    }
    updateField("lineItems", items);
  };
  const addLine = () => updateField("lineItems", [...d.lineItems, emptyLine(parts)]);
  const removeLine = (i) => updateField("lineItems", d.lineItems.filter((_, idx) => idx !== i));
  const total = d.lineItems.reduce((s, li) => s + Number(li.qty || 0) * Number(li.unit_cost || 0), 0);

  return (
    <ModalShell title={`${modal.mode === "create" ? "Create" : "Edit"} Purchase Order`} icon={ShoppingCart} onClose={onCancel} wide>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
        <Field label="PO No."><input className={inputCls} value={d.po_no} onChange={(e) => updateField("po_no", e.target.value)} /></Field>
        <Field label="Vendor"><input className={inputCls} value={d.vendor} onChange={(e) => updateField("vendor", e.target.value)} /></Field>
        <Field label="Date"><input type="date" className={inputCls} value={d.po_date} onChange={(e) => updateField("po_date", e.target.value)} /></Field>
      </div>
      <Field label="Status">
        <select className={inputCls} value={d.status} onChange={(e) => updateField("status", e.target.value)}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>

      <div className="mt-2 border border-slate-800 rounded">
        <div className="grid grid-cols-[2fr_0.8fr_1fr_auto] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500">
          <span>Part</span><span>Qty</span><span>Unit Cost</span><span></span>
        </div>
        {d.lineItems.map((li, i) => (
          <div key={i} className="grid grid-cols-[2fr_0.8fr_1fr_auto] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
            <select className={inputCls} value={li.part_id} onChange={(e) => updateLine(i, "part_id", e.target.value)}>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.part_no} — {p.sku}</option>)}
            </select>
            <input type="number" min="1" className={inputCls} value={li.qty} onChange={(e) => updateLine(i, "qty", Number(e.target.value))} />
            <input type="number" step="0.01" className={inputCls} value={li.unit_cost} onChange={(e) => updateLine(i, "unit_cost", Number(e.target.value))} />
            <IconBtn danger onClick={() => removeLine(i)}><Trash2 size={14} /></IconBtn>
          </div>
        ))}
        <div className="p-2">
          <button onClick={addLine} className="text-orange-400 text-xs f-mono flex items-center gap-1 hover:text-orange-300"><Plus size={13} /> Add Line Item</button>
        </div>
      </div>
      <div className="flex justify-end mt-3 f-mono text-sm text-slate-300">PO Total: <b className="text-slate-100 ml-2">{money(total)}</b></div>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
        <PrimaryBtn onClick={onSave} className={saving ? "opacity-60 pointer-events-none" : ""}><Check size={15} /> {saving ? "Saving..." : "Save PO"}</PrimaryBtn>
      </div>
    </ModalShell>
  );
}
