"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  User,
  FileText,
  DollarSign,
  Package,
  Truck,
  RotateCcw,
  History,
  Plus,
  Minus,
  AlertTriangle,
  CheckCircle2,
  X,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, Badge, money } from "@/components/ui";

const fmtDate = (d) => {
  if (!d) return "NA";

  return new Date(d + (String(d).includes("T") ? "" : "T00:00:00"))
    .toLocaleDateString();
};

const fmtDateTime = (d) => {
  if (!d) return "NA";

  return new Date(d).toLocaleString();
};

const STATUS_STYLES = {
  Open: "border-slate-600 text-slate-400",
  Ordered: "border-sky-400/30 text-sky-400",
  Received: "border-emerald-400/30 text-emerald-400",
  Cancelled: "border-red-400/30 text-red-400",
};

const TABS = [
  { key: "planned", label: "Planned Materials", icon: Package },
  { key: "issued", label: "Issued Materials", icon: FileText },
  { key: "purchases", label: "Purchases", icon: Truck },
  { key: "returned", label: "Returned Materials", icon: RotateCcw },
  { key: "history", label: "Job History", icon: History },
];

export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams();

  const jobId = params?.id;

  const [orgId, setOrgId] = useState(null);
  const [userId, setUserId] = useState(null);

  const [job, setJob] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [issuedMaterials, setIssuedMaterials] = useState([]);

  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [tab, setTab] = useState("planned");

  const [issueModal, setIssueModal] = useState(false);
  const [selectedPart, setSelectedPart] = useState(null);
  const [issueQty, setIssueQty] = useState("1");
  const [issueNotes, setIssueNotes] = useState("");

  /*
   * ============================================================
   * AUTH
   * ============================================================
   */

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      setUserId(user.id);

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (profileError) {
        setError(profileError.message);
        return;
      }

      setOrgId(profile?.org_id || null);
    })();
  }, [router]);

  /*
   * ============================================================
   * LOAD JOB
   * ============================================================
   */

  useEffect(() => {
    if (!orgId || !jobId) return;

    fetchJob();
  }, [orgId, jobId]);

  const fetchJob = async () => {
    setLoading(true);
    setError("");

    const [
      { data: jobData, error: jobErr },
      { data: poData, error: poErr },
      { data: issuedData, error: issuedErr },
    ] = await Promise.all([
      supabase
        .from("jobs")
        .select(
          "*, job_line_items(*, parts(id, part_no, sku, description, qty, part_cost, sale_cost))"
        )
        .eq("id", jobId)
        .eq("org_id", orgId)
        .single(),

      supabase
        .from("purchase_orders")
        .select("*, po_line_items(*, parts(part_no, sku))")
        .eq("job_id", jobId)
        .eq("org_id", orgId)
        .order("po_date", { ascending: false }),

      supabase
        .from("job_issued_materials")
        .select(
          `
            *,
            parts (
              id,
              part_no,
              sku,
              description
            )
          `
        )
        .eq("job_id", jobId)
        .eq("org_id", orgId)
        .order("issued_at", { ascending: false }),
    ]);

    if (jobErr) {
      setError(jobErr.message);
    }

    if (poErr) {
      setError((prev) => prev || poErr.message);
    }

    if (issuedErr) {
      setError((prev) => prev || issuedErr.message);
    }

    setJob(jobData || null);
    setPurchases(poData || []);
    setIssuedMaterials(issuedData || []);

    setLoading(false);
  };

  /*
   * ============================================================
   * PURCHASE ROWS
   * ============================================================
   */

  const purchaseRows = purchases.flatMap((po) =>
    (po.po_line_items || []).map((li) => ({
      po_id: po.id,
      po_no: po.po_no,
      po_date: po.po_date,
      vendor: po.vendor,
      status: po.status,
      part_no: li.parts?.part_no || "—",
      sku: li.parts?.sku || "—",
      qty: li.qty,
      unit_cost: li.unit_cost,
      received: po.status === "Received" ? li.qty : 0,
    }))
  );

  /*
   * ============================================================
   * PLANNED / ISSUED CALCULATIONS
   * ============================================================
   */

  const issuedByPart = useMemo(() => {
    const map = {};

    for (const row of issuedMaterials) {
      if (!row.part_id) continue;

      map[row.part_id] =
        Number(map[row.part_id] || 0) + Number(row.qty || 0);
    }

    return map;
  }, [issuedMaterials]);

  const plannedRows = useMemo(() => {
    return (job?.job_line_items || []).map((li) => {
      const plannedQty = Number(li.qty || 0);
      const issuedQty = Number(issuedByPart[li.part_id] || 0);

      return {
        ...li,
        plannedQty,
        issuedQty,
        remainingQty: Math.max(plannedQty - issuedQty, 0),
      };
    });
  }, [job, issuedByPart]);

  const plannedTotal = (job?.job_line_items || []).reduce(
    (s, li) =>
      s +
      Number(li.qty || 0) *
        Number(li.part_cost || 0),
    0
  );

  const plannedSaleTotal = (job?.job_line_items || []).reduce(
    (s, li) =>
      s +
      Number(li.qty || 0) *
        Number(li.sale_cost || 0),
    0
  );

  const issuedTotal = issuedMaterials.reduce(
    (s, row) =>
      s +
      Number(row.qty || 0) *
        Number(row.unit_cost || 0),
    0
  );

  const issuedQtyTotal = issuedMaterials.reduce(
    (s, row) => s + Number(row.qty || 0),
    0
  );

  /*
   * ============================================================
   * ISSUE MODAL
   * ============================================================
   */

  const openIssueModal = (lineItem) => {
    setSelectedPart(lineItem);
    setIssueQty(
      lineItem.remainingQty > 0
        ? String(lineItem.remainingQty)
        : "1"
    );
    setIssueNotes("");
    setError("");
    setSuccess("");
    setIssueModal(true);
  };

  const closeIssueModal = () => {
    if (issuing) return;

    setIssueModal(false);
    setSelectedPart(null);
    setIssueQty("1");
    setIssueNotes("");
  };

  /*
   * ============================================================
   * ISSUE MATERIAL
   * ============================================================
   */

  const issueMaterial = async () => {
    if (!selectedPart || !orgId || !jobId || !userId) {
      setError("Missing job or user information.");
      return;
    }

    const qty = Number(issueQty);

    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Issue quantity must be greater than zero.");
      return;
    }

    const availableStock = Number(
      selectedPart.parts?.qty || 0
    );

    if (qty > availableStock) {
      setError(
        `Insufficient stock. Available: ${availableStock}. Requested: ${qty}.`
      );
      return;
    }

    setIssuing(true);
    setError("");
    setSuccess("");

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "issue_job_material",
        {
          p_org_id: orgId,
          p_job_id: jobId,
          p_part_id: selectedPart.part_id,
          p_qty: qty,
          p_unit_cost: Number(selectedPart.part_cost || 0),
          p_issued_by: userId,
          p_notes: issueNotes.trim() || null,
        }
      );

      if (rpcError) {
        throw rpcError;
      }

      if (!data?.success) {
        throw new Error("Material issue was not completed.");
      }

      setIssueModal(false);
      setSelectedPart(null);
      setIssueQty("1");
      setIssueNotes("");

      setSuccess(
        `${qty} × ${
          selectedPart.parts?.part_no ||
          selectedPart.parts?.sku ||
          "material"
        } issued successfully.`
      );

      await fetchJob();

      setTab("issued");
    } catch (err) {
      setError(
        err?.message ||
          "Unable to issue material."
      );
    } finally {
      setIssuing(false);
    }
  };

  /*
   * ============================================================
   * LOADING
   * ============================================================
   */

  if (loading || !job) {
    return (
      <Nav title="Job Detail">
        <div className="p-6 text-sm text-slate-500 f-mono uppercase tracking-widest">
          {error || "Loading..."}
        </div>
      </Nav>
    );
  }

  /*
   * ============================================================
   * PAGE
   * ============================================================
   */

  return (
    <Nav title="Job Detail">
      <div className="p-4 md:p-6">

        {/* ======================================================
            HEADER
        ====================================================== */}

        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3">

            <button
              onClick={() => router.push("/jobs")}
              className="p-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <ArrowLeft size={16} />
            </button>

            <div className="flex items-center gap-2">
              <span className="text-lg font-medium text-slate-100">
                #{job.job_no}
              </span>

              <Badge className="border-sky-400/30 text-sky-400">
                Open
              </Badge>
            </div>

          </div>
        </div>

        {/* ======================================================
            NOTIFICATIONS
        ====================================================== */}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-400">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-start gap-2 rounded border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-400">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* ======================================================
            INFO CARDS
        ====================================================== */}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

          <Panel title="Customer & Property" icon={User}>
            <div className="text-xs text-slate-500">
              Customer
            </div>

            <div className="text-sm text-slate-100 mb-2">
              {job.client || "NA"}
            </div>

            <div className="text-xs text-slate-500">
              Address
            </div>

            <div className="text-sm text-slate-100">
              {job.address || "NA"}
            </div>
          </Panel>

          <Panel title="Job Information" icon={FileText}>
            <div className="grid grid-cols-2 gap-2">

              <div>
                <div className="text-xs text-slate-500">
                  Start
                </div>

                <div className="text-sm text-slate-100">
                  {fmtDate(job.job_date)}
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500">
                  Technician
                </div>

                <div className="text-sm text-slate-100">
                  {job.technician || "NA"}
                </div>
              </div>

            </div>
          </Panel>

          <Panel title="Cost Breakdown" icon={DollarSign}>

            <div className="grid grid-cols-2 gap-2">

              <div>
                <div className="text-xs text-slate-500">
                  Planned Parts
                </div>

                <div className="text-sm text-slate-100">
                  {money(plannedTotal)}
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500">
                  Issued Parts
                </div>

                <div className="text-sm text-orange-400">
                  {money(issuedTotal)}
                </div>
              </div>

            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">

              <div>
                <div className="text-xs text-slate-500">
                  Sales Total
                </div>

                <div className="text-sm text-emerald-400">
                  {money(plannedSaleTotal)}
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500">
                  Qty Issued
                </div>

                <div className="text-sm text-slate-100">
                  {issuedQtyTotal}
                </div>
              </div>

            </div>

            <div className="text-[10px] text-slate-600 mt-2">
              Issued cost reflects actual material issues recorded against this job.
            </div>

          </Panel>

        </div>

        {/* ======================================================
            TABS
        ====================================================== */}

        <div className="flex gap-4 border-b border-slate-800 mb-4 text-sm overflow-x-auto">

          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setError("");
                setSuccess("");
              }}
              className={`pb-2 px-1 flex items-center gap-1.5 whitespace-nowrap ${
                tab === t.key
                  ? "text-orange-400 border-b-2 border-orange-500"
                  : "text-slate-500"
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}

        </div>

        {/* ======================================================
            PLANNED MATERIALS
        ====================================================== */}

        {tab === "planned" && (
          <Panel title="Planned Materials" icon={Package}>

            {plannedRows.length === 0 ? (
              <div className="text-sm text-slate-500 p-2">
                No materials planned for this job.
              </div>
            ) : (

              <div className="overflow-x-auto">

                <table className="w-full min-w-[850px]">

                  <thead>
                    <tr>
                      <Th>Product</Th>
                      <Th>Code/SKU</Th>
                      <Th className="text-right">
                        Planned
                      </Th>
                      <Th className="text-right">
                        Issued
                      </Th>
                      <Th className="text-right">
                        Remaining
                      </Th>
                      <Th className="text-right">
                        Stock
                      </Th>
                      <Th className="text-right">
                        Part Cost
                      </Th>
                      <Th className="text-right">
                        Action
                      </Th>
                    </tr>
                  </thead>

                  <tbody>

                    {plannedRows.map((li) => {

                      const stock = Number(
                        li.parts?.qty || 0
                      );

                      const fullyIssued =
                        li.remainingQty <= 0;

                      const insufficient =
                        stock <= 0;

                      return (
                        <tr
                          key={li.id}
                          className="border-t border-slate-800/70"
                        >

                          <Td>
                            <div className="text-slate-100">
                              {li.parts?.part_no || "—"}
                            </div>

                            {li.parts?.description && (
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {li.parts.description}
                              </div>
                            )}
                          </Td>

                          <Td className="f-mono text-xs text-slate-400">
                            {li.parts?.sku || "—"}
                          </Td>

                          <Td className="text-right f-mono">
                            {li.plannedQty}
                          </Td>

                          <Td className="text-right f-mono text-orange-400">
                            {li.issuedQty}
                          </Td>

                          <Td
                            className={`text-right f-mono ${
                              li.remainingQty > 0
                                ? "text-slate-100"
                                : "text-emerald-400"
                            }`}
                          >
                            {li.remainingQty}
                          </Td>

                          <Td
                            className={`text-right f-mono ${
                              stock <= 0
                                ? "text-red-400"
                                : "text-slate-100"
                            }`}
                          >
                            {stock}
                          </Td>

                          <Td className="text-right f-mono">
                            {money(li.part_cost)}
                          </Td>

                          <Td className="text-right">

                            {fullyIssued ? (

                              <Badge className="border-emerald-400/30 text-emerald-400">
                                Fully Issued
                              </Badge>

                            ) : insufficient ? (

                              <Badge className="border-red-400/30 text-red-400">
                                No Stock
                              </Badge>

                            ) : (

                              <button
                                onClick={() => openIssueModal(li)}
                                className="inline-flex items-center gap-1.5 rounded border border-orange-400/30 px-2.5 py-1.5 text-xs text-orange-400 hover:bg-orange-400/10"
                              >
                                <Plus size={13} />
                                Issue
                              </button>

                            )}

                          </Td>

                        </tr>
                      );
                    })}

                  </tbody>

                </table>

              </div>
            )}

          </Panel>
        )}

        {/* ======================================================
            ISSUED MATERIALS
        ====================================================== */}

        {tab === "issued" && (
          <Panel title="Issued Materials" icon={FileText}>

            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">

              <div>
                <div className="text-sm text-slate-300">
                  Materials formally issued to this job
                </div>

                <div className="text-xs text-slate-500 mt-1">
                  Issuing material reduces available inventory.
                </div>
              </div>

              <div className="flex gap-4 text-xs">

                <div>
                  <span className="text-slate-500">
                    Lines
                  </span>

                  <span className="ml-2 text-slate-100 f-mono">
                    {issuedMaterials.length}
                  </span>
                </div>

                <div>
                  <span className="text-slate-500">
                    Qty
                  </span>

                  <span className="ml-2 text-orange-400 f-mono">
                    {issuedQtyTotal}
                  </span>
                </div>

                <div>
                  <span className="text-slate-500">
                    Cost
                  </span>

                  <span className="ml-2 text-orange-400 f-mono">
                    {money(issuedTotal)}
                  </span>
                </div>

              </div>

            </div>

            {issuedMaterials.length === 0 ? (

              <div className="rounded border border-dashed border-slate-800 p-8 text-center">

                <Package
                  size={24}
                  className="mx-auto mb-2 text-slate-600"
                />

                <div className="text-sm text-slate-500">
                  No materials have been issued to this job.
                </div>

                <button
                  onClick={() => setTab("planned")}
                  className="mt-3 text-xs text-orange-400 hover:text-orange-300"
                >
                  Go to Planned Materials
                </button>

              </div>

            ) : (

              <div className="overflow-x-auto">

                <table className="w-full min-w-[850px]">

                  <thead>
                    <tr>
                      <Th>Product</Th>
                      <Th>Code/SKU</Th>
                      <Th className="text-right">
                        Qty
                      </Th>
                      <Th className="text-right">
                        Unit Cost
                      </Th>
                      <Th className="text-right">
                        Total Cost
                      </Th>
                      <Th>Issued At</Th>
                      <Th>Notes</Th>
                    </tr>
                  </thead>

                  <tbody>

                    {issuedMaterials.map((row) => {

                      const qty = Number(row.qty || 0);
                      const unitCost = Number(
                        row.unit_cost || 0
                      );

                      return (
                        <tr
                          key={row.id}
                          className="border-t border-slate-800/70"
                        >

                          <Td>
                            <div className="text-slate-100">
                              {row.parts?.part_no || "—"}
                            </div>

                            {row.parts?.description && (
                              <div className="text-[11px] text-slate-500">
                                {row.parts.description}
                              </div>
                            )}
                          </Td>

                          <Td className="f-mono text-xs text-slate-400">
                            {row.parts?.sku || "—"}
                          </Td>

                          <Td className="text-right f-mono text-orange-400">
                            {qty}
                          </Td>

                          <Td className="text-right f-mono">
                            {money(unitCost)}
                          </Td>

                          <Td className="text-right f-mono text-orange-400">
                            {money(qty * unitCost)}
                          </Td>

                          <Td className="text-xs text-slate-400">
                            {fmtDateTime(row.issued_at)}
                          </Td>

                          <Td className="text-xs text-slate-500">
                            {row.notes || "—"}
                          </Td>

                        </tr>
                      );
                    })}

                  </tbody>

                </table>

              </div>
            )}

          </Panel>
        )}

        {/* ======================================================
            PURCHASES
        ====================================================== */}

        {tab === "purchases" && (
          <Panel title="Purchases" icon={Truck}>

            {purchaseRows.length === 0 ? (

              <div className="text-sm text-slate-500 p-2">
                No purchase orders linked to this job yet.
              </div>

            ) : (

              <div className="overflow-x-auto">

                <table className="w-full min-w-[800px]">

                  <thead>
                    <tr>
                      <Th>PO No.</Th>
                      <Th>Date</Th>
                      <Th>Vendor</Th>
                      <Th>Product</Th>
                      <Th>Code/SKU</Th>
                      <Th className="text-right">
                        Qty
                      </Th>
                      <Th className="text-right">
                        Price
                      </Th>
                      <Th className="text-right">
                        Received
                      </Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>

                  <tbody>

                    {purchaseRows.map((row, i) => (

                      <tr
                        key={`${row.po_id}-${i}`}
                        className="border-t border-slate-800/70"
                      >

                        <Td className="f-mono text-orange-400">
                          {row.po_no}
                        </Td>

                        <Td className="text-slate-400">
                          {fmtDate(row.po_date)}
                        </Td>

                        <Td>
                          {row.vendor}
                        </Td>

                        <Td>
                          {row.part_no}
                        </Td>

                        <Td className="f-mono text-xs text-slate-400">
                          {row.sku}
                        </Td>

                        <Td className="text-right f-mono">
                          {row.qty}
                        </Td>

                        <Td className="text-right f-mono">
                          {money(row.unit_cost)}
                        </Td>

                        <Td className="text-right f-mono text-emerald-400">
                          {row.received}
                        </Td>

                        <Td>
                          <Badge
                            className={
                              STATUS_STYLES[row.status] ||
                              STATUS_STYLES.Open
                            }
                          >
                            {row.status}
                          </Badge>
                        </Td>

                      </tr>

                    ))}

                  </tbody>

                </table>

              </div>
            )}

          </Panel>
        )}

        {/* ======================================================
            RETURNED MATERIALS
        ====================================================== */}

        {tab === "returned" && (
          <Panel title="Returned Materials" icon={RotateCcw}>

            <div className="rounded border border-dashed border-slate-800 p-8 text-center">

              <RotateCcw
                size={24}
                className="mx-auto mb-2 text-slate-600"
              />

              <div className="text-sm text-slate-500">
                Returned Materials will track material returned
                from this job back into inventory.
              </div>

              <div className="text-xs text-slate-600 mt-2">
                This module is intentionally kept separate from
                material issuance.
              </div>

            </div>

          </Panel>
        )}

        {/* ======================================================
            JOB HISTORY
        ====================================================== */}

        {tab === "history" && (
          <Panel title="Job History" icon={History}>

            <div className="rounded border border-dashed border-slate-800 p-8 text-center">

              <History
                size={24}
                className="mx-auto mb-2 text-slate-600"
              />

              <div className="text-sm text-slate-500">
                Job History will show material issues,
                purchases, returns, adjustments and other
                job activity.
              </div>

            </div>

          </Panel>
        )}

      </div>

      {/* ========================================================
          ISSUE MATERIAL MODAL
      ======================================================== */}

      {issueModal && selectedPart && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">

          <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-[#080d1d] shadow-2xl">

            {/* MODAL HEADER */}

            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">

              <div>

                <div className="flex items-center gap-2 text-sm font-medium text-slate-100">

                  <Package
                    size={16}
                    className="text-orange-400"
                  />

                  Issue Material

                </div>

                <div className="text-xs text-slate-500 mt-1">
                  This will decrease inventory for this part.
                </div>

              </div>

              <button
                onClick={closeIssueModal}
                disabled={issuing}
                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-50"
              >
                <X size={18} />
              </button>

            </div>

            {/* MODAL BODY */}

            <div className="p-5 space-y-4">

              <div className="rounded border border-slate-800 bg-slate-950/40 p-4">

                <div className="text-sm text-slate-100">
                  {selectedPart.parts?.part_no || "Unknown Part"}
                </div>

                <div className="text-xs text-slate-500 mt-1">
                  SKU: {selectedPart.parts?.sku || "—"}
                </div>

              </div>

              <div className="grid grid-cols-3 gap-3">

                <div className="rounded border border-slate-800 p-3">

                  <div className="text-[10px] uppercase text-slate-500">
                    Planned
                  </div>

                  <div className="mt-1 text-sm f-mono text-slate-100">
                    {selectedPart.plannedQty}
                  </div>

                </div>

                <div className="rounded border border-slate-800 p-3">

                  <div className="text-[10px] uppercase text-slate-500">
                    Already Issued
                  </div>

                  <div className="mt-1 text-sm f-mono text-orange-400">
                    {selectedPart.issuedQty}
                  </div>

                </div>

                <div className="rounded border border-slate-800 p-3">

                  <div className="text-[10px] uppercase text-slate-500">
                    Stock
                  </div>

                  <div className="mt-1 text-sm f-mono text-emerald-400">
                    {Number(selectedPart.parts?.qty || 0)}
                  </div>

                </div>

              </div>

              <div>

                <label className="block text-xs text-slate-400 mb-1.5">
                  Quantity to Issue
                </label>

                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={issueQty}
                  onChange={(e) =>
                    setIssueQty(e.target.value)
                  }
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400"
                  disabled={issuing}
                />

              </div>

              <div>

                <label className="block text-xs text-slate-400 mb-1.5">
                  Notes
                </label>

                <textarea
                  value={issueNotes}
                  onChange={(e) =>
                    setIssueNotes(e.target.value)
                  }
                  rows={3}
                  placeholder="Optional note..."
                  className="w-full resize-none rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-orange-400"
                  disabled={issuing}
                />

              </div>

              <div className="rounded border border-orange-400/20 bg-orange-400/5 px-3 py-2 text-xs text-orange-300">

                <div className="flex gap-2">

                  <AlertTriangle
                    size={14}
                    className="mt-0.5 shrink-0"
                  />

                  <span>
                    Issuing this material will immediately
                    decrease the available inventory quantity.
                  </span>

                </div>

              </div>

            </div>

            {/* MODAL FOOTER */}

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-4">

              <button
                onClick={closeIssueModal}
                disabled={issuing}
                className="rounded border border-slate-700 px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                onClick={issueMaterial}
                disabled={issuing}
                className="inline-flex items-center gap-2 rounded border border-orange-400/30 bg-orange-400/10 px-4 py-2 text-xs text-orange-400 hover:bg-orange-400/20 disabled:opacity-50"
              >

                {issuing ? (
                  <>
                    <span className="animate-pulse">
                      Issuing...
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    Issue Material
                  </>
                )}

              </button>

            </div>

          </div>

        </div>

      )}

    </Nav>
  );
}