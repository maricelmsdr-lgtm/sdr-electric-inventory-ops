"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, Badge, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls,
} from "@/components/ui";

const PRIORITIES = ["Low", "Normal", "Urgent"];
const STATUSES = ["Pending", "Approved", "Fulfilled", "Denied"];
const PRIORITY_STYLES = {
  Low: "border-slate-600 text-slate-400",
  Normal: "border-sky-400/30 text-sky-400",
  Urgent: "border-red-400/30 text-red-400",
};
const STATUS_STYLES = {
  Pending: "border-amber-400/30 text-amber-400",
  Approved: "border-sky-400/30 text-sky-400",
  Fulfilled: "border-emerald-400/30 text-emerald-400",
  Denied: "border-red-400/30 text-red-400",
};

const emptyReq = (parts, fleet) => ({
  requested_by: "", truck: fleet[0]?.truck_number || "", part_id: parts[0]?.id || "",
  qty_requested: 1, priority: "Normal", status: "Pending", notes: "",
});

export default function FieldRequestsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [requests, setRequests] = useState([]);
  const [parts, setParts] = useState([]);
  const [fleet, setFleet] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");

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
    const [{ data: partsData }, { data: fleetData }, { data: reqData, error: reqErr }] = await Promise.all([
      supabase.from("parts").select("*").eq("org_id", orgId).order("part_no"),
      supabase.from("fleet").select("*").eq("org_id", orgId).order("truck_number"),
      supabase.from("field_requests").select("*").eq("org_id", orgId).order("priority"),
    ]);
    setError(reqErr?.message || "");
    setParts(partsData || []);
    setFleet(fleetData || []);
    setRequests(reqData || []);
    setLoading(false);
  };

  const partById = (id) => parts.find((p) => p.id === id);

  const openCreate = () => setModal({ mode: "create", data: emptyReq(parts, fleet) });
  const openEdit = (r) => setModal({ mode: "edit", data: { ...r } });

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const save = async () => {
    const d = modal.data;
    setError("");
    if (modal.mode === "create") {
      const { error } = await supabase.from("field_requests").insert({ ...d, org_id: orgId });
      if (error) { setError(error.message); return; }
      await logActivity(`Field request from ${d.requested_by} (${partById(d.part_id)?.part_no || ""})`);
    } else {
      const { id, ...rest } = d;
      const { error } = await supabase.from("field_requests").update(rest).eq("id", id);
      if (error) { setError(error.message); return; }
      await logActivity(`Updated field request from ${d.requested_by}`);
    }
    setModal(null);
    fetchAll();
  };

  const remove = async () => {
    const { error } = await supabase.from("field_requests").delete().eq("id", confirmDelete.id);
    if (!error) await logActivity(`Deleted field request from ${confirmDelete.requested_by}`);
    setConfirmDelete(null);
    fetchAll();
  };

  const filtered = requests.filter((r) =>
    `${r.requested_by} ${r.truck || ""} ${partById(r.part_id)?.part_no || ""} ${r.notes || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Field Requests">
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search requester, truck, part..." />
          <PrimaryBtn onClick={openCreate} disabled={parts.length === 0}><Plus size={15} /> New Request</PrimaryBtn>
        </div>
        {parts.length === 0 && <div className="text-sm text-amber-400 mb-3">Add at least one part before logging a field request.</div>}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        <Panel title="Field Requests" icon={ClipboardList}>
          {loading ? <div className="text-sm text-slate-500 p-2">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead><tr><Th>Requested By</Th><Th>Truck</Th><Th>Part</Th><Th className="text-right">Qty</Th><Th>Priority</Th><Th>Status</Th><Th>Notes</Th><Th></Th></tr></thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                      <Td>{r.requested_by}</Td>
                      <Td className="f-mono text-slate-400">{r.truck || "—"}</Td>
                      <Td className="f-mono text-slate-300">{partById(r.part_id)?.part_no || "—"}</Td>
                      <Td className="text-right f-mono">{r.qty_requested}</Td>
                      <Td><Badge className={PRIORITY_STYLES[r.priority]}>{r.priority}</Badge></Td>
                      <Td><Badge className={STATUS_STYLES[r.status]}>{r.status}</Badge></Td>
                      <Td className="text-slate-400 text-xs max-w-[180px] truncate">{r.notes || "—"}</Td>
                      <Td>
                        <div className="flex gap-1.5 justify-end">
                          <IconBtn onClick={() => openEdit(r)}><Pencil size={13} /></IconBtn>
                          <IconBtn danger onClick={() => setConfirmDelete(r)}><Trash2 size={13} /></IconBtn>
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><Td colSpan={8} className="text-slate-500">No field requests yet.</Td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {modal && (
        <ModalShell title={`${modal.mode === "create" ? "New" : "Edit"} Field Request`} icon={ClipboardList} onClose={() => setModal(null)}>
          <Field label="Requested By"><input className={inputCls} value={modal.data.requested_by} onChange={(e) => setModal({ ...modal, data: { ...modal.data, requested_by: e.target.value } })} /></Field>
          <Field label="Truck">
            <select className={inputCls} value={modal.data.truck} onChange={(e) => setModal({ ...modal, data: { ...modal.data, truck: e.target.value } })}>
              {fleet.map((t) => <option key={t.id} value={t.truck_number}>{t.truck_number}</option>)}
              {fleet.length === 0 && <option value="">No trucks yet</option>}
            </select>
          </Field>
          <Field label="Part">
            <select className={inputCls} value={modal.data.part_id} onChange={(e) => setModal({ ...modal, data: { ...modal.data, part_id: e.target.value } })}>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.part_no} — {p.sku}</option>)}
            </select>
          </Field>
          <Field label="Qty Requested"><input type="number" min="1" className={inputCls} value={modal.data.qty_requested} onChange={(e) => setModal({ ...modal, data: { ...modal.data, qty_requested: Number(e.target.value) } })} /></Field>
          <Field label="Priority">
            <select className={inputCls} value={modal.data.priority} onChange={(e) => setModal({ ...modal, data: { ...modal.data, priority: e.target.value } })}>
              {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={inputCls} value={modal.data.status} onChange={(e) => setModal({ ...modal, data: { ...modal.data, status: e.target.value } })}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Notes"><input className={inputCls} value={modal.data.notes || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, notes: e.target.value } })} /></Field>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
            <PrimaryBtn onClick={save}>Save</PrimaryBtn>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ConfirmModal title="Delete Field Request" message={`Delete this request from "${confirmDelete.requested_by}"? This can't be undone.`} onCancel={() => setConfirmDelete(null)} onConfirm={remove} />
      )}
    </Nav>
  );
}
