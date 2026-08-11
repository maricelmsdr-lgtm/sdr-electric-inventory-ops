"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft, ShoppingCart, Building2, Warehouse, Calendar, FileText, Package,
  PackageCheck, Check, RotateCcw, Mail, FileDown, Copy, Pencil, Trash2, DollarSign,
  User,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, Badge, money, PrimaryBtn, ModalShell, inputCls, ConfirmModal } from "@/components/ui";

const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");

const STATUSES = ["Open", "Ordered", "Received", "Cancelled"];
const STATUS_STYLES = {
  Open: "border-slate-600 text-slate-400",
  Ordered: "border-sky-400/30 text-sky-400",
  Received: "border-emerald-400/30 text-emerald-400",
  Cancelled: "border-red-400/30 text-red-400",
};

const TABS = [
  { key: "lines", label: "Purchase Lines" },
  { key: "received", label: "Received Items" },
  { key: "returns", label: "Returns" },
];

export default function PODetailPage() {
  const router = useRouter();
  const params = useParams();
  const poId = params?.id;

  const [orgId, setOrgId] = useState(null);
  const [user, setUser] = useState(null);
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [tab, setTab] = useState("lines");
  const [comingSoon, setComingSoon] = useState(null); // { label } for the toast/notice

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
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
    if (!orgId || !poId) return;
    fetchPO();
  }, [orgId, poId]);

  const fetchPO = async () => {
    setLoading(true);
    setError("");

    const { data, error: err } = await supabase
      .from("purchase_orders")
      .select("*, po_line_items(*, parts(part_no, sku, description)), locations(name, type), jobs(job_no, client)")
      .eq("id", poId)
      .eq("org_id", orgId)
      .single();

    if (err) setError(err.message);
    setPo(data || null);
    setLoading(false);
  };

  const logActivity = async (message) => {
    await supabase.from("activity_log").insert({ org_id: orgId, user_id: user.id, message });
  };

  /*
   * =========================================================
   * STATUS CHANGE (Open / Ordered / Cancelled only)
   * =========================================================
   *
   * "Received" is no longer settable directly from here -- it's
   * driven by actually receiving line items (Receive Products
   * modal below), which auto-sets status to Received once every
   * line is fully received.
   */

  const changeStatus = async (newStatus) => {
    if (!po || newStatus === po.status) return;
    setStatusSaving(true);
    setError("");
    try {
      const { error: updErr } = await supabase
        .from("purchase_orders")
        .update({ status: newStatus })
        .eq("id", po.id);
      if (updErr) throw updErr;
      await fetchPO();
    } catch (e) {
      setError(e.message || "Could not update status.");
    } finally {
      setStatusSaving(false);
    }
  };

  /*
   * =========================================================
   * CLONE — duplicates this PO (header + line items) as a new
   * Open PO with a fresh sequential number, today's date, and
   * qty_received reset to 0. Everything else (vendor, delivery
   * location, notes, line items/prices) carries over.
   * =========================================================
   */

  const clonePO = async () => {
    if (!po) return;
    setCloning(true);
    setError("");
    try {
      const { count } = await supabase
        .from("purchase_orders")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId);
      const newPoNo = `PUR-${1000 + (count || 0)}`;

      const { data: newPo, error: insErr } = await supabase
        .from("purchase_orders")
        .insert({
          org_id: orgId,
          po_no: newPoNo,
          vendor: po.vendor,
          vendor_id: po.vendor_id,
          job_id: po.job_id,
          delivery_location_id: po.delivery_location_id,
          po_date: new Date().toISOString().slice(0, 10),
          delivery_date: null,
          notes: po.notes,
          status: "Open",
        })
        .select()
        .single();
      if (insErr) throw insErr;

      const lineRows = (po.po_line_items || []).map((li) => ({
        po_id: newPo.id,
        part_id: li.part_id,
        qty: li.qty,
        unit_cost: li.unit_cost,
      }));
      if (lineRows.length) {
        const { error: liErr } = await supabase.from("po_line_items").insert(lineRows);
        if (liErr) throw liErr;
      }

      await logActivity(`Cloned PO ${po.po_no} → ${newPoNo}`);
      router.push(`/purchase-orders/${newPo.id}`);
    } catch (e) {
      setError(e.message || "Could not clone this PO.");
    } finally {
      setCloning(false);
    }
  };

  const deletePO = async () => {
    if (!po) return;
    const { error: delErr } = await supabase.from("purchase_orders").delete().eq("id", po.id);
    if (delErr) { setError(delErr.message); setConfirmDelete(false); return; }
    await logActivity(`Deleted PO ${po.po_no}`);
    router.push("/purchase-orders");
  };

  const flagComingSoon = (label) => {
    setComingSoon(label);
    setTimeout(() => setComingSoon(null), 2500);
  };

  if (loading || !po) {
    return (
      <Nav title="Purchase Order">
        <div className="p-6 text-sm text-slate-500 f-mono uppercase tracking-widest">
          {error || "Loading..."}
        </div>
      </Nav>
    );
  }

  const total = (po.po_line_items || []).reduce((s, li) => s + Number(li.qty) * Number(li.unit_cost), 0);
  const anyReceivable = (po.po_line_items || []).some(
    (li) => Number(li.qty_received || 0) < Number(li.qty)
  );
  const receivedLines = (po.po_line_items || []).filter((li) => Number(li.qty_received || 0) > 0);

  return (
    <Nav title="Purchase Order">
      <div className="p-4 md:p-6">
        {/* ================= HEADER ================= */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/purchase-orders")}
              className="p-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <ShoppingCart size={17} className="text-orange-400" />
                <span className="text-lg font-medium text-slate-100">{po.po_no}</span>
                <Badge className={STATUS_STYLES[po.status] || STATUS_STYLES.Open}>{po.status}</Badge>
              </div>
              {user && (
                <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5 ml-6">
                  <User size={11} /> {user.email}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {anyReceivable && po.status !== "Cancelled" && (
              <button
                onClick={() => setReceiveModalOpen(true)}
                className="px-3 py-2 text-sm rounded border border-slate-700 text-slate-200 hover:bg-slate-800 flex items-center gap-1.5"
              >
                <PackageCheck size={14} /> Receive
              </button>
            )}
            <button
              onClick={() => flagComingSoon("Returns")}
              className="px-3 py-2 text-sm rounded border border-slate-700 text-slate-400 hover:bg-slate-800 flex items-center gap-1.5"
            >
              <RotateCcw size={14} /> Return
            </button>
            <button
              onClick={() => flagComingSoon("Email")}
              className="px-3 py-2 text-sm rounded border border-slate-700 text-slate-400 hover:bg-slate-800 flex items-center gap-1.5"
            >
              <Mail size={14} /> Email
            </button>
            <button
              onClick={() => flagComingSoon("PDF export")}
              className="px-3 py-2 text-sm rounded border border-slate-700 text-slate-400 hover:bg-slate-800 flex items-center gap-1.5"
            >
              <FileDown size={14} /> PDF
            </button>
            <button
              onClick={clonePO}
              disabled={cloning}
              className={`px-3 py-2 text-sm rounded border border-slate-700 text-slate-200 hover:bg-slate-800 flex items-center gap-1.5 ${cloning ? "opacity-60 pointer-events-none" : ""}`}
            >
              <Copy size={14} /> {cloning ? "Cloning..." : "Clone"}
            </button>
            <button
              onClick={() => flagComingSoon("Editing from here — use the list page's Edit for now")}
              className="p-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2 rounded border border-red-900/50 text-red-400 hover:bg-red-950/30"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {comingSoon && (
          <div className="text-xs text-amber-400 mb-3 border border-amber-900/40 bg-amber-950/20 rounded px-3 py-2">
            {comingSoon} isn't built yet — coming in a future update.
          </div>
        )}
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        {/* ================= 3-CARD SUMMARY ================= */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Panel title="Purchase Information" icon={Building2}>
            <div className="text-xs text-slate-500">Vendor</div>
            <div className="text-sm text-slate-100 mb-2">{po.vendor}</div>
            <div className="text-xs text-slate-500">Delivered To</div>
            <div className="text-sm text-slate-100 mb-2">{po.locations?.name || "—"}</div>
            {po.jobs && (
              <>
                <div className="text-xs text-slate-500">For Job</div>
                <div className="text-sm text-slate-100">{po.jobs.job_no} — {po.jobs.client}</div>
              </>
            )}
          </Panel>

          <Panel title="Dates & Status" icon={Calendar}>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-slate-500">Purchase Date</div>
                <div className="text-sm text-slate-100">{fmtDate(po.po_date)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Deliver By</div>
                <div className="text-sm text-slate-100">{fmtDate(po.delivery_date) === "—" ? "N/A" : fmtDate(po.delivery_date)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Sent On</div>
                <div className="text-sm text-slate-500">Not Sent</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Status</div>
                <Badge className={STATUS_STYLES[po.status] || STATUS_STYLES.Open}>{po.status}</Badge>
              </div>
            </div>
          </Panel>

          <Panel title="Payment" icon={DollarSign}>
            {/* No payment tracking table yet -- Total Payable is derived
                from line items (real); everything else is a static
                placeholder until an amount_paid/due_date schema exists. */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">Status</span>
              <Badge className="border-red-400/30 text-red-400">Unpaid</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-slate-500">Total Payable</div>
                <div className="text-sm text-slate-100">{money(total)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Amount Paid</div>
                <div className="text-sm text-slate-100">{money(0)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Payment Date</div>
                <div className="text-sm text-slate-500">Not Set</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Due Date</div>
                <div className="text-sm text-slate-500">Not Set</div>
              </div>
            </div>
          </Panel>
        </div>

        {/* ================= LEGACY STATUS BUTTONS (kept for Open/Ordered/Cancelled) ================= */}
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-xs f-mono uppercase text-slate-500">Change Status:</span>
          {STATUSES.map((s) => {
            const isReceived = s === "Received";
            return (
              <button
                key={s}
                onClick={() => !isReceived && changeStatus(s)}
                disabled={statusSaving || s === po.status || isReceived}
                title={isReceived ? "Receive line items instead — status updates automatically once everything's in." : undefined}
                className={`px-3 py-1.5 text-xs rounded border ${
                  s === po.status
                    ? "opacity-40 cursor-not-allowed border-slate-700 text-slate-500"
                    : isReceived
                    ? "opacity-30 cursor-not-allowed border-slate-800 text-slate-600"
                    : "border-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* ================= TABS ================= */}
        <div className="flex gap-4 border-b border-slate-800 mb-4 text-sm">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-2 px-1 ${tab === t.key ? "text-orange-400 border-b-2 border-orange-500" : "text-slate-500"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ================= PURCHASE LINES TAB ================= */}
        {tab === "lines" && (
          <Panel title="Purchase Lines" icon={Package}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    <Th>Product</Th><Th>Code/SKU</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Price</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">Receivable</Th>
                    <Th className="text-right">Returned</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {(po.po_line_items || []).map((li) => {
                    const received = Number(li.qty_received || 0);
                    const ordered = Number(li.qty);
                    const receivable = Math.max(ordered - received, 0);
                    return (
                      <tr key={li.id} className="border-t border-slate-800/70">
                        <Td>{li.parts?.part_no || "—"}</Td>
                        <Td className="f-mono text-xs text-slate-400">{li.parts?.sku || "—"}</Td>
                        <Td className="text-right f-mono">{ordered}</Td>
                        <Td className="text-right f-mono">{money(li.unit_cost)}</Td>
                        <Td className="text-right f-mono">{money(Number(li.qty) * Number(li.unit_cost))}</Td>
                        <Td className="text-right f-mono text-emerald-400">{received}</Td>
                        <Td className="text-right f-mono">
                          {receivable > 0 ? <span className="text-amber-400">{receivable}</span> : <span className="text-slate-600">0</span>}
                        </Td>
                        {/* Returns aren't built yet (see Returns tab) -- always 0 for now */}
                        <Td className="text-right f-mono text-slate-600">0</Td>
                        <Td>
                          <div className="flex gap-1.5 justify-end">
                            <IconBtn onClick={() => flagComingSoon("Editing individual line items")}><Pencil size={12} /></IconBtn>
                            <IconBtn danger onClick={() => flagComingSoon("Deleting individual line items")}><Trash2 size={12} /></IconBtn>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700">
                    <Td colSpan={4} className="text-slate-400 f-mono text-xs uppercase">Total</Td>
                    <Td className="text-right f-mono text-emerald-400 font-medium">{money(total)}</Td>
                    <Td colSpan={4}></Td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>
        )}

        {/* ================= RECEIVED ITEMS TAB ================= */}
        {tab === "received" && (
          <Panel title="Received Items" icon={PackageCheck}>
            {receivedLines.length === 0 ? (
              <div className="text-sm text-slate-500 p-2">Nothing received on this PO yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead><tr><Th>Product</Th><Th>Code/SKU</Th><Th className="text-right">Received Qty</Th></tr></thead>
                  <tbody>
                    {receivedLines.map((li) => (
                      <tr key={li.id} className="border-t border-slate-800/70">
                        <Td>{li.parts?.part_no || "—"}</Td>
                        <Td className="f-mono text-xs text-slate-400">{li.parts?.sku || "—"}</Td>
                        <Td className="text-right f-mono text-emerald-400">{li.qty_received}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[11px] text-slate-600 mt-2 px-1">
                  Shows current received totals per line — a timestamped receiving history
                  (who received what, and when) would need its own table. Future session.
                </div>
              </div>
            )}
          </Panel>
        )}

        {/* ================= RETURNS TAB ================= */}
        {tab === "returns" && (
          <Panel title="Returns" icon={RotateCcw}>
            <div className="text-sm text-slate-500 p-2">
              Not built yet — returning received stock back to a vendor needs its own
              flow (which items, how many, restocking vs. return-to-vendor, inventory
              impact). Future session.
            </div>
          </Panel>
        )}

        {po.notes && (
          <Panel title="Notes" icon={FileText}>
            <div className="text-sm text-slate-300">{po.notes}</div>
          </Panel>
        )}

        <Panel title="Attachments" icon={FileText}>
          <div
            onClick={() => flagComingSoon("File attachments")}
            className="border border-dashed border-slate-700 rounded p-8 text-center cursor-pointer hover:border-slate-600"
          >
            <FileDown size={20} className="mx-auto mb-2 text-slate-600" />
            <div className="text-sm text-slate-400">No attachments yet</div>
            <div className="text-xs text-slate-600 mt-1">PDF, DOC, DOCX, XLS, XLSX, JPG, PNG (Max 10MB)</div>
          </div>
        </Panel>
      </div>

      {receiveModalOpen && (
        <ReceiveProductsModal
          po={po}
          onClose={() => setReceiveModalOpen(false)}
          onReceived={() => { setReceiveModalOpen(false); fetchPO(); }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete PO"
          message={`Delete "${po.po_no}"? This can't be undone.`}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={deletePO}
        />
      )}
    </Nav>
  );
}

/*
 * =============================================================
 * RECEIVE PRODUCTS MODAL
 * =============================================================
 */

function ReceiveProductsModal({ po, onClose, onReceived }) {
  const receivableLines = (po.po_line_items || [])
    .map((li) => ({
      ...li,
      receivable: Math.max(Number(li.qty) - Number(li.qty_received || 0), 0),
    }))
    .filter((li) => li.receivable > 0);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set(receivableLines.map((li) => li.id)));
  const [amounts, setAmounts] = useState(
    Object.fromEntries(receivableLines.map((li) => [li.id, li.receivable]))
  );
  const [receiveDate, setReceiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const visibleLines = receivableLines.filter((li) =>
    `${li.parts?.part_no || ""} ${li.parts?.sku || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelected = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === receivableLines.length) setSelected(new Set());
    else setSelected(new Set(receivableLines.map((li) => li.id)));
  };

  const updateAmount = (lineId, val, max) => {
    const n = Math.max(0, Math.min(Number(val) || 0, max));
    setAmounts({ ...amounts, [lineId]: n });
  };

  const submit = async () => {
    const receipts = receivableLines
      .filter((li) => selected.has(li.id))
      .map((li) => ({ line_item_id: li.id, qty: Number(amounts[li.id] || 0) }))
      .filter((r) => r.qty > 0);

    if (receipts.length === 0) {
      setError("Select at least one item and enter a quantity.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const { error: rpcErr } = await supabase.rpc("receive_po_line_items", {
        p_po_id: po.id,
        p_receipts: receipts,
      });
      if (rpcErr) throw rpcErr;
      onReceived();
    } catch (e) {
      setError(e.message || "Could not receive items.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Receive Products" icon={PackageCheck} onClose={onClose} wide>
      <div className="mb-3">
        <label className="text-xs text-slate-500 block mb-1">Date</label>
        <input
          type="date"
          className={`${inputCls} w-auto`}
          value={receiveDate}
          onChange={(e) => setReceiveDate(e.target.value)}
        />
        <div className="text-[11px] text-slate-600 mt-1">
          Date shown for reference only — not yet stored per receipt (would need a
          separate receiving-history table; future session).
        </div>
      </div>

      <input
        type="text"
        placeholder="Search products..."
        className={`${inputCls} mb-3`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="text-sm text-red-400 mb-3 border border-red-900/50 bg-red-950/20 rounded px-3 py-2">{error}</div>}

      <div className="border border-slate-800 rounded">
        <div className="grid grid-cols-[auto_2fr_0.8fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500 items-center">
          <input type="checkbox" checked={selected.size === receivableLines.length} onChange={toggleSelectAll} />
          <span>Product (UOM)</span>
          <span className="text-right">Quantity</span>
          <span className="text-right">Received</span>
          <span className="text-right">Receivable</span>
          <span className="text-right">Qty To Receive</span>
        </div>
        {visibleLines.map((li) => (
          <div key={li.id} className="grid grid-cols-[auto_2fr_0.8fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
            <input type="checkbox" checked={selected.has(li.id)} onChange={() => toggleSelected(li.id)} />
            <div>
              <div className="text-sm text-slate-100">{li.parts?.part_no || "—"}</div>
              <div className="text-xs f-mono text-slate-500">{li.parts?.sku}</div>
            </div>
            <div className="text-right f-mono text-sm text-slate-400">{li.qty}</div>
            <div className="text-right f-mono text-sm text-emerald-400">{li.qty_received || 0}</div>
            <div className="text-right f-mono text-sm text-amber-400">{li.receivable}</div>
            <input
              type="number"
              min="0"
              max={li.receivable}
              className={inputCls}
              disabled={!selected.has(li.id)}
              value={amounts[li.id]}
              onChange={(e) => updateAmount(li.id, e.target.value, li.receivable)}
            />
          </div>
        ))}
        {visibleLines.length === 0 && (
          <div className="p-4 text-sm text-slate-500">No matching items.</div>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
        <PrimaryBtn onClick={submit} className={saving ? "opacity-60 pointer-events-none" : ""}>
          <Check size={15} /> {saving ? "Saving..." : "Save"}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}