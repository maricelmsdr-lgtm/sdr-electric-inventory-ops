"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Plus, Pencil, Trash2, MapPin, AlertTriangle, Warehouse } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, Badge, TradeBadge, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls,
} from "@/components/ui";

const emptyPart = { part_no: "", sku: "", category: "Electrical", location: "", min_reorder: 0, unit_cost: 0, description: "" };
const CATEGORIES = ["Electrical", "Plumbing", "HVAC", "General"];

export default function PartsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', data }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [locModal, setLocModal] = useState(null); // { part, rows }
  const [error, setError] = useState("");

  // Auth guard + load profile/org
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      setUser(user);
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();
      setOrgId(profile?.org_id || null);
    })();
  }, [router]);

  // Load parts once we know the org
  useEffect(() => {
    if (!orgId) return;
    fetchParts();
  }, [orgId]);

  const fetchParts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("parts")
      .select("*")
      .eq("org_id", orgId)
      .order("part_no");
    if (error) setError(error.message);
    else setParts(data || []);
    setLoading(false);
  };

  const openCreate = () => setModal({ mode: "create", data: { ...emptyPart } });
  const openEdit = (p) => setModal({ mode: "edit", data: { ...p } });

  const openLocations = async (p) => {
    setLocModal({ part: p, rows: null });
    const { data, error } = await supabase
      .from("inventory_balances")
      .select("quantity_on_hand, locations(id, name, type)")
      .eq("part_id", p.id)
      .order("quantity_on_hand", { ascending: false });
    if (error) {
      setLocModal({ part: p, rows: [], error: error.message });
      return;
    }
    setLocModal({ part: p, rows: (data || []).filter((r) => r.quantity_on_hand !== 0) });
  };

  const save = async () => {
    const d = modal.data;
    setError("");
    if (modal.mode === "create") {
      // qty is intentionally not set here — new parts start at 0 on hand.
      // Use Stock In to receive initial quantity into a location.
      const { error } = await supabase.from("parts").insert({ ...d, org_id: orgId });
      if (error) { setError(error.message); return; }
      await logActivity(`Added part ${d.part_no} — ${d.sku}`);
    } else {
      const { id, qty, ...rest } = d; // qty is derived from inventory_balances — never written directly
      const { error } = await supabase.from("parts").update(rest).eq("id", id);
      if (error) { setError(error.message); return; }
      await logActivity(`Updated part ${d.part_no}`);
    }
    setModal(null);
    fetchParts();
  };

  const remove = async () => {
    const { error } = await supabase.from("parts").delete().eq("id", confirmDelete.id);
    if (!error) await logActivity(`Deleted part ${confirmDelete.part_no}`);
    setConfirmDelete(null);
    fetchParts();
  };

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const filtered = parts.filter((p) =>
    `${p.part_no} ${p.sku} ${p.category} ${p.location}`.toLowerCase().includes(q.toLowerCase())
  );
  const lowStock = parts.filter((p) => p.qty <= p.min_reorder);

  if (!orgId) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  return (
    <Nav
      title="Parts Catalog"
      right={
        lowStock.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] f-mono text-red-400 bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 rounded">
            <AlertTriangle size={12} /> {lowStock.length} LOW STOCK
          </div>
        )
      }
    >
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search part no, SKU, location..." />
          <PrimaryBtn onClick={openCreate}><Plus size={15} /> Add Part</PrimaryBtn>
        </div>

        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        <Panel title="Parts Catalog" icon={Package}>
          {loading ? (
            <div className="text-sm text-slate-500 p-2">Loading parts...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr>
                    <Th>Part No.</Th><Th>SKU</Th><Th>Category</Th><Th>Shelf / Bin</Th>
                    <Th className="text-right">Total Qty</Th><Th className="text-right">Min Reorder</Th><Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className={`border-t border-slate-800/70 hover:bg-slate-900/40 ${p.qty <= p.min_reorder ? "bg-red-500/5" : ""}`}>
                      <Td className="f-mono text-slate-100">{p.part_no}</Td>
                      <Td className="f-mono text-slate-400">{p.sku}</Td>
                      <Td><TradeBadge category={p.category} /></Td>
                      <Td className="text-slate-400 flex items-center gap-1"><MapPin size={12} className="text-slate-600" />{p.location || "—"}</Td>
                      <Td className={`text-right f-mono ${p.qty <= p.min_reorder ? "text-red-400" : "text-slate-200"}`}>
                        <button onClick={() => openLocations(p)} className="hover:underline decoration-dotted underline-offset-2" title="View by location">
                          {p.qty}
                        </button>
                      </Td>
                      <Td className="text-right f-mono text-slate-500">{p.min_reorder}</Td>
                      <Td>
                        <div className="flex gap-1.5 justify-end">
                          <IconBtn onClick={() => openLocations(p)} title="View by location"><Warehouse size={13} /></IconBtn>
                          <IconBtn onClick={() => openEdit(p)}><Pencil size={13} /></IconBtn>
                          <IconBtn danger onClick={() => setConfirmDelete(p)}><Trash2 size={13} /></IconBtn>
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><Td colSpan={7} className="text-slate-500">No parts yet — add your first one above.</Td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {modal && (
        <ModalShell title={`${modal.mode === "create" ? "Add" : "Edit"} Part`} icon={Package} onClose={() => setModal(null)}>
          <Field label="Part No.">
            <input className={inputCls} value={modal.data.part_no} onChange={(e) => setModal({ ...modal, data: { ...modal.data, part_no: e.target.value } })} />
          </Field>
          <Field label="SKU">
            <input className={inputCls} value={modal.data.sku} onChange={(e) => setModal({ ...modal, data: { ...modal.data, sku: e.target.value } })} />
          </Field>
          <Field label="Category">
            <select className={inputCls} value={modal.data.category} onChange={(e) => setModal({ ...modal, data: { ...modal.data, category: e.target.value } })}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Shelf / Bin (optional)">
            <input className={inputCls} value={modal.data.location || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, location: e.target.value } })} placeholder="e.g. Shelf A3, Bin 12" />
          </Field>
          <Field label="Min Reorder">
            <input type="number" className={inputCls} value={modal.data.min_reorder} onChange={(e) => setModal({ ...modal, data: { ...modal.data, min_reorder: Number(e.target.value) } })} />
          </Field>
          <Field label="Unit Cost ($)">
            <input type="number" step="0.01" className={inputCls} value={modal.data.unit_cost} onChange={(e) => setModal({ ...modal, data: { ...modal.data, unit_cost: Number(e.target.value) } })} />
          </Field>
          <Field label="Description">
            <input className={inputCls} value={modal.data.description || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, description: e.target.value } })} />
          </Field>
          {modal.mode === "create" && (
            <div className="text-xs text-slate-500 -mt-1 mb-3">
              New parts start at 0 on hand — use <span className="text-orange-400">Stock In</span> afterward to receive quantity into a location.
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
            <PrimaryBtn onClick={save}>Save</PrimaryBtn>
          </div>
        </ModalShell>
      )}

      {locModal && (
        <ModalShell title={`${locModal.part.part_no} — By Location`} icon={Warehouse} onClose={() => setLocModal(null)}>
          {locModal.rows === null ? (
            <div className="text-sm text-slate-500">Loading...</div>
          ) : locModal.error ? (
            <div className="text-sm text-red-400">{locModal.error}</div>
          ) : locModal.rows.length === 0 ? (
            <div className="text-sm text-slate-500">Not currently stocked anywhere. Use Stock In to receive it.</div>
          ) : (
            <div className="space-y-2">
              {locModal.rows.map((r, i) => (
                <div key={i} className="flex items-center justify-between border border-slate-800 rounded px-3 py-2">
                  <span className="text-sm text-slate-200">{r.locations?.name || "Unknown"}</span>
                  <span className="f-mono text-sm text-orange-400">{r.quantity_on_hand}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end mt-4">
            <button onClick={() => setLocModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Close</button>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Part"
          message={`Delete "${confirmDelete.part_no}"? This can't be undone.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={remove}
        />
      )}
    </Nav>
  );
}
