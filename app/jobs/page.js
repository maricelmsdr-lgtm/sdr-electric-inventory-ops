"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Plus, Pencil, Trash2, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls, money,
} from "@/components/ui";

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");

const emptyLine = (parts) => ({
  part_id: parts[0]?.id || "",
  qty: 1,
  part_cost: parts[0]?.unit_cost || 0,
  sale_cost: 0,
});

const emptyJob = (parts, locations) => ({
  job_no: "",
  client: "",
  address: "",
  job_date: todayISO(),
  technician: "",
  location_id: locations[0]?.id || "",
  lineItems: [emptyLine(parts)],
});

export default function JobsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [parts, setParts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // { mode, data, originalLineItems?, originalLocationId? }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    if (!orgId) return;
    fetchAll();
  }, [orgId]);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: partsData, error: partsErr }, { data: jobsData, error: jobsErr }, { data: locData, error: locErr }] = await Promise.all([
      supabase.from("parts").select("*").eq("org_id", orgId).order("part_no"),
      supabase
        .from("jobs")
        .select("*, job_line_items(*)")
        .eq("org_id", orgId)
        .order("job_date", { ascending: false }),
      supabase.from("locations").select("*").eq("org_id", orgId).eq("active", true).order("type").order("name"),
    ]);
    setError(partsErr?.message || jobsErr?.message || locErr?.message || "");
    setParts(partsData || []);
    setJobs(jobsData || []);
    setLocations(locData || []);
    setLoading(false);
  };

  const partById = (id) => parts.find((p) => p.id === id);
  const locationById = (id) => locations.find((l) => l.id === id);

  const openCreate = () => setModal({ mode: "create", data: emptyJob(parts, locations) });
  const openEdit = (j) => {
    const lineItems = (j.job_line_items || []).map((li) => ({
      part_id: li.part_id,
      qty: li.qty,
      part_cost: li.part_cost,
      sale_cost: li.sale_cost,
    }));
    setModal({
      mode: "edit",
      data: {
        id: j.id,
        job_no: j.job_no,
        client: j.client,
        address: j.address || "",
        job_date: j.job_date,
        technician: j.technician || "",
        location_id: j.location_id || locations[0]?.id || "",
        lineItems: lineItems.length ? lineItems : [emptyLine(parts)],
      },
      originalLineItems: j.job_line_items || [],
      originalLocationId: j.location_id,
    });
  };

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const save = async () => {
    const d = modal.data;
    if (!d.job_no || !d.client || !d.location_id || d.lineItems.length === 0) {
      setError("Job No., Client, Location, and at least one line item are required.");
      return;
    }
    setSaving(true);
    setError("");

    try {
      let jobId = d.id;

      if (modal.mode === "create") {
        const { data: jobRow, error: jobErr } = await supabase
          .from("jobs")
          .insert({
            org_id: orgId,
            job_no: d.job_no,
            client: d.client,
            address: d.address,
            job_date: d.job_date,
            technician: d.technician,
            location_id: d.location_id,
            created_by: user.id,
          })
          .select()
          .single();
        if (jobErr) throw jobErr;
        jobId = jobRow.id;

        const { error: liErr } = await supabase.from("job_line_items").insert(
          d.lineItems.map((li) => ({
            job_id: jobId,
            part_id: li.part_id,
            qty: li.qty,
            part_cost: li.part_cost,
            sale_cost: li.sale_cost,
          }))
        );
        if (liErr) throw liErr;

        // Deduct stock at the chosen location for each part used
        for (const li of d.lineItems) {
          { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: d.location_id, p_delta: -Number(li.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        }
        await logActivity(`Logged job ${d.job_no} for ${d.client} (from ${locationById(d.location_id)?.name || ""})`);
      } else {
        const { error: jobErr } = await supabase
          .from("jobs")
          .update({
            job_no: d.job_no,
            client: d.client,
            address: d.address,
            job_date: d.job_date,
            technician: d.technician,
            location_id: d.location_id,
          })
          .eq("id", jobId);
        if (jobErr) throw jobErr;

        // Restore stock at the ORIGINAL location from the original line items,
        // then re-deduct at the (possibly new) location for the new line items
        const origLoc = modal.originalLocationId;
        for (const li of modal.originalLineItems || []) {
          { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: origLoc, p_delta: Number(li.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        }

        const { error: delErr } = await supabase.from("job_line_items").delete().eq("job_id", jobId);
        if (delErr) throw delErr;

        const { error: liErr } = await supabase.from("job_line_items").insert(
          d.lineItems.map((li) => ({
            job_id: jobId,
            part_id: li.part_id,
            qty: li.qty,
            part_cost: li.part_cost,
            sale_cost: li.sale_cost,
          }))
        );
        if (liErr) throw liErr;

        for (const li of d.lineItems) {
          { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: d.location_id, p_delta: -Number(li.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
        }
        await logActivity(`Updated job ${d.job_no}`);
      }

      setModal(null);
      fetchAll();
    } catch (e) {
      setError(e.message || "Something went wrong saving the job.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const job = confirmDelete;
    setError("");
    try {
      // Restore stock at the job's location for every line item before deleting
      for (const li of job.job_line_items || []) {
        { const { error: rpcErr } = await supabase.rpc("apply_inventory_qty_change", { p_org_id: orgId, p_part_id: li.part_id, p_location_id: job.location_id, p_delta: Number(li.qty) }); if (rpcErr) throw new Error(rpcErr.message.includes("chk_balance_quantity") ? "Not enough stock at that location." : rpcErr.message); }
      }
      const { error: delErr } = await supabase.from("jobs").delete().eq("id", job.id);
      if (delErr) throw delErr;
      await logActivity(`Deleted job ${job.job_no}`);
    } catch (e) {
      setError(e.message || "Something went wrong deleting the job.");
    }
    setConfirmDelete(null);
    fetchAll();
  };

  const filtered = jobs.filter((j) =>
    `${j.job_no} ${j.client} ${j.address || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  const lineTotals = (lineItems) => ({
    qty: lineItems.reduce((s, li) => s + Number(li.qty || 0), 0),
    cost: lineItems.reduce((s, li) => s + Number(li.qty || 0) * Number(li.part_cost || 0), 0),
    sale: lineItems.reduce((s, li) => s + Number(li.qty || 0) * Number(li.sale_cost || 0), 0),
  });

  if (!orgId) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  return (
    <Nav title="Jobs">
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search job, client, address..." />
          <PrimaryBtn onClick={openCreate} disabled={parts.length === 0 || locations.length === 0}>
            <Plus size={15} /> Log Job
          </PrimaryBtn>
        </div>

        {parts.length === 0 && (
          <div className="text-sm text-amber-400 mb-3">
            Add at least one part in the Parts Catalog before logging a job.
          </div>
        )}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        <Panel title="Job Log" icon={Briefcase}>
          {loading ? (
            <div className="text-sm text-slate-500 p-2">Loading jobs...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px]">
                <thead>
                  <tr>
                    <Th>Job / Invoice No.</Th><Th>Client</Th><Th>Address</Th><Th>Pulled From</Th>
                    <Th className="text-right">Qty Parts</Th><Th className="text-right">Parts Cost</Th>
                    <Th className="text-right">Sales Total</Th><Th>Date</Th><Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((j) => {
                    const t = lineTotals(j.job_line_items || []);
                    return (
                      <tr key={j.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                        <Td className="f-mono text-orange-400">{j.job_no}</Td>
                        <Td className="text-slate-200">{j.client}</Td>
                        <Td className="text-slate-400 text-xs max-w-[180px] truncate">{j.address || "—"}</Td>
                        <Td className="text-slate-400 text-xs">{locationById(j.location_id)?.name || "—"}</Td>
                        <Td className="text-right f-mono text-slate-200">{t.qty}</Td>
                        <Td className="text-right f-mono text-slate-300">{money(t.cost)}</Td>
                        <Td className="text-right f-mono text-emerald-400">{money(t.sale)}</Td>
                        <Td className="text-slate-400">{fmtDate(j.job_date)}</Td>
                        <Td>
                          <div className="flex gap-1.5 justify-end">
                            <IconBtn onClick={() => openEdit(j)}><Pencil size={13} /></IconBtn>
                            <IconBtn danger onClick={() => setConfirmDelete(j)}><Trash2 size={13} /></IconBtn>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><Td colSpan={9} className="text-slate-500">No jobs yet — log your first one above.</Td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {modal && (
        <JobModal
          modal={modal}
          setModal={setModal}
          parts={parts}
          locations={locations}
          saving={saving}
          onCancel={() => setModal(null)}
          onSave={save}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Job"
          message={`Delete "${confirmDelete.job_no}"? Parts used on this job will be returned to stock at ${locationById(confirmDelete.location_id)?.name || "its original location"}. This can't be undone.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={remove}
        />
      )}
    </Nav>
  );
}

function JobModal({ modal, setModal, parts, locations, saving, onCancel, onSave }) {
  const d = modal.data;

  const updateField = (key, val) => setModal({ ...modal, data: { ...d, [key]: val } });

  const updateLine = (i, key, val) => {
    const items = [...d.lineItems];
    items[i] = { ...items[i], [key]: val };
    if (key === "part_id") {
      const p = parts.find((p) => p.id === val);
      if (p) items[i].part_cost = p.unit_cost;
    }
    updateField("lineItems", items);
  };
  const addLine = () => updateField("lineItems", [...d.lineItems, emptyLine(parts)]);
  const removeLine = (i) => updateField("lineItems", d.lineItems.filter((_, idx) => idx !== i));

  const totalQty = d.lineItems.reduce((s, li) => s + Number(li.qty || 0), 0);
  const totalCost = d.lineItems.reduce((s, li) => s + Number(li.qty || 0) * Number(li.part_cost || 0), 0);
  const totalSale = d.lineItems.reduce((s, li) => s + Number(li.qty || 0) * Number(li.sale_cost || 0), 0);

  return (
    <ModalShell title={`${modal.mode === "create" ? "Log" : "Edit"} Job`} icon={Briefcase} onClose={onCancel} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Job No. / Invoice No.">
          <input className={inputCls} value={d.job_no} onChange={(e) => updateField("job_no", e.target.value)} />
        </Field>
        <Field label="Date">
          <input type="date" className={inputCls} value={d.job_date} onChange={(e) => updateField("job_date", e.target.value)} />
        </Field>
        <Field label="Client Name">
          <input className={inputCls} value={d.client} onChange={(e) => updateField("client", e.target.value)} />
        </Field>
        <Field label="Technician">
          <input className={inputCls} value={d.technician} onChange={(e) => updateField("technician", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Field label="Client Address">
          <input className={inputCls} value={d.address} onChange={(e) => updateField("address", e.target.value)} />
        </Field>
        <Field label="Parts Pulled From">
          <select className={inputCls} value={d.location_id} onChange={(e) => updateField("location_id", e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-3 border border-slate-800 rounded">
        <div className="grid grid-cols-[2fr_0.7fr_1fr_1fr_auto] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500">
          <span>Part Used</span><span>Qty</span><span>Part Cost</span><span>Sale Cost</span><span></span>
        </div>
        {d.lineItems.map((li, i) => (
          <div key={i} className="grid grid-cols-[2fr_0.7fr_1fr_1fr_auto] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
            <select className={inputCls} value={li.part_id} onChange={(e) => updateLine(i, "part_id", e.target.value)}>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.part_no} — {p.sku}</option>)}
            </select>
            <input type="number" min="1" className={inputCls} value={li.qty} onChange={(e) => updateLine(i, "qty", Number(e.target.value))} />
            <input type="number" step="0.01" className={inputCls} value={li.part_cost} onChange={(e) => updateLine(i, "part_cost", Number(e.target.value))} />
            <input type="number" step="0.01" className={inputCls} value={li.sale_cost} onChange={(e) => updateLine(i, "sale_cost", Number(e.target.value))} />
            <IconBtn danger onClick={() => removeLine(i)}><Trash2 size={14} /></IconBtn>
          </div>
        ))}
        <div className="p-2">
          <button onClick={addLine} className="text-orange-400 text-xs f-mono flex items-center gap-1 hover:text-orange-300">
            <Plus size={13} /> Add Part Line
          </button>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 mt-3 f-mono text-sm text-slate-300">
        <span>Total Qty: <b className="text-slate-100">{totalQty}</b></span>
        <span>Parts Cost: <b className="text-slate-100">{money(totalCost)}</b></span>
        <span>Sales Total: <b className="text-emerald-400">{money(totalSale)}</b></span>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
        <PrimaryBtn onClick={onSave} className={saving ? "opacity-60 pointer-events-none" : ""}>
          <Check size={15} /> {saving ? "Saving..." : "Save Job"}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}
