"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft, ShoppingCart, Building2, Warehouse, Calendar, FileText, Package,
  PackageCheck, Check,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, Badge, money, PrimaryBtn, ModalShell, inputCls } from "@/components/ui";

const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString() : "—");

const STATUSES = ["Open", "Ordered", "Received", "Cancelled"];
const STATUS_STYLES = {
  Open: "border-slate-600 text-slate-400",
  Ordered: "border-sky-400/30 text-sky-400",
  Received: "border-emerald-400/30 text-emerald-400",
  Cancelled: "border-red-400/30 text-red-400",
};

export default function PODetailPage() {
  const router = useRouter();
  const params = useParams();
  const poId = params?.id;

  const [orgId, setOrgId] = useState(null);
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
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

  /*
   * =========================================================
   * STATUS CHANGE (Open / Ordered / Cancelled only)
   * =========================================================
   *
   * "Received" is no longer settable directly from here -- it's
   * now driven by actually receiving line items (see the Receive
   * Products modal below), which auto-sets status to Received
   * once every line is fully received. That replaces the old
   * all-or-nothing "click Received -> add full qty" behavior.
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
            <div className="flex items-center gap-2">
              <ShoppingCart size={18} className="text-orange-400" />
              <span className="text-lg font-medium text-slate-100">{po.po_no}</span>
              <Badge className={STATUS_STYLES[po.status] || STATUS_STYLES.Open}>{po.status}</Badge>
            </div>
          </div>
          {anyReceivable && po.status !== "Cancelled" && (
            <PrimaryBtn onClick={() => setReceiveModalOpen(true)}>
              <PackageCheck size={15} /> Receive Products
            </PrimaryBtn>
          )}
        </div>

        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        {/* ================= INFO CARDS ================= */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Panel title="Vendor" icon={Building2}>
            <div className="text-sm text-slate-100">{po.vendor}</div>
          </Panel>

          <Panel title="Delivered To" icon={Warehouse}>
            <div className="text-sm text-slate-100">{po.locations?.name || "—"}</div>
            {po.jobs && (
              <div className="text-xs text-slate-500 mt-1">Job: {po.jobs.job_no} — {po.jobs.client}</div>
            )}
          </Panel>

          <Panel title="Dates" icon={Calendar}>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-slate-500">Order Date</div>
                <div className="text-sm text-slate-100">{fmtDate(po.po_date)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Delivery Date</div>
                <div className="text-sm text-slate-100">{fmtDate(po.delivery_date)}</div>
              </div>
            </div>
          </Panel>
        </div>

        {/* ================= STATUS CHANGE ================= */}
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-xs f-mono uppercase text-slate-500">Change Status:</span>
          {STATUSES.map((s) => {
            const isReceived = s === "Received";
            return (
              <button
                key={s}
                onClick={() => !isReceived && changeStatus(s)}
                disabled={statusSaving || s === po.status || isReceived}
                title={isReceived ? "Receive line items below instead — status updates automatically once everything's in." : undefined}
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

        {/* ================= LINE ITEMS ================= */}
        <Panel title="Line Items" icon={Package}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr>
                  <Th>Product</Th><Th>Code/SKU</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Received</Th>
                  <Th className="text-right">Receivable</Th>
                  <Th className="text-right">Price</Th>
                  <Th className="text-right">Total</Th>
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
                      <Td className="text-right f-mono text-emerald-400">{received}</Td>
                      <Td className="text-right f-mono">
                        {receivable > 0 ? (
                          <span className="text-amber-400">{receivable}</span>
                        ) : (
                          <span className="text-slate-600">0</span>
                        )}
                      </Td>
                      <Td className="text-right f-mono">{money(li.unit_cost)}</Td>
                      <Td className="text-right f-mono">{money(Number(li.qty) * Number(li.unit_cost))}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end mt-3 f-mono text-sm">
            <span className="text-slate-300">Total: <b className="text-emerald-400 ml-2 text-base">{money(total)}</b></span>
          </div>
        </Panel>

        {po.notes && (
          <Panel title="Notes" icon={FileText}>
            <div className="text-sm text-slate-300">{po.notes}</div>
          </Panel>
        )}
      </div>

      {receiveModalOpen && (
        <ReceiveProductsModal
          po={po}
          onClose={() => setReceiveModalOpen(false)}
          onReceived={() => { setReceiveModalOpen(false); fetchPO(); }}
        />
      )}
    </Nav>
  );
}

/*
 * =============================================================
 * RECEIVE PRODUCTS MODAL
 * =============================================================
 *
 * One row per line item that still has something outstanding
 * (receivable > 0). Defaults each input to the full receivable
 * amount (the common case — everything ordered actually showed
 * up), but it's editable per line for partial/split deliveries.
 * Submits the whole batch to receive_po_line_items in one call.
 */

function ReceiveProductsModal({ po, onClose, onReceived }) {
  const receivableLines = (po.po_line_items || [])
    .map((li) => ({
      ...li,
      receivable: Math.max(Number(li.qty) - Number(li.qty_received || 0), 0),
    }))
    .filter((li) => li.receivable > 0);

  const [amounts, setAmounts] = useState(
    Object.fromEntries(receivableLines.map((li) => [li.id, li.receivable]))
  );
  const [receiveDate, setReceiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateAmount = (lineId, val, max) => {
    const n = Math.max(0, Math.min(Number(val) || 0, max));
    setAmounts({ ...amounts, [lineId]: n });
  };

  const submit = async () => {
    const receipts = receivableLines
      .map((li) => ({ line_item_id: li.id, qty: Number(amounts[li.id] || 0) }))
      .filter((r) => r.qty > 0);

    if (receipts.length === 0) {
      setError("Enter a quantity for at least one item.");
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
        <label className="text-xs text-slate-500 block mb-1">Received Date</label>
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

      {error && <div className="text-sm text-red-400 mb-3 border border-red-900/50 bg-red-950/20 rounded px-3 py-2">{error}</div>}

      <div className="border border-slate-800 rounded">
        <div className="grid grid-cols-[2fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500">
          <span>Product</span><span className="text-right">Ordered</span><span className="text-right">Already In</span><span className="text-right">Receiving Now</span>
        </div>
        {receivableLines.map((li) => (
          <div key={li.id} className="grid grid-cols-[2fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
            <div>
              <div className="text-sm text-slate-100">{li.parts?.part_no || "—"}</div>
              <div className="text-xs f-mono text-slate-500">{li.parts?.sku}</div>
            </div>
            <div className="text-right f-mono text-sm text-slate-400">{li.qty}</div>
            <div className="text-right f-mono text-sm text-emerald-400">{li.qty_received || 0}</div>
            <input
              type="number"
              min="0"
              max={li.receivable}
              className={inputCls}
              value={amounts[li.id]}
              onChange={(e) => updateAmount(li.id, e.target.value, li.receivable)}
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
        <PrimaryBtn onClick={submit} className={saving ? "opacity-60 pointer-events-none" : ""}>
          <Check size={15} /> {saving ? "Receiving..." : "Confirm Receipt"}
        </PrimaryBtn>
      </div>
    </ModalShell>
  );
}