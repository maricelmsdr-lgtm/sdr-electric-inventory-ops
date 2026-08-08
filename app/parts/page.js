"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Plus, Pencil, Trash2, MapPin, AlertTriangle, Warehouse, ImagePlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { uploadOrgFile, getPublicUrl } from "@/lib/storage";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, Badge, TradeBadge, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls,
} from "@/components/ui";

const emptyPart = { part_no: "", sku: "", category: "Electrical", location: "", min_reorder: 0, unit_cost: 0, description: "", photo_path: null };
const CATEGORIES = ["Electrical", "Plumbing", "HVAC", "General"];
const PAGE_SIZE = 200;

export default function PartsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [parts, setParts] = useState([]);
  const [matchCount, setMatchCount] = useState(0); // total rows matching current search (may exceed what's loaded)
  const [lowStockCount, setLowStockCount] = useState(0); // accurate org-wide count, independent of search/page
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', data }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [locModal, setLocModal] = useState(null); // { part, rows }
  const [error, setError] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

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

  // Debounce search input so we don't fire a query per keystroke against
  // a 9,700+ row catalog.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Re-query the server whenever org, search term, or the low-stock toggle changes.
  useEffect(() => {
    if (!orgId) return;
    fetchParts();
  }, [orgId, debouncedQ, lowStockOnly]);

  // The header "N LOW STOCK" badge is org-wide and independent of the
  // current search/filter, so it's fetched separately as an exact count.
  useEffect(() => {
    if (!orgId) return;
    fetchLowStockCount();
  }, [orgId]);

  const fetchParts = async () => {
    setLoading(true);
    setError("");
    let query = supabase
      .from("parts")
      .select("*", { count: "exact" })
      .eq("org_id", orgId);

    if (lowStockOnly) query = query.eq("is_low_stock", true);

    if (debouncedQ) {
      const term = debouncedQ.replace(/[%,]/g, "\\$&");
      query = query.or(
        `part_no.ilike.%${term}%,sku.ilike.%${term}%,location.ilike.%${term}%,description.ilike.%${term}%,category.ilike.%${term}%`
      );
    }

    const { data, error, count } = await query.order("part_no").limit(PAGE_SIZE);
    if (error) setError(error.message);
    else {
      setParts(data || []);
      setMatchCount(count ?? (data || []).length);
    }
    setLoading(false);
  };

  const fetchLowStockCount = async () => {
    const { count, error } = await supabase
      .from("parts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("is_low_stock", true);
    if (!error) setLowStockCount(count ?? 0);
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
      // qty is derived from inventory_balances and is_low_stock is a generated
      // column — Postgres rejects writes to either, so both are stripped here.
      const { id, qty, is_low_stock, ...rest } = d;
      const { error } = await supabase.from("parts").update(rest).eq("id", id);
      if (error) { setError(error.message); return; }
      await logActivity(`Updated part ${d.part_no}`);
    }
    setModal(null);
    fetchParts();
    fetchLowStockCount();
  };

  const remove = async () => {
    const { error } = await supabase.from("parts").delete().eq("id", confirmDelete.id);
    if (!error) await logActivity(`Deleted part ${confirmDelete.part_no}`);
    setConfirmDelete(null);
    fetchParts();
    fetchLowStockCount();
  };

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const handlePhotoChange = async (file) => {
    if (!file) return;
    setUploadingPhoto(true);
    setError("");
    try {
      const path = await uploadOrgFile("part-photos", orgId, file);
      setModal((prev) => ({ ...prev, data: { ...prev.data, photo_path: path } }));
    } catch (e) {
      setError(e.message || "Photo upload failed.");
    } finally {
      setUploadingPhoto(false);
    }
  };

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
        lowStockCount > 0 && (
          <button
            onClick={() => setLowStockOnly((v) => !v)}
            className={`hidden sm:flex items-center gap-1.5 text-[11px] f-mono px-2.5 py-1.5 rounded border ${
              lowStockOnly
                ? "text-red-300 bg-red-500/20 border-red-500/50"
                : "text-red-400 bg-red-500/10 border-red-500/30 hover:bg-red-500/15"
            }`}
            title="Toggle low-stock-only filter"
          >
            <AlertTriangle size={12} /> {lowStockCount} LOW STOCK
          </button>
        )
      }
    >
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <SearchInput value={q} onChange={setQ} placeholder="Search part no, SKU, location..." />
            {lowStockOnly && (
              <button
                onClick={() => setLowStockOnly(false)}
                className="text-[11px] f-mono text-red-300 bg-red-500/10 border border-red-500/30 px-2 py-1.5 rounded hover:bg-red-500/15"
              >
                Low stock only ✕
              </button>
            )}
          </div>
          <PrimaryBtn onClick={openCreate}><Plus size={15} /> Add Part</PrimaryBtn>
        </div>

        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        <Panel title="Parts Catalog" icon={Package}>
          {matchCount > parts.length && (
            <div className="text-xs text-slate-500 mb-3">
              Showing the first {parts.length} of {matchCount} matching parts — refine your search to narrow further.
            </div>
          )}
          {loading ? (
            <div className="text-sm text-slate-500 p-2">Loading parts...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr>
                    <Th></Th><Th>Part No.</Th><Th>SKU</Th><Th>Category</Th><Th>Shelf / Bin</Th>
                    <Th className="text-right">Total Qty</Th><Th className="text-right">Min Reorder</Th><Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {parts.map((p) => (
                    <tr key={p.id} className={`border-t border-slate-800/70 hover:bg-slate-900/40 ${p.qty <= p.min_reorder ? "bg-red-500/5" : ""}`}>
                      <Td>
                        {p.photo_path ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={getPublicUrl("part-photos", p.photo_path)} alt={p.part_no} className="w-9 h-9 rounded object-cover border border-slate-700" />
                        ) : (
                          <div className="w-9 h-9 rounded border border-slate-800 bg-slate-950 flex items-center justify-center text-slate-700">
                            <ImagePlus size={14} />
                          </div>
                        )}
                      </Td>
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
                  {parts.length === 0 && (
                    <tr>
                      <Td colSpan={8} className="text-slate-500">
                        {debouncedQ || lowStockOnly ? "No parts match your search." : "No parts yet — add your first one above."}
                      </Td>
                    </tr>
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
          <Field label="Photo (optional)">
            <div className="flex items-center gap-3">
              {modal.data.photo_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getPublicUrl("part-photos", modal.data.photo_path)} alt="" className="w-14 h-14 rounded object-cover border border-slate-700" />
              ) : (
                <div className="w-14 h-14 rounded border border-dashed border-slate-700 bg-slate-950 flex items-center justify-center text-slate-700">
                  <ImagePlus size={18} />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handlePhotoChange(e.target.files?.[0])}
                disabled={uploadingPhoto}
                className="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-slate-700 file:bg-slate-900 file:text-slate-300 file:text-xs"
              />
            </div>
            {uploadingPhoto && <div className="text-xs text-slate-500 mt-1">Uploading...</div>}
          </Field>
          {modal.mode === "create" && (
            <div className="text-xs text-slate-500 -mt-1 mb-3">
              New parts start at 0 on hand — use <span className="text-orange-400">Stock In</span> afterward to receive quantity into a location.
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
            <PrimaryBtn onClick={save} disabled={uploadingPhoto}>Save</PrimaryBtn>
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
