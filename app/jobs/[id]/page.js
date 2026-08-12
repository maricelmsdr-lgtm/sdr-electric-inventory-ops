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
  Send,
  Check,
  Search,
  X,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";

import {
  Panel,
  Th,
  Td,
  Badge,
  money,
  PrimaryBtn,
  ModalShell,
  inputCls,
  IconBtn,
} from "@/components/ui";

const fmtDate = (d) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString() : "NA";

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString() : "NA";

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
  const [user, setUser] = useState(null);
  const [job, setJob] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [issuedMaterials, setIssuedMaterials] = useState([]);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("planned");
  const [issueModalOpen, setIssueModalOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

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
      { data: partsData, error: partsErr },
    ] = await Promise.all([
      supabase
        .from("jobs")
        .select(
          "*, job_line_items(*, parts(id, part_no, sku, description)), locations(name, type)"
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
        .select("*, parts(id, part_no, sku, description)")
        .eq("job_id", jobId)
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),

      supabase
        .from("parts")
        .select("id, part_no, sku, description, unit_cost")
        .eq("org_id", orgId)
        .order("part_no"),
    ]);

    if (jobErr) setError(jobErr.message);
    if (poErr) setError((prev) => prev || poErr.message);
    if (issuedErr) setError((prev) => prev || issuedErr.message);
    if (partsErr) setError((prev) => prev || partsErr.message);

    setJob(jobData || null);
    setPurchases(poData || []);
    setIssuedMaterials(issuedData || []);
    setParts(partsData || []);

    setLoading(false);
  };

  const logActivity = async (message) => {
    if (!user || !orgId) return;

    await supabase.from("activity_log").insert({
      org_id: orgId,
      user_id: user.id,
      message,
    });
  };

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

  if (loading || !job) {
    return (
      <Nav title="Job Detail">
        <div className="p-6 text-sm text-slate-500 f-mono uppercase tracking-widest">
          {error || "Loading..."}
        </div>
      </Nav>
    );
  }

  const plannedTotal = (job.job_line_items || []).reduce(
    (s, li) =>
      s +
      Number(li.qty || 0) * Number(li.part_cost || 0),
    0
  );

  const plannedSaleTotal = (job.job_line_items || []).reduce(
    (s, li) =>
      s +
      Number(li.qty || 0) * Number(li.sale_cost || 0),
    0
  );

  const manuallyIssuedQtyByPart = {};

  for (const im of issuedMaterials) {
    manuallyIssuedQtyByPart[im.part_id] =
      (manuallyIssuedQtyByPart[im.part_id] || 0) +
      Number(im.qty || 0);
  }

  const issuedQtyByPart = manuallyIssuedQtyByPart;

  const plannedLineIssuedQty = (li) =>
    li.servicem8_material_uuid
      ? Number(li.qty || 0)
      : manuallyIssuedQtyByPart[li.part_id] || 0;

  return (
    <Nav title="Job Detail">
      <div className="p-4 md:p-6">

        {/* HEADER */}
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

          {job.locations && (
            <button
              onClick={() => setIssueModalOpen(true)}
              className="px-3.5 py-2 text-sm rounded bg-orange-500 text-white hover:bg-orange-400 flex items-center gap-1.5"
            >
              <Send size={14} />
              Issue Extra Materials
            </button>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-400 mb-3">
            {error}
          </div>
        )}

        {/* INFO CARDS */}
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
                  Parts Cost
                </div>

                <div className="text-sm text-slate-100">
                  {money(plannedTotal)}
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500">
                  Sales Total
                </div>

                <div className="text-sm text-emerald-400">
                  {money(plannedSaleTotal)}
                </div>
              </div>

            </div>

            <div className="text-[10px] text-slate-600 mt-2">
              Estimated / Service Cost not tracked yet.
            </div>
          </Panel>

        </div>

        {/* TABS */}
        <div className="flex gap-4 border-b border-slate-800 mb-4 text-sm overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
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

        {/* PLANNED */}
        {tab === "planned" && (
          <Panel title="Planned Materials" icon={Package}>
            {(job.job_line_items || []).length === 0 ? (
              <div className="text-sm text-slate-500 p-2">
                No materials planned for this job.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr>
                      <Th>Product</Th>
                      <Th>Code/SKU</Th>
                      <Th className="text-right">Qty</Th>
                      <Th className="text-right">Part Cost</Th>
                      <Th>Source</Th>
                      <Th className="text-right">Issued</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {job.job_line_items.map((li) => (
                      <tr
                        key={li.id}
                        className="border-t border-slate-800/70"
                      >
                        <Td>
                          {li.parts?.part_no || "—"}
                        </Td>

                        <Td className="f-mono text-xs text-slate-400">
                          {li.parts?.sku || "—"}
                        </Td>

                        <Td className="text-right f-mono">
                          {li.qty}
                        </Td>

                        <Td className="text-right f-mono">
                          {money(li.part_cost)}
                        </Td>

                        <Td>
                          {li.servicem8_material_uuid ? (
                            <span className="text-[10px] f-mono uppercase text-sky-400 border border-sky-400/30 rounded px-1.5 py-0.5">
                              ServiceM8 Sync
                            </span>
                          ) : (
                            <span className="text-[10px] f-mono uppercase text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
                              Manual
                            </span>
                          )}
                        </Td>

                        <Td className="text-right f-mono text-emerald-400">
                          {plannedLineIssuedQty(li)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}

        {/* ISSUED */}
        {tab === "issued" &&
          (() => {
            const syncedRows = (job.job_line_items || [])
              .filter((li) => li.servicem8_material_uuid)
              .map((li) => ({
                id: `sync-${li.id}`,
                part_no: li.parts?.part_no,
                sku: li.parts?.sku,
                qty: li.qty,
                unit_cost: li.part_cost,
                when: null,
                source: "sync",
              }));

            const manualRows = issuedMaterials.map((im) => ({
              id: `manual-${im.id}`,
              part_no: im.parts?.part_no,
              sku: im.parts?.sku,
              qty: im.qty,
              unit_cost: im.unit_cost,
              when: im.created_at,
              source: "manual",
            }));

            const allIssued = [
              ...syncedRows,
              ...manualRows,
            ];

            return (
              <Panel title="Issued Materials" icon={FileText}>
                {allIssued.length === 0 ? (
                  <div className="text-sm text-slate-500 p-2">
                    Nothing issued to this job yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[700px]">
                      <thead>
                        <tr>
                          <Th>Product</Th>
                          <Th>Code/SKU</Th>
                          <Th className="text-right">Qty</Th>
                          <Th className="text-right">
                            Unit Cost
                          </Th>
                          <Th className="text-right">
                            Total
                          </Th>
                          <Th>Source</Th>
                          <Th>Issued</Th>
                        </tr>
                      </thead>

                      <tbody>
                        {allIssued.map((row) => (
                          <tr
                            key={row.id}
                            className="border-t border-slate-800/70"
                          >
                            <Td>{row.part_no || "—"}</Td>

                            <Td className="f-mono text-xs text-slate-400">
                              {row.sku || "—"}
                            </Td>

                            <Td className="text-right f-mono text-emerald-400">
                              {row.qty}
                            </Td>

                            <Td className="text-right f-mono">
                              {money(row.unit_cost)}
                            </Td>

                            <Td className="text-right f-mono">
                              {money(
                                Number(row.qty) *
                                  Number(row.unit_cost)
                              )}
                            </Td>

                            <Td>
                              {row.source === "sync" ? (
                                <span className="text-[10px] f-mono uppercase text-sky-400 border border-sky-400/30 rounded px-1.5 py-0.5">
                                  ServiceM8 Sync
                                </span>
                              ) : (
                                <span className="text-[10px] f-mono uppercase text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
                                  Manual
                                </span>
                              )}
                            </Td>

                            <Td className="text-slate-400 text-xs">
                              {row.when
                                ? fmtDateTime(row.when)
                                : "—"}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            );
          })()}

        {/* PURCHASES */}
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
                      <Th className="text-right">Qty</Th>
                      <Th className="text-right">Price</Th>
                      <Th className="text-right">Received</Th>
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

                        <Td>{row.vendor}</Td>

                        <Td>{row.part_no}</Td>

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

        {/* RETURNED */}
        {tab === "returned" && (
          <Panel title="Returned Materials" icon={RotateCcw}>
            <div className="text-sm text-slate-500 p-2">
              Not built yet — this will track materials returned
              from this job back to stock.
            </div>
          </Panel>
        )}

        {/* HISTORY */}
        {tab === "history" && (
          <Panel title="Job History" icon={History}>
            <div className="text-sm text-slate-500 p-2">
              Not built yet — this will show a timeline of
              changes to this job.
            </div>
          </Panel>
        )}
      </div>

      {issueModalOpen && (
        <IssueMaterialsModal
          job={job}
          parts={parts}
          issuedQtyByPart={issuedQtyByPart}
          onClose={() => setIssueModalOpen(false)}
          onIssued={() => {
            setIssueModalOpen(false);
            fetchJob();
          }}
          logActivity={logActivity}
        />
      )}
    </Nav>
  );
}


/*
=============================================================
ISSUE MATERIALS MODAL
=============================================================
*/

function IssueMaterialsModal({
  job,
  parts,
  issuedQtyByPart,
  onClose,
  onIssued,
  logActivity,
}) {
  const plannedRows = (job.job_line_items || [])
    .filter((li) => !li.servicem8_material_uuid)
    .map((li) => ({
      part_id: li.part_id,
      part_no: li.parts?.part_no,
      sku: li.parts?.sku,
      planned: Number(li.qty || 0),
      outstanding: Math.max(
        Number(li.qty || 0) -
          (issuedQtyByPart[li.part_id] || 0),
        0
      ),
      unit_cost: Number(li.part_cost || 0),
    }));

  const [source, setSource] = useState("planned");

  const [rows, setRows] = useState(
    plannedRows
      .filter((r) => r.outstanding > 0)
      .map((r) => ({
        part_id: r.part_id,
        qty: r.outstanding,
        unit_cost: r.unit_cost,
      }))
  );

  const [catalogSearch, setCatalogSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const partById = (id) =>
    parts.find((p) => p.id === id);

  /*
   * =========================================================
   * CATALOG SEARCH
   * =========================================================
   *
   * Search against:
   * - part number
   * - SKU
   * - description
   *
   * This completely bypasses the broken PartPicker.
   */

  const filteredCatalogParts = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();

    if (!q) {
      return parts.slice(0, 30);
    }

    return parts
      .filter((p) => {
        const text = [
          p.part_no,
          p.sku,
          p.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return text.includes(q);
      })
      .slice(0, 30);
  }, [parts, catalogSearch]);

  const updateQty = (partId, qty) => {
    setRows((current) =>
      current.map((r) =>
        r.part_id === partId
          ? {
              ...r,
              qty: Number(qty),
            }
          : r
      )
    );
  };

  const removeRow = (partId) => {
    setRows((current) =>
      current.filter((r) => r.part_id !== partId)
    );
  };

  const addCatalogRow = (partId) => {
    if (!partId) return;

    if (
      rows.some(
        (r) => r.part_id === partId
      )
    ) {
      setCatalogSearch("");
      return;
    }

    const p = partById(partId);

    if (!p) return;

    setRows((current) => [
      ...current,
      {
        part_id: partId,
        qty: 1,
        unit_cost: Number(p.unit_cost || 0),
      },
    ]);

    setCatalogSearch("");
  };

  const submit = async () => {
    const items = rows
      .map((r) => ({
        part_id: r.part_id,
        qty: Number(r.qty || 0),
        unit_cost: Number(r.unit_cost || 0),
      }))
      .filter((r) => r.qty > 0);

    if (items.length === 0) {
      setError(
        "Add at least one item with a quantity to issue."
      );
      return;
    }

    setSaving(true);
    setError("");

    try {
      const { error: rpcErr } =
        await supabase.rpc(
          "issue_job_materials",
          {
            p_job_id: job.id,
            p_items: items,
          }
        );

      if (rpcErr) {
        throw rpcErr;
      }

      await logActivity(
        `Issued ${items.length} material(s) to job ${job.job_no}`
      );

      onIssued();
    } catch (e) {
      setError(
        e?.message ||
          "Could not issue materials — check that there is enough stock at this job's location."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={`Issue Extra Materials — #${job.job_no}`}
      icon={Send}
      onClose={onClose}
      wide
    >
      <div className="text-xs text-slate-500 mb-3">
        For materials that were not automatically issued
        through ServiceM8. This deducts real inventory at{" "}
        <span className="text-slate-300">
          {job.locations?.name ||
            "this job's location"}
        </span>
        .
      </div>

      {error && (
        <div className="text-sm text-red-400 mb-3 border border-red-900/50 bg-red-950/20 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* SOURCE TABS */}
      <div className="flex gap-4 border-b border-slate-800 mb-3 text-sm">
        <button
          type="button"
          onClick={() => setSource("planned")}
          className={`pb-2 px-1 ${
            source === "planned"
              ? "text-orange-400 border-b-2 border-orange-500"
              : "text-slate-500"
          }`}
        >
          From Planned
        </button>

        <button
          type="button"
          onClick={() => setSource("catalog")}
          className={`pb-2 px-1 ${
            source === "catalog"
              ? "text-orange-400 border-b-2 border-orange-500"
              : "text-slate-500"
          }`}
        >
          Add Other Product
        </button>
      </div>

      {/* =====================================================
          CATALOG SEARCH
      ===================================================== */}

      {source === "catalog" && (
        <div className="mb-4">

          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />

            <input
              className={`${inputCls} pl-9 pr-9`}
              value={catalogSearch}
              onChange={(e) =>
                setCatalogSearch(e.target.value)
              }
              placeholder="Search part number, SKU, or description..."
              autoComplete="off"
            />

            {catalogSearch && (
              <button
                type="button"
                onClick={() =>
                  setCatalogSearch("")
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="mt-2 border border-slate-800 rounded overflow-hidden bg-slate-950">

            {filteredCatalogParts.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500">
                No matching parts.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto">
                {filteredCatalogParts.map((p) => {
                  const alreadyAdded =
                    rows.some(
                      (r) => r.part_id === p.id
                    );

                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() =>
                        addCatalogRow(p.id)
                      }
                      className={`w-full text-left px-3 py-2.5 border-b border-slate-800/70 last:border-0 ${
                        alreadyAdded
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:bg-slate-900"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">

                        <div className="min-w-0">
                          <div className="text-sm text-slate-100 truncate">
                            {p.part_no || "—"}
                          </div>

                          <div className="text-xs text-slate-500 f-mono truncate">
                            {p.sku || "NO SKU"}
                            {p.description
                              ? ` · ${p.description}`
                              : ""}
                          </div>
                        </div>

                        <div className="text-xs f-mono text-slate-400 shrink-0">
                          {money(
                            Number(
                              p.unit_cost || 0
                            )
                          )}
                        </div>

                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================
          MATERIAL ROWS
      ===================================================== */}

      <div className="border border-slate-800 rounded">

        <div className="grid grid-cols-[2fr_0.8fr_1fr_auto] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500">
          <span>Product</span>
          <span className="text-right">
            Qty to Issue
          </span>
          <span className="text-right">
            Unit Cost
          </span>
          <span></span>
        </div>

        {rows.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">
            {source === "planned"
              ? "Everything planned has already been fully issued."
              : "No items added yet."}
          </div>
        ) : (
          rows.map((r) => {
            const part = partById(r.part_id);

            return (
              <div
                key={r.part_id}
                className="grid grid-cols-[2fr_0.8fr_1fr_auto] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-sm text-slate-100 truncate">
                    {part?.part_no || "—"}
                  </div>

                  <div className="text-xs f-mono text-slate-500 truncate">
                    {part?.sku || "NO SKU"}
                  </div>
                </div>

                <input
                  type="number"
                  min="0"
                  step="1"
                  className={inputCls}
                  value={r.qty}
                  onChange={(e) =>
                    updateQty(
                      r.part_id,
                      e.target.value
                    )
                  }
                />

                <div className="text-right f-mono text-sm text-slate-400">
                  {money(r.unit_cost)}
                </div>

                <IconBtn
                  danger
                  onClick={() =>
                    removeRow(r.part_id)
                  }
                  title="Remove"
                >
                  <X size={13} />
                </IconBtn>
              </div>
            );
          })
        )}
      </div>

      {/* FOOTER */}
      <div className="flex justify-end gap-2 mt-4">

        <button
          type="button"
          onClick={onClose}
          className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
        >
          Cancel
        </button>

        <PrimaryBtn
          onClick={submit}
          className={
            saving
              ? "opacity-60 pointer-events-none"
              : ""
          }
        >
          <Check size={15} />

          {saving
            ? "Issuing..."
            : "Issue Materials"}
        </PrimaryBtn>

      </div>
    </ModalShell>
  );
}