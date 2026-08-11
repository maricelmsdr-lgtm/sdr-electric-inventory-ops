"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, Badge, money } from "@/components/ui";

const fmtDate = (d) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString()
    : "NA";

const STATUS_STYLES = {
  Open: "border-slate-600 text-slate-400",
  Ordered: "border-sky-400/30 text-sky-400",
  Received: "border-emerald-400/30 text-emerald-400",
  Cancelled: "border-red-400/30 text-red-400",
};

const TABS = [
  {
    key: "planned",
    label: "Planned Materials",
    icon: Package,
  },
  {
    key: "issued",
    label: "Issued Materials",
    icon: FileText,
  },
  {
    key: "purchases",
    label: "Purchases",
    icon: Truck,
  },
  {
    key: "returned",
    label: "Returned Materials",
    icon: RotateCcw,
  },
  {
    key: "history",
    label: "Job History",
    icon: History,
  },
];

export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams();
  const jobId = params?.id;

  const [orgId, setOrgId] = useState(null);
  const [job, setJob] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [issuedMaterials, setIssuedMaterials] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [tab, setTab] = useState("planned");

  useEffect(() => {
    let mounted = true;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (!mounted) return;

      if (profileErr) {
        setError(profileErr.message);
        setLoading(false);
        return;
      }

      setOrgId(profile?.org_id || null);
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!orgId || !jobId) return;

    fetchJob();
  }, [orgId, jobId]);

  const fetchJob = async () => {
    setLoading(true);
    setError("");
    setSuccess("");

    const [
      { data: jobData, error: jobErr },
      { data: poData, error: poErr },
      { data: issuedData, error: issuedErr },
    ] = await Promise.all([
      /*
       * IMPORTANT:
       *
       * part_cost and sale_cost belong to job_line_items.
       * They do NOT belong to parts.
       *
       * parts only supplies:
       * id, part_no, sku, description, qty, unit_cost
       */
      supabase
        .from("jobs")
        .select(`
          *,
          job_line_items(
            *,
            parts(
              id,
              part_no,
              sku,
              description,
              qty,
              unit_cost
            )
          )
        `)
        .eq("id", jobId)
        .eq("org_id", orgId)
        .single(),

      supabase
        .from("purchase_orders")
        .select(`
          *,
          po_line_items(
            *,
            parts(
              part_no,
              sku
            )
          )
        `)
        .eq("job_id", jobId)
        .eq("org_id", orgId)
        .order("po_date", { ascending: false }),

      supabase
        .from("job_issued_materials")
        .select(`
          *,
          parts(
            id,
            part_no,
            sku,
            description
          )
        `)
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
   * =========================================================
   * PURCHASE ROWS
   * =========================================================
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
      qty: Number(li.qty || 0),
      unit_cost: Number(li.unit_cost || 0),
      received: po.status === "Received" ? Number(li.qty || 0) : 0,
    }))
  );

  /*
   * =========================================================
   * LOADING / ERROR STATE
   * =========================================================
   */

  if (loading) {
    return (
      <Nav title="Job Detail">
        <div className="p-6 text-sm text-slate-500 f-mono uppercase tracking-widest">
          Loading...
        </div>
      </Nav>
    );
  }

  if (!job) {
    return (
      <Nav title="Job Detail">
        <div className="p-6">
          <div className="text-sm text-red-400">
            {error || "Job not found."}
          </div>

          <button
            onClick={() => router.push("/jobs")}
            className="mt-4 inline-flex items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            <ArrowLeft size={15} />
            Back to Jobs
          </button>
        </div>
      </Nav>
    );
  }

  /*
   * =========================================================
   * JOB TOTALS
   * =========================================================
   *
   * These values come from job_line_items.
   *
   * job_line_items.part_cost
   * job_line_items.sale_cost
   */

  const plannedTotal = (job.job_line_items || []).reduce(
    (sum, li) =>
      sum +
      Number(li.qty || 0) *
        Number(li.part_cost || 0),
    0
  );

  const plannedSaleTotal = (job.job_line_items || []).reduce(
    (sum, li) =>
      sum +
      Number(li.qty || 0) *
        Number(li.sale_cost || 0),
    0
  );

  const issuedTotal = issuedMaterials.reduce(
    (sum, item) =>
      sum +
      Number(item.qty || 0) *
        Number(item.unit_cost || 0),
    0
  );

  return (
    <Nav title="Job Detail">
      <div className="p-4 md:p-6">

        {/* =================================================
            HEADER
        ================================================= */}

        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3">

            <button
              onClick={() => router.push("/jobs")}
              className="p-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
              title="Back to Jobs"
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

        {error && (
          <div className="text-sm text-red-400 mb-3">
            {error}
          </div>
        )}

        {success && (
          <div className="text-sm text-emerald-400 mb-3">
            {success}
          </div>
        )}

        {/* =================================================
            INFO CARDS
        ================================================= */}

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

        {/* =================================================
            TABS
        ================================================= */}

        <div className="flex gap-4 border-b border-slate-800 mb-4 text-sm overflow-x-auto">

          {TABS.map((t) => {
            const Icon = t.icon;

            return (
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
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}

        </div>

        {/* =================================================
            PLANNED MATERIALS
        ================================================= */}

        {tab === "planned" && (
          <Panel
            title="Planned Materials"
            icon={Package}
          >

            {(job.job_line_items || []).length === 0 ? (

              <div className="text-sm text-slate-500 p-2">
                No materials planned for this job.
              </div>

            ) : (

              <div className="overflow-x-auto">

                <table className="w-full min-w-[700px]">

                  <thead>
                    <tr>
                      <Th>Product</Th>
                      <Th>Code/SKU</Th>
                      <Th className="text-right">
                        Qty
                      </Th>
                      <Th className="text-right">
                        Part Cost
                      </Th>
                      <Th className="text-right">
                        Sale Cost
                      </Th>
                      <Th className="text-right">
                        Extended Cost
                      </Th>
                    </tr>
                  </thead>

                  <tbody>

                    {job.job_line_items.map((li) => {

                      const qty = Number(li.qty || 0);
                      const partCost = Number(
                        li.part_cost || 0
                      );
                      const saleCost = Number(
                        li.sale_cost || 0
                      );

                      return (
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
                            {qty}
                          </Td>

                          <Td className="text-right f-mono">
                            {money(partCost)}
                          </Td>

                          <Td className="text-right f-mono text-emerald-400">
                            {money(saleCost)}
                          </Td>

                          <Td className="text-right f-mono">
                            {money(qty * partCost)}
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

        {/* =================================================
            ISSUED MATERIALS
        ================================================= */}

        {tab === "issued" && (
          <Panel
            title="Issued Materials"
            icon={FileText}
          >

            <div className="flex items-center justify-between mb-4">

              <div>
                <div className="text-xs text-slate-500">
                  Total Issued Cost
                </div>

                <div className="text-lg font-medium text-emerald-400 f-mono">
                  {money(issuedTotal)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs text-slate-500">
                  Items Issued
                </div>

                <div className="text-lg font-medium text-slate-100 f-mono">
                  {issuedMaterials.length}
                </div>
              </div>

            </div>

            {issuedMaterials.length === 0 ? (

              <div className="text-sm text-slate-500 p-2">
                No materials have been issued to this job yet.
              </div>

            ) : (

              <div className="overflow-x-auto">

                <table className="w-full min-w-[750px]">

                  <thead>
                    <tr>
                      <Th>Product</Th>
                      <Th>Code/SKU</Th>
                      <Th className="text-right">
                        Qty Issued
                      </Th>
                      <Th className="text-right">
                        Unit Cost
                      </Th>
                      <Th className="text-right">
                        Total Cost
                      </Th>
                      <Th>Issued By</Th>
                      <Th>Date</Th>
                    </tr>
                  </thead>

                  <tbody>

                    {issuedMaterials.map((item) => {

                      const qty = Number(
                        item.qty || 0
                      );

                      const unitCost = Number(
                        item.unit_cost || 0
                      );

                      const totalCost =
                        qty * unitCost;

                      return (
                        <tr
                          key={item.id}
                          className="border-t border-slate-800/70"
                        >

                          <Td>
                            {item.parts?.part_no || "—"}
                          </Td>

                          <Td className="f-mono text-xs text-slate-400">
                            {item.parts?.sku || "—"}
                          </Td>

                          <Td className="text-right f-mono text-orange-400">
                            {qty}
                          </Td>

                          <Td className="text-right f-mono">
                            {money(unitCost)}
                          </Td>

                          <Td className="text-right f-mono text-emerald-400">
                            {money(totalCost)}
                          </Td>

                          <Td className="text-slate-400">
                            {item.issued_by || "—"}
                          </Td>

                          <Td className="text-slate-400">
                            {item.issued_at
                              ? new Date(
                                  item.issued_at
                                ).toLocaleDateString()
                              : "—"}
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

        {/* =================================================
            PURCHASES
        ================================================= */}

        {tab === "purchases" && (
          <Panel
            title="Purchases"
            icon={Truck}
          >

            {purchaseRows.length === 0 ? (

              <div className="text-sm text-slate-500 p-2">
                No purchase orders linked to this job yet.
              </div>

            ) : (

              <div className="overflow-x-auto">

                <table className="w-full min-w-[900px]">

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
                              STATUS_STYLES[
                                row.status
                              ] ||
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

        {/* =================================================
            RETURNED MATERIALS
        ================================================= */}

        {tab === "returned" && (
          <Panel
            title="Returned Materials"
            icon={RotateCcw}
          >

            <div className="text-sm text-slate-500 p-2">
              No returned-material workflow is currently
              connected to this Job Detail page.
            </div>

          </Panel>
        )}

        {/* =================================================
            JOB HISTORY
        ================================================= */}

        {tab === "history" && (
          <Panel
            title="Job History"
            icon={History}
          >

            <div className="text-sm text-slate-500 p-2">
              Job history timeline is not currently
              connected to this Job Detail page.
            </div>

          </Panel>
        )}

      </div>
    </Nav>
  );
}