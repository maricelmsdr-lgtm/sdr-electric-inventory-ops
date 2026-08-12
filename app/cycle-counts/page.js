"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls, PartPicker,
} from "@/components/ui";

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");

export default function CycleCountsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [counts, setCounts] = useState([]);
  // Only the parts referenced by cycle counts already on screen — fetched
  // by exact id, so display can't silently miss a part regardless of
  // catalog size. PartPicker does its own live search independently.
  const [partsById, setPartsById] = useState({});
  const [hasAnyParts, setHasAnyParts] = useState(true);
  const [locations, setLocations] = useState([]);
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
    const [{ data: locData }, { data: countData, error: cErr }, { count: partsCount }] = await Promise.all([
      supabase.from("locations").select("*").eq("org_id", orgId).eq("active", true).order("type").order("name"),
      supabase.from("cycle_counts").select("*").eq("org_id", orgId).order("count_date", { ascending: false }),
      supabase.from("parts").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    ]);
    setError(cErr?.message || "");
    setLocations(locData || []);
    setCounts(countData || []);
    setHasAnyParts((partsCount || 0) > 0);

    const partIds = [...new Set((countData || []).map((c) => c.part_id).filter(Boolean))];
    if (partIds.length > 0) {
      const { data: partsData } = await supabase.from("parts").select("id, part_no").in("id", partIds);
      setPartsById(Object.fromEntries((partsData || []).map((p) => [p.id, p])));
    } else {
      setPartsById({});
    }

    setLoading(false);
  };

  const partById = (id) => partsById[id];
  const locationById = (id) => locations.find((l) => l.id === id);

  const partLabel = async (partId) => {
    if (partsById[partId]) return partsById[partId].part_no;
    const { data } = await supabase.from("parts").select("part_no").eq("id", partId).maybeSingle();
    return data?.part_no || "";
  };

  // Looks up the current system quantity for a specific part+location by
  // querying inventory_balances directly — never depends on a preloaded
  // parts array, so it's correct no matter how large the catalog is.
  const systemQtyAt = async (partId, locId) => {
    if (!partId || !locId) return 0;
    const { data } = await supabase
      .from("inventory_balances")
      .select("quantity_on_hand")
      .eq("part_id", partId)
      .eq("location_id", locId)
      .maybeSingle();
    return data?.quantity_on_hand || 0;
  };

  const emptyCount = () => ({
    count_date: todayISO(),
    location_id: locations[0]?.id || "",
    part_id: "",
    system_qty: 0,
    counted_qty: 0,
    counted_by: "",
  });

  const openCreate = () => setModal({ mode: "create", data: emptyCount() });
  const openEdit = (c) => setModal({ mode: "edit", data: { ...c } });

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const save = async () => {
    const d = modal.data;
    setError("");
    if (!d.part_id) { setError("A part is required."); return; }
    if (modal.mode === "create") {
      const { error } = await supabase.from("cycle_counts").insert({ ...d, org_id: orgId });
      if (error) { setError(error.message); return; }
      await logActivity(`Cycle count — ${await partLabel(d.part_id)} at ${locationById(d.location_id)?.name || ""}`);
    } else {
      const { id, ...rest } = d;
      const { error } = await supabase.from("cycle_counts").update(rest).eq("id", id);
      if (error) { setError(error.message); return; }
      await logActivity(`Updated cycle count for ${await partLabel(d.part_id)}`);
    }
    setModal(null);
    fetchAll();
  };

  const remove = async () => {
    const label = await partLabel(confirmDelete.part_id);
    const { error } = await supabase.from("cycle_counts").delete().eq("id", confirmDelete.id);
    if (!error) await logActivity(`Deleted cycle count for ${label}`);
    setConfirmDelete(null);
    fetchAll();
  };

  const filtered = counts.filter((c) =>
    `${partById(c.part_id)?.part_no || ""} ${locationById(c.location_id)?.name || ""} ${c.counted_by || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Cycle Counts">
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search part, location, counted by..." />
          <PrimaryBtn onClick={openCreate} disabled={!hasAnyParts || locations.length === 0}><Plus size={15} /> New Count</PrimaryBtn>
        </div>
        {!hasAnyParts && <div className="text-sm text-amber-400 mb-3">Add at least one part before logging a cycle count.</div>}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        <Panel title="Cycle Counts" icon={ListChecks}>
          {loading ? <div className="text-sm text-slate-500 p-2">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px]">
                <thead><tr><Th>Date</Th><Th>Location</Th><Th>Part</Th><Th className="text-right">System Qty</Th><Th className="text-right">Counted Qty</Th><Th className="text-right">Variance</Th><Th>Counted By</Th><Th></Th></tr></thead>
                <tbody>
                  {filtered.map((c) => {
                    const variance = Number(c.counted_qty) - Number(c.system_qty);
                    return (
                      <tr key={c.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                        <Td className="text-slate-400">{fmtDate(c.count_date)}</Td>
                        <Td className="text-slate-300 text-xs">{locationById(c.location_id)?.name || "—"}</Td>
                        <Td className="f-mono text-slate-200">{partById(c.part_id)?.part_no || "—"}</Td>
                        <Td className="text-right f-mono text-slate-400">{c.system_qty}</Td>
                        <Td className="text-right f-mono text-slate-200">{c.counted_qty}</Td>
                        <Td className={`text-right f-mono ${variance === 0 ? "text-slate-500" : variance > 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {variance > 0 ? "+" : ""}{variance}
                        </Td>
                        <Td className="text-slate-400">{c.counted_by || "—"}</Td>
                        <Td>
                          <div className="flex gap-1.5 justify-end">
                            <IconBtn onClick={() => openEdit(c)}><Pencil size={13} /></IconBtn>
                            <IconBtn danger onClick={() => setConfirmDelete(c)}><Trash2 size={13} /></IconBtn>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && <tr><Td colSpan={8} className="text-slate-500">No cycle counts logged yet.</Td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {counts.some((c) => Number(c.counted_qty) !== Number(c.system_qty)) && (
            <div className="text-xs text-amber-400 mt-3 px-1">
              Counts with a variance don't change stock automatically — log a Stock Adjustment at that location to correct it.
            </div>
          )}
        </Panel>
      </div>

      {modal && (
        <ModalShell title={`${modal.mode === "create" ? "New" : "Edit"} Cycle Count`} icon={ListChecks} onClose={() => setModal(null)}>
          <Field label="Date"><input type="date" className={inputCls} value={modal.data.count_date} onChange={(e) => setModal({ ...modal, data: { ...modal.data, count_date: e.target.value } })} /></Field>
          <Field label="Location">
            <select
              className={inputCls}
              value={modal.data.location_id}
              onChange={async (e) => {
                const locId = e.target.value;
                const qty = await systemQtyAt(modal.data.part_id, locId);
                setModal({ ...modal, data: { ...modal.data, location_id: locId, system_qty: qty } });
              }}
            >
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Part">
            <PartPicker
              orgId={orgId}
              value={modal.data.part_id}
              onChange={async (partId) => {
                const qty = await systemQtyAt(partId, modal.data.location_id);
                setModal({ ...modal, data: { ...modal.data, part_id: partId, system_qty: qty } });
              }}
            />
          </Field>
          <Field label="System Qty (at this location)"><input type="number" className={inputCls} value={modal.data.system_qty} onChange={(e) => setModal({ ...modal, data: { ...modal.data, system_qty: Number(e.target.value) } })} /></Field>
          <Field label="Counted Qty"><input type="number" className={inputCls} value={modal.data.counted_qty} onChange={(e) => setModal({ ...modal, data: { ...modal.data, counted_qty: Number(e.target.value) } })} /></Field>
          <Field label="Counted By"><input className={inputCls} value={modal.data.counted_by || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, counted_by: e.target.value } })} /></Field>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
            <PrimaryBtn onClick={save}>Save</PrimaryBtn>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ConfirmModal title="Delete Cycle Count" message="Delete this cycle count record? This can't be undone." onCancel={() => setConfirmDelete(null)} onConfirm={remove} />
      )}
    </Nav>
  );
}