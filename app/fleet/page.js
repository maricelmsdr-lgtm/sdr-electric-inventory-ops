"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Truck, Plus, Pencil, Trash2, User, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, Badge, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls,
} from "@/components/ui";

const emptyTruck = { truck_number: "", nickname: "", driver: "", plate: "", home_base: "", status: "Active" };
const STATUSES = ["Active", "In Shop", "Retired"];

const STATUS_STYLES = {
  Active: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  "In Shop": "text-amber-400 bg-amber-400/10 border-amber-400/30",
  Retired: "text-slate-400 bg-slate-400/10 border-slate-400/30",
};

function StatusBadge({ status }) {
  return <Badge className={STATUS_STYLES[status] || STATUS_STYLES.Retired}>{status}</Badge>;
}

export default function FleetPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [trucks, setTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', data }
  const [confirmDelete, setConfirmDelete] = useState(null);
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

  // Load fleet once we know the org
  useEffect(() => {
    if (!orgId) return;
    fetchFleet();
  }, [orgId]);

  const fetchFleet = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("fleet")
      .select("*")
      .eq("org_id", orgId)
      .order("truck_number");
    if (error) setError(error.message);
    else setTrucks(data || []);
    setLoading(false);
  };

  const openCreate = () => setModal({ mode: "create", data: { ...emptyTruck } });
  const openEdit = (t) => setModal({ mode: "edit", data: { ...t } });

  const save = async () => {
    const d = modal.data;
    setError("");
    if (modal.mode === "create") {
      const { error } = await supabase.from("fleet").insert({ ...d, org_id: orgId });
      if (error) { setError(error.message); return; }
      await logActivity(`Added truck ${d.truck_number}${d.nickname ? ` — ${d.nickname}` : ""}`);
    } else {
      const { id, ...rest } = d;
      const { error } = await supabase.from("fleet").update(rest).eq("id", id);
      if (error) { setError(error.message); return; }
      await logActivity(`Updated truck ${d.truck_number}`);
    }
    setModal(null);
    fetchFleet();
  };

  const remove = async () => {
    const { error } = await supabase.from("fleet").delete().eq("id", confirmDelete.id);
    if (!error) await logActivity(`Removed truck ${confirmDelete.truck_number}`);
    setConfirmDelete(null);
    fetchFleet();
  };

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const filtered = trucks.filter((t) =>
    `${t.truck_number} ${t.nickname} ${t.driver} ${t.plate} ${t.home_base}`.toLowerCase().includes(q.toLowerCase())
  );
  const inShop = trucks.filter((t) => t.status === "In Shop");

  if (!orgId) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  return (
    <Nav
      title="Fleet"
      right={
        inShop.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] f-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5 rounded">
            {inShop.length} IN SHOP
          </div>
        )
      }
    >
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search truck no, nickname, driver..." />
          <PrimaryBtn onClick={openCreate}><Plus size={15} /> Add Truck</PrimaryBtn>
        </div>

        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        <Panel title="Fleet" icon={Truck}>
          {loading ? (
            <div className="text-sm text-slate-500 p-2">Loading fleet...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    <Th>Truck No.</Th><Th>Nickname</Th><Th>Driver</Th><Th>Plate</Th>
                    <Th>Home Base</Th><Th>Status</Th><Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                      <Td className="f-mono text-slate-100">{t.truck_number}</Td>
                      <Td className="text-slate-200">{t.nickname || "—"}</Td>
                      <Td className="text-slate-400 flex items-center gap-1"><User size={12} className="text-slate-600" />{t.driver || "Unassigned"}</Td>
                      <Td className="f-mono text-slate-400">{t.plate || "—"}</Td>
                      <Td className="text-slate-400 flex items-center gap-1"><MapPin size={12} className="text-slate-600" />{t.home_base || "—"}</Td>
                      <Td><StatusBadge status={t.status} /></Td>
                      <Td>
                        <div className="flex gap-1.5 justify-end">
                          <IconBtn onClick={() => openEdit(t)}><Pencil size={13} /></IconBtn>
                          <IconBtn danger onClick={() => setConfirmDelete(t)}><Trash2 size={13} /></IconBtn>
                        </div>
                      </Td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><Td colSpan={7} className="text-slate-500">No trucks yet — add your first one above.</Td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {modal && (
        <ModalShell title={`${modal.mode === "create" ? "Add" : "Edit"} Truck`} icon={Truck} onClose={() => setModal(null)}>
          <Field label="Truck No.">
            <input className={inputCls} value={modal.data.truck_number} onChange={(e) => setModal({ ...modal, data: { ...modal.data, truck_number: e.target.value } })} />
          </Field>
          <Field label="Nickname">
            <input className={inputCls} value={modal.data.nickname || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, nickname: e.target.value } })} />
          </Field>
          <Field label="Driver">
            <input className={inputCls} value={modal.data.driver || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, driver: e.target.value } })} />
          </Field>
          <Field label="Plate">
            <input className={inputCls} value={modal.data.plate || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, plate: e.target.value } })} />
          </Field>
          <Field label="Home Base">
            <input className={inputCls} value={modal.data.home_base || ""} onChange={(e) => setModal({ ...modal, data: { ...modal.data, home_base: e.target.value } })} />
          </Field>
          <Field label="Status">
            <select className={inputCls} value={modal.data.status} onChange={(e) => setModal({ ...modal, data: { ...modal.data, status: e.target.value } })}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
            <PrimaryBtn onClick={save}>Save</PrimaryBtn>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Remove Truck"
          message={`Remove "${confirmDelete.truck_number}"? This can't be undone.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={remove}
        />
      )}
    </Nav>
  );
}
