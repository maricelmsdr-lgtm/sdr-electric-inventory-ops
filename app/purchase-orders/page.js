"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShoppingCart, Plus, Pencil, Trash2, Check, ArrowLeft, ArrowRight,
  Briefcase, Building2, Package, ClipboardCheck, X, Search, UserPlus,
  Upload, MapPin, Calendar, Mail, ChevronDown, ChevronRight, Download,
  MoreVertical,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel, Th, Td, Badge, IconBtn, PrimaryBtn, SearchInput,
  ConfirmModal, ModalShell, Field, inputCls, money, PartPicker,
} from "@/components/ui";

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");
const STATUSES = ["Open", "Ordered", "Received", "Cancelled"];
const STATUS_STYLES = {
  Open: "border-slate-600 text-slate-400",
  Ordered: "border-sky-400/30 text-sky-400",
  Received: "border-emerald-400/30 text-emerald-400",
  Cancelled: "border-red-400/30 text-red-400",
};
// Status dot colors for the card-row layout (matches STATUS_STYLES text color)
const STATUS_DOT = {
  Open: "bg-slate-400",
  Ordered: "bg-sky-400",
  Received: "bg-emerald-400",
  Cancelled: "bg-red-400",
};

const emptyLine = (parts) => ({ part_id: parts[0]?.id || "", qty: 1, unit_cost: parts[0]?.unit_cost || 0 });
const emptyPO = (parts) => ({
  po_no: "", vendor: "", po_date: todayISO(), status: "Open",
  lineItems: [emptyLine(parts)],
});

const vendorLabel = (v) =>
  v?.company_name || `${v?.first_name || ""} ${v?.last_name || ""}`.trim() || "Unnamed Vendor";

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [pos, setPos] = useState([]);
  const [parts, setParts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [mainWarehouse, setMainWarehouse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [wizard, setWizard] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // ================= LIST FILTERS (card-row layout) =================
  const [statusFilter, setStatusFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [deliveredToFilter, setDeliveredToFilter] = useState("");
  const [zeroItemsOnly, setZeroItemsOnly] = useState(false);
  const [sortBy, setSortBy] = useState("date_desc");
  const [openRowId, setOpenRowId] = useState(null); // expanded row (chevron)
  const [openActionsId, setOpenActionsId] = useState(null);

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
      { data: posData, error: posErr },
      { data: jobsData, error: jobsErr },
      { data: vendorsData, error: vendorsErr },
      { data: locData, error: locErr },
    ] = await Promise.all([
      supabase.from("parts").select("*").eq("org_id", orgId).order("part_no"),
      supabase
        .from("purchase_orders")
        // delivery_location:delivery_location_id pulls the delivered-to
        // location's name via the FK, for the "Delivered To" column.
        .select("*, po_line_items(*), delivery_location:delivery_location_id(id, name, type)")
        .eq("org_id", orgId)
        .order("po_date", { ascending: false }),
      supabase
        .from("jobs")
        .select("id, job_no, client, address, job_line_items(part_id, qty)")
        .eq("org_id", orgId)
        .order("job_date", { ascending: false }),
      supabase
        .from("vendors")
        .select("*")
        .eq("org_id", orgId)
        .eq("active", true)
        .order("company_name"),
      supabase
        .from("locations")
        .select("id, name, type")
        .eq("org_id", orgId),
    ]);

    setError(
      partsErr?.message || posErr?.message || jobsErr?.message ||
      vendorsErr?.message || locErr?.message || ""
    );

    setParts(partsData || []);
    setPos(posData || []);
    setJobs(jobsData || []);
    setVendors(vendorsData || []);
    setLocations(locData || []);
    setMainWarehouse((locData || []).find((l) => l.type === "WAREHOUSE") || null);
    setLoading(false);
  };

  /*
   * =========================================================
   * PO NUMBER GENERATION
   * =========================================================
   *
   * Sequential PUR-#### based on existing PO count for this
   * org, starting at 1000. Not collision-proof under heavy
   * concurrent use, but matches the simple sequential pattern
   * shown in the reference flow (PUR-1000, PUR-1001, ...).
   */

  const nextPoNo = () => `PUR-${1000 + pos.length}`;

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  /*
   * =========================================================
   * EXISTING SIMPLE MODAL (EDIT ONLY)
   * =========================================================
   */

  const openEdit = (p) => {
    const lineItems = (p.po_line_items || []).map((li) => ({ part_id: li.part_id, qty: li.qty, unit_cost: li.unit_cost }));
    setModal({
      mode: "edit",
      data: {
        id: p.id, po_no: p.po_no, vendor: p.vendor, po_date: p.po_date, status: p.status,
        lineItems: lineItems.length ? lineItems : [emptyLine(parts)],
      },
    });
    setOpenActionsId(null);
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
      const poId = d.id;
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
    setOpenActionsId(null);
    fetchAll();
  };

  /*
   * =========================================================
   * NEW WIZARD (CREATE)
   * =========================================================
   */

  const openWizard = () => {
    setError("");
    setWizard({
      step: 1,
      purchaseType: null,
      jobId: null,
      vendorId: null,
      lineItems: [],
      notes: "",
      poDate: todayISO(),
      deliveryDate: "",
    });
  };

  const saveWizardPO = async (status) => {
    if (!wizard) return;

    if (!wizard.vendorId) {
      setError("Select a vendor before saving.");
      return;
    }

    if (wizard.lineItems.length === 0) {
      setError("Select at least one product before saving.");
      return;
    }

    if (!mainWarehouse) {
      setError("No warehouse location found — add a location with type WAREHOUSE first.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const vendor = vendors.find((v) => v.id === wizard.vendorId);
      const poNo = nextPoNo();

      const { data: poRow, error: poErr } = await supabase
        .from("purchase_orders")
        .insert({
          org_id: orgId,
          po_no: poNo,
          vendor: vendorLabel(vendor),
          vendor_id: wizard.vendorId,
          job_id: wizard.purchaseType === "job" ? wizard.jobId : null,
          delivery_location_id: mainWarehouse.id,
          po_date: wizard.poDate,
          delivery_date: wizard.deliveryDate || null,
          notes: wizard.notes || "",
          status,
        })
        .select()
        .single();

      if (poErr) throw poErr;

      const { error: liErr } = await supabase.from("po_line_items").insert(
        wizard.lineItems.map((li) => ({
          po_id: poRow.id,
          part_id: li.part_id,
          qty: li.qty,
          unit_cost: li.unit_cost,
        }))
      );

      if (liErr) {
        await supabase.from("purchase_orders").delete().eq("id", poRow.id);
        throw liErr;
      }

      await logActivity(`Created PO ${poNo} — ${vendorLabel(vendor)} (${status})`);

      /*
       * NOTE: "Save & Send" only sets status to "Ordered" here.
       * Actually emailing the PO to the vendor requires an email
       * service (e.g. Resend, SendGrid) wired up separately —
       * that integration is not built yet. This is a placeholder.
       */

      setWizard(null);
      fetchAll();
    } catch (e) {
      setError(e.message || "Something went wrong saving the PO.");
    } finally {
      setSaving(false);
    }
  };

  /*
   * =========================================================
   * LIST VIEW: FILTER + SORT (card-row layout)
   * =========================================================
   */

  const filtered = pos
    .filter((p) => `${p.po_no} ${p.vendor}`.toLowerCase().includes(q.toLowerCase()))
    .filter((p) => (statusFilter ? p.status === statusFilter : true))
    .filter((p) => (vendorFilter ? p.vendor === vendorFilter : true))
    .filter((p) => (deliveredToFilter ? p.delivery_location?.id === deliveredToFilter : true))
    .filter((p) => (zeroItemsOnly ? (p.po_line_items || []).length === 0 : true))
    .sort((a, b) => {
      if (sortBy === "date_desc") return new Date(b.po_date) - new Date(a.po_date);
      if (sortBy === "date_asc") return new Date(a.po_date) - new Date(b.po_date);
      if (sortBy === "vendor") return (a.vendor || "").localeCompare(b.vendor || "");
      if (sortBy === "po_no") return (a.po_no || "").localeCompare(b.po_no || "");
      return 0;
    });

  const uniqueVendorNames = [...new Set(pos.map((p) => p.vendor).filter(Boolean))].sort();

  // Distinct-value dropdown filters (Status / Vendor / Delivered To / Sort)
  // are all app-side over already-fetched POs — fine at this data volume,
  // no extra round trips. "All Payments" / "All Email" are shown for
  // layout parity with the reference design but aren't wired up: there's
  // no payment or email-sent tracking on purchase_orders yet (the "Unpaid"
  // / "Not Sent" badges below are static placeholders for the same reason)
  // — future session.

  const exportCsv = () => {
    const header = ["PO No.", "Vendor", "Delivered To", "Date", "Status", "Items", "Total"];
    const rows = filtered.map((p) => {
      const total = (p.po_line_items || []).reduce((s, li) => s + li.qty * li.unit_cost, 0);
      return [
        p.po_no,
        p.vendor,
        p.delivery_location?.name || "",
        p.po_date || "",
        p.status,
        (p.po_line_items || []).length,
        total.toFixed(2),
      ];
    });
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-orders-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Purchase Orders">
      <div className="p-4 md:p-6">
        {/* ================= HEADER ================= */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/15 flex items-center justify-center">
              <ShoppingCart size={19} className="text-orange-400" />
            </div>
            <div>
              <div className="text-lg font-medium text-slate-100">Purchase Management</div>
              <div className="text-xs text-slate-500">Track and manage your purchases efficiently</div>
            </div>
          </div>
          <PrimaryBtn onClick={openWizard} disabled={parts.length === 0}><Plus size={15} /> New Purchase</PrimaryBtn>
        </div>

        {parts.length === 0 && <div className="text-sm text-amber-400 mb-3">Add at least one part before creating a PO.</div>}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        {/* ================= FILTERS BAR ================= */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <select className={`${inputCls} w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={`${inputCls} w-auto`} value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
              <option value="">Vendor</option>
              {uniqueVendorNames.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className={`${inputCls} w-auto`} value={deliveredToFilter} onChange={(e) => setDeliveredToFilter(e.target.value)}>
              <option value="">Delivered To</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-400 border border-slate-700 rounded px-2.5 py-2 cursor-pointer">
              <input type="checkbox" checked={zeroItemsOnly} onChange={(e) => setZeroItemsOnly(e.target.checked)} />
              Zero Items
            </label>
          </div>
          <div className="flex items-center gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search PO no, vendor..." />
            <select className={`${inputCls} w-auto`} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="date_desc">Newest First</option>
              <option value="date_asc">Oldest First</option>
              <option value="vendor">Vendor A–Z</option>
              <option value="po_no">PO No.</option>
            </select>
            <button
              onClick={exportCsv}
              className="px-3 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1.5"
            >
              <Download size={14} /> Excel
            </button>
          </div>
        </div>

        {/* ================= LIST (card rows) ================= */}
        <Panel title="Purchase Orders" icon={ShoppingCart}>
          {loading ? (
            <div className="text-sm text-slate-500 p-2">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr>
                    <Th>Purchase Details</Th>
                    <Th>Vendor</Th>
                    <Th>Delivered To</Th>
                    <Th>Dates</Th>
                    <Th>Status</Th>
                    <Th>Payment</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const itemCount = (p.po_line_items || []).length;
                    const isOpen = openRowId === p.id;
                    return (
                      <tr key={p.id} className="border-t border-slate-800/70 hover:bg-slate-900/40 align-top">
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setOpenRowId(isOpen ? null : p.id)}
                              className="shrink-0"
                              title="Toggle line item preview"
                            >
                              {isOpen ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                            </button>
                            <button
                              onClick={() => router.push(`/purchase-orders/${p.id}`)}
                              className="f-mono text-orange-400 hover:underline text-left"
                            >
                              {p.po_no}
                            </button>
                          </div>
                          <div className="mt-1 ml-5">
                            <Badge className="border-slate-700 text-slate-400 text-[10px]">
                              <Package size={10} className="inline -mt-0.5 mr-1" />
                              {itemCount} item{itemCount !== 1 ? "s" : ""}
                            </Badge>
                          </div>
                          {isOpen && (
                            <div className="mt-2 ml-5 border border-slate-800 rounded overflow-hidden">
                              {itemCount === 0 ? (
                                <div className="text-xs text-slate-500 p-2">No line items.</div>
                              ) : (
                                (p.po_line_items || []).map((li) => {
                                  const part = parts.find((pt) => pt.id === li.part_id);
                                  return (
                                    <div key={li.id} className="flex items-center justify-between px-2 py-1.5 border-b border-slate-800/60 last:border-0 text-xs">
                                      <span className="text-slate-300">{part?.part_no || "Unknown part"}</span>
                                      <span className="f-mono text-slate-500">{li.qty} × {money(li.unit_cost)}</span>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </Td>
                        <Td className="text-slate-200 font-medium">{p.vendor}</Td>
                        <Td>
                          <div className="flex items-center gap-1.5 text-slate-300">
                            <MapPin size={12} className="text-slate-500" />
                            {p.delivery_location?.name || "—"}
                          </div>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1.5 text-slate-300">
                            <Calendar size={12} className="text-slate-500" />
                            {fmtDate(p.po_date)}
                          </div>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[p.status] || STATUS_DOT.Open}`} />
                            <Badge className={STATUS_STYLES[p.status] || STATUS_STYLES.Open}>{p.status}</Badge>
                          </div>
                          <div className="flex items-center gap-1 mt-1 text-[11px] text-slate-600">
                            <Mail size={10} /> Not Sent
                          </div>
                        </Td>
                        <Td>
                          {/* No payment tracking on purchase_orders yet — static
                              placeholder to match the reference layout. */}
                          <Badge className="border-slate-700 text-slate-500">Unpaid</Badge>
                        </Td>
                        <Td>
                          <div className="relative flex justify-end">
                            <IconBtn onClick={() => setOpenActionsId(openActionsId === p.id ? null : p.id)}>
                              <MoreVertical size={14} />
                            </IconBtn>
                            {openActionsId === p.id && (
                              <div className="absolute right-0 top-8 w-36 bg-slate-900 border border-slate-800 rounded shadow-lg z-10 text-sm">
                                <button onClick={() => openEdit(p)} className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2">
                                  <Pencil size={13} /> Edit
                                </button>
                                <button onClick={() => { setConfirmDelete(p); setOpenActionsId(null); }} className="w-full text-left px-3 py-2 hover:bg-slate-800 text-red-400 flex items-center gap-2">
                                  <Trash2 size={13} /> Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><Td colSpan={7} className="text-slate-500">No purchase orders match your filters.</Td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {modal && <POModal modal={modal} setModal={setModal} parts={parts} saving={saving} onCancel={() => setModal(null)} onSave={save} />}

      {wizard && (
        <POWizard
          wizard={wizard}
          setWizard={setWizard}
          jobs={jobs}
          vendors={vendors}
          setVendors={setVendors}
          parts={parts}
          mainWarehouse={mainWarehouse}
          orgId={orgId}
          poNo={nextPoNo()}
          saving={saving}
          error={error}
          onCancel={() => setWizard(null)}
          onSave={saveWizardPO}
        />
      )}

      {confirmDelete && (
        <ConfirmModal title="Delete PO" message={`Delete "${confirmDelete.po_no}"? This can't be undone.`} onCancel={() => setConfirmDelete(null)} onConfirm={remove} />
      )}
    </Nav>
  );
}

/*
 * =============================================================
 * EXISTING SIMPLE EDIT MODAL — UNCHANGED
 * =============================================================
 */

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
    <ModalShell title="Edit Purchase Order" icon={ShoppingCart} onClose={onCancel} wide>
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
            <PartPicker parts={parts} value={li.part_id} onChange={(partId) => updateLine(i, "part_id", partId)} />
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

/*
 * =============================================================
 * NEW 4-STEP CREATE WIZARD
 * =============================================================
 *
 * Step 1: Select Job/Type  (For Job / General Purchase)
 * Step 2: Select Vendor    (search existing / add new)
 * Step 3: Select Products  (job line items / full catalog)
 * Step 4: Review & Submit  (PO no, totals, notes, save)
 *
 * Delivery address is NOT a step — it is always the org's
 * main warehouse (type = WAREHOUSE), set automatically.
 */

const STEPS = [
  { key: 1, label: "Select Job/Type", icon: ShoppingCart },
  { key: 2, label: "Select Vendor", icon: Building2 },
  { key: 3, label: "Select Products", icon: Package },
  { key: 4, label: "Review & Submit", icon: ClipboardCheck },
];

function StepHeader({ step }) {
  return (
    <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
      {STEPS.map((s, i) => {
        const done = step > s.key;
        const active = step === s.key;
        const Icon = s.icon;
        return (
          <div key={s.key} className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                    ? "bg-orange-500 text-white"
                    : "bg-slate-800 text-slate-500"
                }`}
              >
                {done ? <Check size={15} /> : <Icon size={15} />}
              </div>
              <span
                className={`text-[10px] f-mono uppercase tracking-wide whitespace-nowrap ${
                  active ? "text-orange-400" : done ? "text-emerald-400" : "text-slate-600"
                }`}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px ${done ? "bg-emerald-500" : "bg-slate-800"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function POWizard({
  wizard, setWizard, jobs, vendors, setVendors, parts, mainWarehouse,
  orgId, poNo, saving, error, onCancel, onSave,
}) {
  const [jobSearch, setJobSearch] = useState("");
  const [vendorSearch, setVendorSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productTab, setProductTab] = useState("job"); // 'job' | 'catalog'
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendor, setNewVendor] = useState({ company_name: "", first_name: "", last_name: "", phone: "", email: "" });
  const [vendorSaving, setVendorSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  const update = (patch) => setWizard({ ...wizard, ...patch });

  const selectedJob = jobs.find((j) => j.id === wizard.jobId) || null;
  const selectedVendor = vendors.find((v) => v.id === wizard.vendorId) || null;

  /*
   * -----------------------------------------------------------
   * STEP 1: SELECT JOB/TYPE
   * -----------------------------------------------------------
   */

  const filteredJobs = jobs.filter((j) =>
    `${j.job_no || ""} ${j.client || ""} ${j.address || ""}`.toLowerCase().includes(jobSearch.toLowerCase())
  );

  const chooseType = (type) => {
    if (type === "general") {
      update({ purchaseType: "general", jobId: null, step: 2 });
    } else {
      update({ purchaseType: "job" });
    }
  };

  const chooseJob = (job) => {
    update({ jobId: job.id, step: 2 });
  };

  /*
   * -----------------------------------------------------------
   * STEP 2: SELECT VENDOR
   * -----------------------------------------------------------
   */

  const filteredVendors = vendors.filter((v) =>
    vendorLabel(v).toLowerCase().includes(vendorSearch.toLowerCase())
  );

  const chooseVendor = (vendor) => {
    update({ vendorId: vendor.id, step: 3 });
  };

  const createVendor = async () => {
    if (!newVendor.company_name.trim()) {
      setLocalError("Vendor company name is required.");
      return;
    }
    setVendorSaving(true);
    setLocalError("");
    try {
      const { data, error: insErr } = await supabase
        .from("vendors")
        .insert({ org_id: orgId, ...newVendor, active: true })
        .select()
        .single();
      if (insErr) throw insErr;
      setVendors([...vendors, data].sort((a, b) => vendorLabel(a).localeCompare(vendorLabel(b))));
      setAddingVendor(false);
      setNewVendor({ company_name: "", first_name: "", last_name: "", phone: "", email: "" });
      update({ vendorId: data.id, step: 3 });
    } catch (e) {
      setLocalError(e.message || "Could not create vendor.");
    } finally {
      setVendorSaving(false);
    }
  };

  /*
   * -----------------------------------------------------------
   * STEP 3: SELECT PRODUCTS
   * -----------------------------------------------------------
   */

  const partById = (id) => parts.find((p) => p.id === id);

  const jobLineItemParts = selectedJob
    ? (selectedJob.job_line_items || [])
        .map((li) => partById(li.part_id))
        .filter(Boolean)
    : [];

  const groupedParts = (() => {
    const term = productSearch.toLowerCase();
    const list = parts.filter((p) =>
      `${p.part_no || ""} ${p.sku || ""}`.toLowerCase().includes(term)
    );
    const groups = new Map();
    for (const p of list) {
      const cat = p.category || "Uncategorized";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(p);
    }
    return groups;
  })();

  const [openCategories, setOpenCategories] = useState({});
  const toggleCategory = (cat) => setOpenCategories({ ...openCategories, [cat]: !openCategories[cat] });

  const isSelected = (partId) => wizard.lineItems.some((li) => li.part_id === partId);

  const toggleProduct = (part) => {
    if (isSelected(part.id)) {
      update({ lineItems: wizard.lineItems.filter((li) => li.part_id !== part.id) });
    } else {
      update({
        lineItems: [
          ...wizard.lineItems,
          { part_id: part.id, qty: 1, unit_cost: Number(part.unit_cost || 0) },
        ],
      });
    }
  };

  const updateLineQty = (partId, qty) => {
    update({
      lineItems: wizard.lineItems.map((li) =>
        li.part_id === partId ? { ...li, qty: Number(qty) } : li
      ),
    });
  };

  const updateLineCost = (partId, cost) => {
    update({
      lineItems: wizard.lineItems.map((li) =>
        li.part_id === partId ? { ...li, unit_cost: Number(cost) } : li
      ),
    });
  };

  const removeLineItem = (partId) => {
    update({ lineItems: wizard.lineItems.filter((li) => li.part_id !== partId) });
  };

  /*
   * -----------------------------------------------------------
   * STEP 4: REVIEW & SUBMIT
   * -----------------------------------------------------------
   */

  const total = wizard.lineItems.reduce(
    (s, li) => s + Number(li.qty || 0) * Number(li.unit_cost || 0),
    0
  );

  const goBack = () => {
    update({ step: Math.max(1, wizard.step - 1) });
  };

  return (
    <ModalShell title="Create Purchase Order" icon={ShoppingCart} onClose={onCancel} wide>
      <StepHeader step={wizard.step} />

      {(error || localError) && (
        <div className="text-sm text-red-400 mb-3 border border-red-900/50 bg-red-950/20 rounded px-3 py-2">
          {error || localError}
        </div>
      )}

      {/* ================= STEP 1 ================= */}
      {wizard.step === 1 && !wizard.purchaseType && (
        <div>
          <div className="text-sm text-slate-300 mb-3">Select Purchase Type</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => chooseType("job")}
              className="border border-slate-800 hover:border-orange-500/50 rounded-lg p-5 text-center transition"
            >
              <Briefcase className="mx-auto mb-2 text-sky-400" size={26} />
              <div className="font-medium text-slate-100">For Job</div>
              <div className="text-xs text-slate-500 mt-1">Purchase for specific job</div>
            </button>
            <button
              onClick={() => chooseType("general")}
              className="border border-slate-800 hover:border-orange-500/50 rounded-lg p-5 text-center transition"
            >
              <Building2 className="mx-auto mb-2 text-purple-400" size={26} />
              <div className="font-medium text-slate-100">General Purchase</div>
              <div className="text-xs text-slate-500 mt-1">Stock warehouse or vehicles</div>
            </button>
          </div>
        </div>
      )}

      {wizard.step === 1 && wizard.purchaseType === "job" && (
        <div>
          <button
            onClick={() => update({ purchaseType: null })}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 mb-3"
          >
            <ArrowLeft size={13} /> Back
          </button>
          <div className="text-sm text-slate-300 mb-2">Select Job</div>
          <SearchInput value={jobSearch} onChange={setJobSearch} placeholder="Search jobs..." />
          <div className="mt-3 border border-slate-800 rounded max-h-[40vh] overflow-y-auto">
            {filteredJobs.length === 0 && (
              <div className="p-4 text-sm text-slate-500">No jobs found.</div>
            )}
            {filteredJobs.map((job) => (
              <button
                key={job.id}
                onClick={() => chooseJob(job)}
                className="w-full text-left px-3 py-3 border-b border-slate-800/70 hover:bg-slate-900/70 flex items-center gap-3"
              >
                <Briefcase size={16} className="text-sky-400 shrink-0" />
                <div>
                  <div className="text-sm text-slate-100">
                    {job.job_no} <span className="text-slate-500">— {job.client}</span>
                  </div>
                  {job.address && <div className="text-xs text-slate-500">{job.address}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ================= STEP 2 ================= */}
      {wizard.step === 2 && !addingVendor && (
        <div>
          <div className="text-sm text-slate-300 mb-2">Select Vendor</div>
          <SearchInput value={vendorSearch} onChange={setVendorSearch} placeholder="Search vendors..." />
          <div className="mt-3 border border-slate-800 rounded max-h-[38vh] overflow-y-auto">
            {filteredVendors.map((v) => (
              <button
                key={v.id}
                onClick={() => chooseVendor(v)}
                className="w-full text-left px-3 py-3 border-b border-slate-800/70 hover:bg-slate-900/70 flex items-center gap-3"
              >
                <Building2 size={16} className="text-orange-400 shrink-0" />
                <div className="text-sm text-slate-100">{vendorLabel(v)}</div>
              </button>
            ))}
            {filteredVendors.length === 0 && (
              <div className="p-4 text-sm text-slate-500">No vendors found.</div>
            )}
          </div>
          <button
            onClick={() => setAddingVendor(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 text-orange-400 text-sm border border-dashed border-slate-700 rounded py-2.5 hover:bg-slate-900/50"
          >
            <UserPlus size={15} /> Add New Vendor
          </button>
        </div>
      )}

      {wizard.step === 2 && addingVendor && (
        <div>
          <button
            onClick={() => setAddingVendor(false)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 mb-3"
          >
            <ArrowLeft size={13} /> Back to vendor list
          </button>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Field label="Company Name">
              <input className={inputCls} value={newVendor.company_name}
                onChange={(e) => setNewVendor({ ...newVendor, company_name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className={inputCls} value={newVendor.phone}
                onChange={(e) => setNewVendor({ ...newVendor, phone: e.target.value })} />
            </Field>
            <Field label="First Name">
              <input className={inputCls} value={newVendor.first_name}
                onChange={(e) => setNewVendor({ ...newVendor, first_name: e.target.value })} />
            </Field>
            <Field label="Last Name">
              <input className={inputCls} value={newVendor.last_name}
                onChange={(e) => setNewVendor({ ...newVendor, last_name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className={inputCls} value={newVendor.email}
                onChange={(e) => setNewVendor({ ...newVendor, email: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end mt-3">
            <PrimaryBtn onClick={createVendor} className={vendorSaving ? "opacity-60 pointer-events-none" : ""}>
              <Check size={15} /> {vendorSaving ? "Saving..." : "Save Vendor & Continue"}
            </PrimaryBtn>
          </div>
        </div>
      )}

      {/* ================= STEP 3 ================= */}
      {wizard.step === 3 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-slate-300">Select Products</div>
            {wizard.lineItems.length > 0 && (
              <span className="text-xs f-mono text-emerald-400">{wizard.lineItems.length} selected</span>
            )}
          </div>

          <div className="flex gap-4 border-b border-slate-800 mb-3 text-sm">
            {selectedJob && (
              <button
                onClick={() => setProductTab("job")}
                className={`pb-2 px-1 ${productTab === "job" ? "text-orange-400 border-b-2 border-orange-500" : "text-slate-500"}`}
              >
                Job Line Items
              </button>
            )}
            <button
              onClick={() => setProductTab("catalog")}
              className={`pb-2 px-1 ${productTab === "catalog" ? "text-orange-400 border-b-2 border-orange-500" : "text-slate-500"}`}
            >
              Add Products
            </button>
          </div>

          {productTab === "job" && selectedJob && (
            <div className="border border-slate-800 rounded">
              {jobLineItemParts.length === 0 && (
                <div className="p-4 text-sm text-slate-500">This job has no parts on it yet.</div>
              )}
              {jobLineItemParts.map((part) => (
                <label
                  key={part.id}
                  className="flex items-center gap-3 px-3 py-2 border-b border-slate-800/60 last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={isSelected(part.id)}
                    onChange={() => toggleProduct(part)}
                  />
                  <div className="flex-1">
                    <div className="text-sm text-slate-100">{part.part_no}</div>
                    <div className="text-xs f-mono text-slate-500">{part.sku}</div>
                  </div>
                </label>
              ))}
            </div>
          )}

          {productTab === "catalog" && (
            <div>
              <SearchInput value={productSearch} onChange={setProductSearch} placeholder="Search products by name, SKU..." />
              <div className="mt-3 border border-slate-800 rounded overflow-hidden">
                {[...groupedParts.entries()].map(([cat, items]) => (
                  <div key={cat} className="border-b border-slate-800 last:border-0">
                    <button
                      onClick={() => toggleCategory(cat)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/60 hover:bg-slate-900"
                    >
                      <span className="text-sm text-slate-200">{cat}</span>
                      <span className="text-xs f-mono text-slate-500">{items.length} items</span>
                    </button>
                    {openCategories[cat] && (
                      <div>
                        {items.map((part) => (
                          <label
                            key={part.id}
                            className="flex items-center gap-3 px-3 py-2 border-t border-slate-800/60"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected(part.id)}
                              onChange={() => toggleProduct(part)}
                            />
                            <div className="flex-1">
                              <div className="text-sm text-slate-100">{part.part_no}</div>
                              <div className="text-xs f-mono text-slate-500">{part.sku}</div>
                            </div>
                            {isSelected(part.id) && (
                              <input
                                type="number"
                                min="1"
                                className={`${inputCls} w-20`}
                                value={wizard.lineItems.find((li) => li.part_id === part.id)?.qty || 1}
                                onClick={(e) => e.preventDefault()}
                                onChange={(e) => updateLineQty(part.id, e.target.value)}
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {groupedParts.size === 0 && (
                  <div className="p-4 text-sm text-slate-500">No products found.</div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-between mt-4">
            <button
              onClick={goBack}
              className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <PrimaryBtn
              onClick={() => update({ step: 4 })}
              disabled={wizard.lineItems.length === 0}
            >
              Continue with {wizard.lineItems.length} Product{wizard.lineItems.length !== 1 ? "s" : ""} <ArrowRight size={14} />
            </PrimaryBtn>
          </div>
        </div>
      )}

      {/* ================= STEP 4 ================= */}
      {wizard.step === 4 && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <div className="text-[10px] f-mono uppercase tracking-wider text-slate-500">Vendor</div>
              <div className="text-sm text-slate-100 mt-1">{vendorLabel(selectedVendor)}</div>
            </div>
            <div>
              <div className="text-[10px] f-mono uppercase tracking-wider text-slate-500">Deliver To</div>
              <div className="text-sm text-slate-100 mt-1">{mainWarehouse?.name || "Main Warehouse"}</div>
              {selectedJob && (
                <div className="text-xs text-slate-500 mt-0.5">Job: {selectedJob.job_no} — {selectedJob.client}</div>
              )}
            </div>
            <div>
              <div className="text-[10px] f-mono uppercase tracking-wider text-slate-500">PO Number</div>
              <div className="f-mono text-orange-400 mt-1">{poNo}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mb-4">
            <Field label="Date">
              <input type="date" className={inputCls} value={wizard.poDate}
                onChange={(e) => update({ poDate: e.target.value })} />
            </Field>
            <Field label="Delivery Date (optional)">
              <input type="date" className={inputCls} value={wizard.deliveryDate}
                onChange={(e) => update({ deliveryDate: e.target.value })} />
            </Field>
          </div>

          <div className="border border-slate-800 rounded">
            <div className="grid grid-cols-[2fr_0.8fr_1fr_1fr_auto] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500">
              <span>Product</span><span>Qty</span><span>Price</span><span>Total</span><span></span>
            </div>
            {wizard.lineItems.map((li) => {
              const part = partById(li.part_id);
              return (
                <div key={li.part_id} className="grid grid-cols-[2fr_0.8fr_1fr_1fr_auto] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
                  <div>
                    <div className="text-sm text-slate-100">{part?.part_no || "—"}</div>
                    <div className="text-xs f-mono text-slate-500">{part?.sku}</div>
                  </div>
                  <input type="number" min="1" className={inputCls} value={li.qty}
                    onChange={(e) => updateLineQty(li.part_id, e.target.value)} />
                  <input type="number" step="0.01" className={inputCls} value={li.unit_cost}
                    onChange={(e) => updateLineCost(li.part_id, e.target.value)} />
                  <div className="f-mono text-sm text-slate-300">{money(Number(li.qty) * Number(li.unit_cost))}</div>
                  <IconBtn danger onClick={() => removeLineItem(li.part_id)}><Trash2 size={13} /></IconBtn>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end mt-2 f-mono text-sm">
            <span className="text-slate-300">Total Amount: <b className="text-emerald-400 ml-2 text-base">{money(total)}</b></span>
          </div>

          <Field label="Notes">
            <textarea
              className={`${inputCls} min-h-[70px]`}
              value={wizard.notes}
              onChange={(e) => update({ notes: e.target.value })}
              placeholder="Enter any special instructions or notes..."
            />
          </Field>

          <div className="mt-2">
            <div className="text-xs f-mono uppercase text-slate-500 mb-1">Attachments</div>
            <div className="border border-dashed border-slate-700 rounded p-4 text-center text-xs text-slate-500">
              <Upload size={16} className="mx-auto mb-1 text-slate-600" />
              File uploads coming soon
            </div>
          </div>

          <div className="flex justify-between mt-4">
            <button
              onClick={goBack}
              className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => onSave("Open")}
                disabled={saving}
                className={`px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-200 hover:bg-slate-800 ${saving ? "opacity-60 pointer-events-none" : ""}`}
              >
                Save as Open
              </button>
              <button
                onClick={() => onSave("Received")}
                disabled={saving}
                className={`px-3.5 py-2 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-500 ${saving ? "opacity-60 pointer-events-none" : ""}`}
              >
                Save as Received
              </button>
              <button
                onClick={() => onSave("Ordered")}
                disabled={saving}
                className={`px-3.5 py-2 text-sm rounded bg-purple-600 text-white hover:bg-purple-500 ${saving ? "opacity-60 pointer-events-none" : ""}`}
              >
                {saving ? "Saving..." : "Save & Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}