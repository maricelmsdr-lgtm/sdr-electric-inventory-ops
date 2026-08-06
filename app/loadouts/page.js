"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Plus, Pencil, Trash2, Check, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, Badge, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls, PartPicker,
} from "@/components/ui";

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");
const DIRECTIONS = ["Load Out", "Used on Job", "Return to Warehouse"];
const DIR_STYLES = {
  "Load Out": "border-orange-400/30 text-orange-400",
  "Used on Job": "border-amber-400/30 text-amber-400",
  "Return to Warehouse": "border-sky-400/30 text-sky-400",
};

const emptyLine = (parts) => ({ part_id: parts[0]?.id || "", qty: 1 });

export default function LoadoutsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [loadouts, setLoadouts] = useState([]);
  const [parts, setParts] = useState([]);
  const [fleet, setFleet] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // { mode, data, originalLineItems?, originalFrom?, originalTo? }
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
    const [
      { data: partsData, error: partsErr },
      { data: fleetData, error: fleetErr },
      { data: locData, error: locErr },
      { data: loadoutData, error: loErr },
    ] = await Promise.all([
      supabase.from("parts").select("*").eq("org_id", orgId).order("part_no"),
      supabase.from("fleet").select("*").eq("org_id", orgId).order("truck_number"),
      supabase.from("locations").select("*").eq("org_id", orgId).eq("active", true),
      supabase.from("truck_loadouts").select("*, loadout_line_items(*)").eq("org_id", orgId).order("loadout_date", { ascending: false }),
    ]);
    setError(partsErr?.message || fleetErr?.message || locErr?.message || loErr?.message || "");
    setParts(partsData || []);
    setFleet(fleetData || []);
    setLocations(locData || []);
    setLoadouts(loadoutData || []);
    setLoading(false);
  };

  const truckById = (id) => fleet.find((t) => t.id === id);
  const partById = (id) => parts.find((p) => p.id === id);
  const locationById = (id) => locations.find((l) => l.id === id);
  const mainWarehouse = () => locations.find((l) => l.type === "WAREHOUSE");
  const locationForTruck = (truckId) => {
    const truck = truckById(truckId);
    if (!truck) return null;
    return locations.find((l) => l.code === `TRUCK-${truck.truck_number}`);
  };

  // Given a direction + truck, compute which locations stock should move between
  const resolveFlow = (direction, truckId) => {
    const wh = mainWarehouse();
    const truckLoc = locationForTruck(truckId);
    if (direction === "Load Out") return { from: wh?.id || null, to: truckLoc?.id || null };
    if (direction === "Return to Warehouse") return { from: truckLoc?.id || null, to: wh?.id || null };
    return { from: truckLoc?.id || null, to: null }; // Used on Job — pure consumption
  };

  const emptyLoadout = () => ({
    loadout_date: todayISO(), truck_id: fleet[0]?.id || "", direction: "Load Out",
    job_ref: "", technician: "", lineItems: [emptyLine(parts)],
  });

  const openCreate = () => setModal({ mode: "create", data: emptyLoadout() });
  const openEdit = (l) => {
    const lineItems = (l.loadout_line_items || []).map((li) => ({ part_id: li.part_id, qty: li.qty }));
    setModal({
      mode: "edit",
      data: {
        id: l.id, loadout_date: l.loadout_date, truck_id: l.truck_id, direction: l.direction,
        job_ref: l.job_ref || "", technician: l.technician || "",
        lineItems: lineItems.length ? lineItems : [emptyLine(parts)],
      },
      originalLineItems: l.loadout_line_items || [],
      originalFrom: l.from_location_id,
      originalTo: l.to_location_id,
    });
  };

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const save = async () => {
    const d = modal.data;
    if (!d.truck_id || d.lineItems.length === 0) {
      setError("Truck and at least one line item are required.");
      return;
    }
    const flow = resolveFlow(d.direction, d.truck_id);
    if (!flow.from && !flow.to) {
      setError("Couldn't resolve a location for that truck. Check the Fleet page.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let loadoutId = d.id;
      if (modal.mode === "create") {
        const { data: row, error: loErr } = await supabase
          .from("truck_loadouts")
          .insert({
            org_id: orgId, loadout_date: d.loadout_date, truck_id: d.truck_id, direction: d.direction,
            job_ref: d.job_ref, technician: d.technician,
            from_location_id: flow.from, to_location_id: flow.to,
          })
          .select().single();
        if (loErr) throw loErr;
        loadoutId = row.id;
        const { error: liErr } = await supabase.from("loadout_line_items").insert(
          d.lineItems.map((li) => ({ loadout_id: loadoutId, part_id: li.part_id, qty: li.qty }))
        );
        if (liErr) throw liErr;

        for (const li of d.lineItems) {
          if (flow.from) { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: flow.from, p_delta: -Number(li.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
          if (flow.to) { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: flow.to, p_delta: Number(li.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        }
        await logActivity(`Logged truck load-out (${d.direction}) for ${truckById(d.truck_id)?.truck_number}`);
      } else {
        // Reverse the ORIGINAL transfer first
        for (const li of modal.originalLineItems || []) {
          if (modal.originalFrom) { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: modal.originalFrom, p_delta: Number(li.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
          if (modal.originalTo) { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: modal.originalTo, p_delta: -Number(li.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        }

        const { error: loErr } = await supabase
          .from("truck_loadouts")
          .update({
            loadout_date: d.loadout_date, truck_id: d.truck_id, direction: d.direction,
            job_ref: d.job_ref, technician: d.technician,
            from_location_id: flow.from, to_location_id: flow.to,
          })
          .eq("id", loadoutId);
        if (loErr) throw loErr;

        const { error: delErr } = await supabase.from("loadout_line_items").delete().eq("loadout_id", loadoutId);
        if (delErr) throw delErr;
        const { error: liErr } = await supabase.from("loadout_line_items").insert(
          d.lineItems.map((li) => ({ loadout_id: loadoutId, part_id: li.part_id, qty: li.qty }))
        );
        if (liErr) throw liErr;

        // Apply the NEW transfer
        for (const li of d.lineItems) {
          if (flow.from) { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: flow.from, p_delta: -Number(li.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
          if (flow.to) { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: flow.to, p_delta: Number(li.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        }
        await logActivity(`Updated truck load-out for ${truckById(d.truck_id)?.truck_number}`);
      }
      setModal(null);
      fetchAll();
    } catch (e) {
      setError(e.message || "Something went wrong saving the load-out.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const l = confirmDelete;
    setError("");
    let reversalIssue = false;
    for (const li of l.loadout_line_items || []) {
      if (l.from_location_id) {
        const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: l.from_location_id, p_delta: Number(li.qty) });
        if (rpcErr) reversalIssue = true;
      }
      if (l.to_location_id) {
        const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: l.to_location_id, p_delta: -Number(li.qty) });
        if (rpcErr) reversalIssue = true;
      }
    }
    const { error: delErr } = await supabase.from("truck_loadouts").delete().eq("id", l.id);
    if (delErr) {
      setError(delErr.message || "Something went wrong deleting the load-out.");
    } else {
      await logActivity(
        reversalIssue
          ? `Deleted truck load-out for ${truckById(l.truck_id)?.truck_number || ""} (stock quantities could not be auto-reversed — check inventory manually)`
          : `Deleted truck load-out for ${truckById(l.truck_id)?.truck_number || ""}`
      );
      if (reversalIssue) {
        setError("Load-out deleted, but stock quantities couldn't be auto-reversed (they may already be out of sync). Double-check the affected part quantities.");
      }
    }
    setConfirmDelete(null);
    fetchAll();
  };

  const filtered = loadouts.filter((l) =>
    `${truckById(l.truck_id)?.truck_number || ""} ${l.direction} ${l.job_ref || ""} ${l.technician || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Truck Load Out">
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search truck, direction, job ref..." />
          <PrimaryBtn onClick={openCreate} disabled={parts.length === 0 || fleet.length === 0}><Plus size={15} /> Log Load Out</PrimaryBtn>
        </div>
        {(parts.length === 0 || fleet.length === 0) && (
          <div className="text-sm text-amber-400 mb-3">Add at least one part and one truck before logging a load-out.</div>
        )}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        <Panel title="Truck Load Out Log" icon={ArrowLeftRight}>
          {loading ? <div className="text-sm text-slate-500 p-2">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px]">
                <thead><tr><Th>Date</Th><Th>Truck</Th><Th>Direction</Th><Th>Job Ref</Th><Th>Technician</Th><Th>Parts</Th><Th></Th></tr></thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                      <Td className="text-slate-400">{fmtDate(l.loadout_date)}</Td>
                      <Td className="f-mono">{truckById(l.truck_id)?.truck_number || "—"}</Td>
                      <Td><Badge className={DIR_STYLES[l.direction] || DIR_STYLES["Load Out"]}>{l.direction}</Badge></Td>
                      <Td className="text-slate-400">{l.job_ref || "—"}</Td>
                      <Td>{l.technician || "—"}</Td>
                      <Td className="text-xs text-slate-400">
                        {(l.loadout_line_items || []).map((li) => `${partById(li.part_id)?.sku || "?"} ×${li.qty}`).join(", ") || "—"}
                      </Td>
                      <Td>
                        <div className="flex gap-1.5 justify-end">
                          <IconBtn onClick={() => openEdit(l)}><Pencil size={13} /></IconBtn>
                          <IconBtn danger onClick={() => setConfirmDelete(l)}><Trash2 size={13} /></IconBtn>
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><Td colSpan={7} className="text-slate-500">No load-outs logged yet.</Td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {modal && (
        <LoadoutModal
          modal={modal} setModal={setModal} parts={parts} fleet={fleet}
          resolveFlow={resolveFlow} locationById={locationById}
          saving={saving} onCancel={() => setModal(null)} onSave={save}
        />
      )}
      {confirmDelete && (
        <ConfirmModal title="Delete Load Out" message="Delete this load-out record? The stock transfer will be reversed. This can't be undone." onCancel={() => setConfirmDelete(null)} onConfirm={remove} />
      )}
    </Nav>
  );
}

function LoadoutModal({ modal, setModal, parts, fleet, resolveFlow, locationById, saving, onCancel, onSave }) {
  const d = modal.data;
  const updateField = (key, val) => setModal({ ...modal, data: { ...d, [key]: val } });
  const updateLine = (i, key, val) => {
    const items = [...d.lineItems];
    items[i] = { ...items[i], [key]: val };
    updateField("lineItems", items);
  };
  const addLine = () => updateField("lineItems", [...d.lineItems, emptyLine(parts)]);
  const removeLine = (i) => updateField("lineItems", d.lineItems.filter((_, idx) => idx !== i));

  const flow = resolveFlow(d.direction, d.truck_id);
  const fromName = flow.from ? locationById(flow.from)?.name : "—";
  const toName = flow.to ? locationById(flow.to)?.name : "Consumed (no destination)";

  return (
    <ModalShell title={`${modal.mode === "create" ? "Log" : "Edit"} Truck Load Out`} icon={ArrowLeftRight} onClose={onCancel} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Date"><input type="date" className={inputCls} value={d.loadout_date} onChange={(e) => updateField("loadout_date", e.target.value)} /></Field>
        <Field label="Truck">
          <select className={inputCls} value={d.truck_id} onChange={(e) => updateField("truck_id", e.target.value)}>
            {fleet.map((t) => <option key={t.id} value={t.id}>{t.truck_number} — {t.nickname}</option>)}
          </select>
        </Field>
        <Field label="Direction">
          <select className={inputCls} value={d.direction} onChange={(e) => updateField("direction", e.target.value)}>
            {DIRECTIONS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Job Reference (optional)"><input className={inputCls} value={d.job_ref} onChange={(e) => updateField("job_ref", e.target.value)} /></Field>
      </div>
      <Field label="Technician"><input className={inputCls} value={d.technician} onChange={(e) => updateField("technician", e.target.value)} /></Field>

      <div className="flex items-center gap-2 text-sm f-mono bg-slate-900/60 border border-slate-800 rounded px-3 py-2 mb-1">
        <span className="text-slate-300">{fromName}</span>
        <ArrowRight size={14} className="text-slate-600" />
        <span className={flow.to ? "text-emerald-400" : "text-amber-400"}>{toName}</span>
      </div>

      <div className="mt-2 border border-slate-800 rounded">
        <div className="grid grid-cols-[2fr_1fr_auto] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500">
          <span>Part</span><span>Qty</span><span></span>
        </div>
        {d.lineItems.map((li, i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_auto] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
            <PartPicker parts={parts} value={li.part_id} onChange={(partId) => updateLine(i, "part_id", partId)} />
            <input type="number" min="1" className={inputCls} value={li.qty} onChange={(e) => updateLine(i, "qty", Number(e.target.value))} />
            <IconBtn danger onClick={() => removeLine(i)}><Trash2 size={14} /></IconBtn>
          </div>
        ))}
        <div className="p-2">
          <button onClick={addLine} className="text-orange-400 text-xs f-mono flex items-center gap-1 hover:text-orange-300"><Plus size={13} /> Add Part Line</button>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
        <PrimaryBtn onClick={onSave} className={saving ? "opacity-60 pointer-events-none" : ""}><Check size={15} /> {saving ? "Saving..." : "Save"}</PrimaryBtn>
      </div>
    </ModalShell>
  );
}
