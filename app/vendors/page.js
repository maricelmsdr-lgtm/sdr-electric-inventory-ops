"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, Pencil, Trash2, UserCheck, UserX, ChevronUp, ChevronDown, MapPin, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Th, Td, Badge, PrimaryBtn, SearchInput, ConfirmModal, ModalShell, Field, inputCls, DropdownMenu,
} from "@/components/ui";

const emptyVendor = {
  company_name: "", first_name: "", last_name: "", phone: "", email: "",
  secondary_emails: [], street1: "", street2: "", city: "", state: "", zip: "", country: "",
  active: true,
};

const AVATAR_COLORS = ["bg-violet-600", "bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-indigo-600"];
function avatarColor(name) {
  const c = (name || "?").trim().charCodeAt(0) || 0;
  return AVATAR_COLORS[c % AVATAR_COLORS.length];
}

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

export default function VendorsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("active"); // active | inactive
  const [sort, setSort] = useState({ key: "company_name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', data }
  const [emailDraft, setEmailDraft] = useState("");
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

  useEffect(() => {
    if (!orgId) return;
    fetchVendors();
  }, [orgId]);

  // Reset to page 1 whenever the visible result set changes shape.
  useEffect(() => { setPage(1); }, [q, tab, rowsPerPage]);

  const fetchVendors = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("vendors").select("*").eq("org_id", orgId);
    if (error) setError(error.message);
    else setVendors(data || []);
    setLoading(false);
  };

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  const openCreate = () => { setModal({ mode: "create", data: { ...emptyVendor } }); setEmailDraft(""); };
  const openEdit = (v) => { setModal({ mode: "edit", data: { ...v, secondary_emails: v.secondary_emails || [] } }); setEmailDraft(""); };
  const updateField = (key, value) => setModal((m) => ({ ...m, data: { ...m.data, [key]: value } }));

  const addSecondaryEmail = () => {
    const val = emailDraft.trim();
    if (!val) return;
    if (!modal.data.secondary_emails.includes(val)) {
      updateField("secondary_emails", [...modal.data.secondary_emails, val]);
    }
    setEmailDraft("");
  };
  const removeSecondaryEmail = (val) => {
    updateField("secondary_emails", modal.data.secondary_emails.filter((e) => e !== val));
  };

  const save = async () => {
    const d = modal.data;
    setError("");
    if (!d.company_name.trim()) { setError("Company name is required."); return; }

    if (modal.mode === "create") {
      const { error } = await supabase.from("vendors").insert({ ...d, org_id: orgId });
      if (error) { setError(error.message); return; }
      await logActivity(`Added vendor ${d.company_name}`);
    } else {
      const { id, ...rest } = d;
      const { error } = await supabase.from("vendors").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) { setError(error.message); return; }
      await logActivity(`Updated vendor ${d.company_name}`);
    }
    setModal(null);
    fetchVendors();
  };

  const remove = async () => {
    const { error } = await supabase.from("vendors").delete().eq("id", confirmDelete.id);
    if (!error) await logActivity(`Deleted vendor ${confirmDelete.company_name}`);
    setConfirmDelete(null);
    fetchVendors();
  };

  const toggleActive = async (v) => {
    const { error } = await supabase.from("vendors").update({ active: !v.active }).eq("id", v.id);
    if (!error) {
      await logActivity(`${v.active ? "Deactivated" : "Reactivated"} vendor ${v.company_name}`);
      fetchVendors();
    }
  };

  const toggleSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  };

  const fullName = (v) => [v.first_name, v.last_name].filter(Boolean).join(" ") || "N/A";

  const filtered = vendors
    .filter((v) => (tab === "active" ? v.active : !v.active))
    .filter((v) =>
      `${v.company_name} ${v.first_name || ""} ${v.last_name || ""} ${v.phone || ""} ${v.email || ""}`
        .toLowerCase()
        .includes(q.toLowerCase())
    );

  const sorted = [...filtered].sort((a, b) => {
    const av = (sort.key === "company_name" ? a.company_name : fullName(a)).toLowerCase();
    const bv = (sort.key === "company_name" ? b.company_name : fullName(b)).toLowerCase();
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const pageSafe = Math.min(page, totalPages);
  const paginated = sorted.slice((pageSafe - 1) * rowsPerPage, pageSafe * rowsPerPage);
  const rangeStart = sorted.length === 0 ? 0 : (pageSafe - 1) * rowsPerPage + 1;
  const rangeEnd = Math.min(pageSafe * rowsPerPage, sorted.length);

  const SortHeader = ({ label, sortKey }) => (
    <Th>
      <button className="flex items-center gap-1 hover:text-slate-200" onClick={() => toggleSort(sortKey)}>
        {label}
        {sort.key === sortKey ? (
          sort.dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        ) : (
          <ChevronUp size={12} className="opacity-30" />
        )}
      </button>
    </Th>
  );

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Vendors">
      <div className="p-4 md:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-orange-600 flex items-center justify-center shrink-0">
              <Building2 size={18} className="text-white" />
            </div>
            <div>
              <h3 className="f-display uppercase text-xl text-slate-100 leading-none">Vendor Management</h3>
              <p className="text-sm text-slate-500 mt-1">Manage your vendor database efficiently</p>
            </div>
          </div>
          <PrimaryBtn onClick={openCreate}><Plus size={15} /> New Vendor</PrimaryBtn>
        </div>

        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-4 border-b border-slate-800">
            <button
              onClick={() => setTab("active")}
              className={`flex items-center gap-1.5 pb-2 text-sm f-display uppercase tracking-wide border-b-2 -mb-px ${
                tab === "active" ? "border-orange-500 text-orange-400" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              <UserCheck size={14} /> Active Vendors
            </button>
            <button
              onClick={() => setTab("inactive")}
              className={`flex items-center gap-1.5 pb-2 text-sm f-display uppercase tracking-wide border-b-2 -mb-px ${
                tab === "inactive" ? "border-orange-500 text-orange-400" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              <UserX size={14} /> Inactive Vendors
            </button>
          </div>
          <SearchInput value={q} onChange={setQ} placeholder="Search vendors by name, company, phone, or email..." />
        </div>

        {loading ? (
          <div className="text-sm text-slate-500 p-2">Loading vendors...</div>
        ) : (
          <div className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <SortHeader label="Vendor" sortKey="company_name" />
                  <SortHeader label="Name" sortKey="name" />
                  <Th>Contact Info</Th>
                  <Th>Address</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((v) => (
                  <tr key={v.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full ${avatarColor(v.company_name)} flex items-center justify-center text-white text-xs font-semibold shrink-0`}>
                          {(v.company_name || "?").trim().charAt(0).toUpperCase()}
                        </div>
                        <span className="text-slate-100">{v.company_name}</span>
                      </div>
                    </Td>
                    <Td className="text-slate-300">{fullName(v)}</Td>
                    <Td>
                      {v.phone || v.email ? (
                        <div className="text-xs text-slate-400">
                          {v.phone && <div>{v.phone}</div>}
                          {v.email && <div>{v.email}</div>}
                        </div>
                      ) : (
                        <span className="text-slate-600">No contact info</span>
                      )}
                    </Td>
                    <Td>
                      {v.city || v.state ? (
                        <span className="text-slate-400 flex items-center gap-1">
                          <MapPin size={12} className="text-slate-600" />
                          {[v.city, v.state].filter(Boolean).join(", ")}
                        </span>
                      ) : (
                        <span className="text-slate-600">N/A</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <DropdownMenu
                        items={[
                          { label: "Edit", icon: Pencil, onClick: () => openEdit(v) },
                          v.active
                            ? { label: "Deactivate", icon: UserX, onClick: () => toggleActive(v) }
                            : { label: "Reactivate", icon: UserCheck, onClick: () => toggleActive(v) },
                          { label: "Delete", icon: Trash2, danger: true, onClick: () => setConfirmDelete(v) },
                        ]}
                      />
                    </Td>
                  </tr>
                ))}
                {paginated.length === 0 && (
                  <tr><Td colSpan={5} className="text-slate-500 text-center py-6">
                    {tab === "active" ? "No active vendors yet — add your first one above." : "No inactive vendors."}
                  </Td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {sorted.length > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3 mt-4 text-sm text-slate-500">
            <div>Showing {rangeStart} to {rangeEnd} of {sorted.length} results</div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs f-mono uppercase text-slate-600">Rows per page:</span>
                <select
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-orange-500"
                  value={rowsPerPage}
                  onChange={(e) => setRowsPerPage(Number(e.target.value))}
                >
                  {ROWS_PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pageSafe <= 1}
                className="px-2.5 py-1 rounded border border-slate-700 disabled:opacity-40 hover:bg-slate-800"
              >
                Previous
              </button>
              <span>Page {pageSafe} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={pageSafe >= totalPages}
                className="px-2.5 py-1 rounded border border-slate-700 disabled:opacity-40 hover:bg-slate-800"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {modal && (
        <ModalShell title={modal.mode === "create" ? "Add New Vendor" : "Edit Vendor"} icon={Building2} onClose={() => setModal(null)} wide>
          <div className="text-xs f-mono uppercase tracking-widest text-slate-500 mb-2 mt-1">Company Information</div>
          <Field label="Company Name *">
            <input className={inputCls} value={modal.data.company_name} onChange={(e) => updateField("company_name", e.target.value)} placeholder="Enter company name" />
          </Field>

          <div className="text-xs f-mono uppercase tracking-widest text-slate-500 mb-2 mt-4">Basic Information</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Field label="First Name">
              <input className={inputCls} value={modal.data.first_name || ""} onChange={(e) => updateField("first_name", e.target.value)} placeholder="Enter first name" />
            </Field>
            <Field label="Last Name">
              <input className={inputCls} value={modal.data.last_name || ""} onChange={(e) => updateField("last_name", e.target.value)} placeholder="Enter last name" />
            </Field>
          </div>

          <div className="text-xs f-mono uppercase tracking-widest text-slate-500 mb-2 mt-4">Contact Information <span className="normal-case text-slate-600">(optional)</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Field label="Phone Number">
              <input className={inputCls} value={modal.data.phone || ""} onChange={(e) => updateField("phone", e.target.value)} placeholder="Enter phone number" />
            </Field>
            <Field label="Email">
              <input type="email" className={inputCls} value={modal.data.email || ""} onChange={(e) => updateField("email", e.target.value)} placeholder="Enter email address" />
            </Field>
          </div>
          <Field label="Secondary Emails">
            <div className={inputCls + " flex flex-wrap gap-1.5 items-center py-1.5"}>
              {modal.data.secondary_emails.map((em) => (
                <span key={em} className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-200">
                  {em}
                  <button onClick={() => removeSecondaryEmail(em)} className="text-slate-500 hover:text-red-400"><X size={11} /></button>
                </span>
              ))}
              <input
                className="bg-transparent flex-1 min-w-[140px] text-sm outline-none"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); addSecondaryEmail(); }
                }}
                placeholder="Enter email and press Enter or Tab to add"
              />
            </div>
          </Field>

          <div className="text-xs f-mono uppercase tracking-widest text-slate-500 mb-2 mt-4">Address <span className="normal-case text-slate-600">(optional)</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Field label="Street 1">
              <input className={inputCls} value={modal.data.street1 || ""} onChange={(e) => updateField("street1", e.target.value)} placeholder="Enter street address" />
            </Field>
            <Field label="Street 2">
              <input className={inputCls} value={modal.data.street2 || ""} onChange={(e) => updateField("street2", e.target.value)} placeholder="Enter additional address info" />
            </Field>
            <Field label="City">
              <input className={inputCls} value={modal.data.city || ""} onChange={(e) => updateField("city", e.target.value)} placeholder="Enter city" />
            </Field>
            <Field label="State">
              <input className={inputCls} value={modal.data.state || ""} onChange={(e) => updateField("state", e.target.value)} placeholder="Enter state" />
            </Field>
            <Field label="ZIP Code">
              <input className={inputCls} value={modal.data.zip || ""} onChange={(e) => updateField("zip", e.target.value)} placeholder="Enter ZIP code" />
            </Field>
            <Field label="Country">
              <input className={inputCls} value={modal.data.country || ""} onChange={(e) => updateField("country", e.target.value)} placeholder="Enter country" />
            </Field>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
            <PrimaryBtn onClick={save}>Save</PrimaryBtn>
          </div>
        </ModalShell>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Vendor"
          message={`Delete "${confirmDelete.company_name}"? This can't be undone.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={remove}
        />
      )}
    </Nav>
  );
}