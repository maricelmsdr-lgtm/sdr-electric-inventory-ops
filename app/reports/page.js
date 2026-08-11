"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  BarChart3,
  Briefcase,
  AlertTriangle,
  Package,
  DollarSign,
  FileBarChart,
  ShoppingCart,
  ClipboardCheck,
  ArrowLeftRight,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel,
  Gauge,
  money,
  TRADE_STYLES,
} from "@/components/ui";

const CATEGORIES = [
  "Electrical",
  "Plumbing",
  "HVAC",
  "General",
];

const MORE_REPORTS = [
  {
    href: "/reports/reorder",
    icon: AlertTriangle,
    title: "Reorder Report",
    description:
      "View parts that are at or below their reorder level",
  },
  {
    href: "/reports/inventory-on-hand",
    icon: Package,
    title: "Inventory On Hand",
    description:
      "View current stock levels and availability",
  },
  {
    href: "/reports/inventory-valuation",
    icon: DollarSign,
    title: "Inventory Valuation Report",
    description:
      "Analyze total inventory value and cost breakdown",
  },
  {
    href: "/reports/job-cost",
    icon: FileBarChart,
    title: "Job Cost Report",
    description:
      "Track project costs and profitability",
  },
  {
    href: "/reports/purchases",
    icon: ShoppingCart,
    title: "Purchase Report",
    description:
      "Monitor purchasing patterns and supplier performance",
  },
  {
    href: "/reports/material-consumption",
    icon: BarChart3,
    title: "Material Consumption Report",
    description:
      "Review material usage and consumption analytics",
  },
  {
    href: "/reports/cycle-count",
    icon: ClipboardCheck,
    title: "Cycle Count Report",
    description:
      "Track inventory accuracy and variance analysis",
  },
  {
    href: "/reports/stock-movement",
    icon: ArrowLeftRight,
    title: "Stock Movement Summary",
    description:
      "Analyze inbound vs outbound stock movements, net quantities and costs by product",
  },
];

export default function ReportsPage() {
  const router = useRouter();

  const [orgId, setOrgId] = useState(null);
  const [parts, setParts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ------------------------------------------------------------
  // Authentication / organization
  // ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadOrganization() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile, error: profileError } =
        await supabase
          .from("profiles")
          .select("org_id")
          .eq("id", user.id)
          .single();

      if (cancelled) return;

      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }

      setOrgId(profile?.org_id || null);
    }

    loadOrganization();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // ------------------------------------------------------------
  // Load report data
  // ------------------------------------------------------------
  useEffect(() => {
    if (!orgId) return;

    let cancelled = false;

    async function loadReports() {
      setLoading(true);
      setError("");

      const [
        { data: partsData, error: partsErr },
        { data: jobsData, error: jobsErr },
      ] = await Promise.all([
        supabase
          .from("parts")
          .select("*")
          .eq("org_id", orgId),

        supabase
          .from("jobs")
          .select("*, job_line_items(*)")
          .eq("org_id", orgId),
      ]);

      if (cancelled) return;

      setError(
        partsErr?.message ||
          jobsErr?.message ||
          ""
      );

      setParts(partsData || []);
      setJobs(jobsData || []);
      setLoading(false);
    }

    loadReports();

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // ------------------------------------------------------------
  // Inventory value by trade
  // ------------------------------------------------------------
  const byCategory = CATEGORIES
    .map((cat) => ({
      cat,
      value: parts
        .filter((p) => p.category === cat)
        .reduce(
          (sum, p) =>
            sum +
            Number(p.qty || 0) *
              Number(p.unit_cost || 0),
          0
        ),
    }))
    .filter((c) => c.value > 0);

  const maxVal = Math.max(
    ...byCategory.map((c) => c.value),
    1
  );

  // ------------------------------------------------------------
  // Job profitability
  // ------------------------------------------------------------
  const jobsSales = jobs.reduce(
    (sum, job) =>
      sum +
      (job.job_line_items || []).reduce(
        (lineSum, li) =>
          lineSum +
          Number(li.qty || 0) *
            Number(li.sale_cost || 0),
        0
      ),
    0
  );

  const jobsCost = jobs.reduce(
    (sum, job) =>
      sum +
      (job.job_line_items || []).reduce(
        (lineSum, li) =>
          lineSum +
          Number(li.qty || 0) *
            Number(li.part_cost || 0),
        0
      ),
    0
  );

  // ------------------------------------------------------------
  // Loading screen
  // ------------------------------------------------------------
  if (!orgId) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="font-mono text-xs text-slate-500 uppercase tracking-widest">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <Nav title="Reports">
      <div className="p-4 md:p-6 space-y-4">

        {/* Error */}
        {error && (
          <div className="text-sm text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-slate-500">
            Loading reports...
          </div>
        ) : (
          <>
            {/* ==================================================
                EXISTING ANALYTICS
            ================================================== */}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Inventory Value by Trade */}
              <Panel
                title="Inventory Value by Trade"
                icon={BarChart3}
              >
                <div className="space-y-3">

                  {byCategory.map((c) => {
                    const s =
                      TRADE_STYLES[c.cat] ||
                      TRADE_STYLES.General;

                    return (
                      <div key={c.cat}>

                        <div className="flex justify-between text-xs font-mono text-slate-400 mb-1">
                          <span>{c.cat}</span>

                          <span>
                            {money(c.value)}
                          </span>
                        </div>

                        <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${s.dot}`}
                            style={{
                              width: `${
                                (c.value / maxVal) *
                                100
                              }%`,
                            }}
                          />
                        </div>

                      </div>
                    );
                  })}

                  {byCategory.length === 0 && (
                    <div className="text-sm text-slate-500">
                      No inventory value yet.
                    </div>
                  )}

                </div>
              </Panel>

              {/* Job Profitability */}
              <Panel
                title="Job Profitability"
                icon={Briefcase}
              >
                <div className="flex items-center justify-around py-3">

                  <Gauge
                    value={Math.round(jobsCost)}
                    max={Math.max(
                      jobsSales,
                      100
                    )}
                    label="Parts Cost"
                    color="#f97316"
                  />

                  <Gauge
                    value={Math.round(jobsSales)}
                    max={Math.max(
                      jobsSales,
                      100
                    )}
                    label="Sales Total"
                    color="#34d399"
                  />

                </div>

                <div className="text-center text-sm text-slate-400 mt-1">
                  Margin:{" "}

                  <b className="text-emerald-400">
                    {money(
                      jobsSales - jobsCost
                    )}
                  </b>{" "}

                  (
                  {jobsSales
                    ? Math.round(
                        ((jobsSales -
                          jobsCost) /
                          jobsSales) *
                          100
                      )
                    : 0}
                  %)
                </div>
              </Panel>

            </div>

            {/* ==================================================
                MORE REPORTS
            ================================================== */}

            <div>

              <div className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mb-3 mt-2">
                More Reports
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

                {MORE_REPORTS.map((report) => {
                  const Icon = report.icon;

                  return (
                    <Link
                      key={report.href}
                      href={report.href}
                      className="group border border-slate-800 rounded-lg bg-slate-900/40 hover:border-orange-600/50 hover:bg-slate-900 transition-colors overflow-hidden flex flex-col"
                    >

                      <div className="p-5 flex items-start justify-between">

                        <div className="w-10 h-10 rounded bg-orange-600/10 border border-orange-600/20 flex items-center justify-center group-hover:bg-orange-600/20 transition-colors">

                          <Icon
                            size={18}
                            className="text-orange-400"
                          />

                        </div>

                        <span className="text-slate-700 group-hover:text-orange-400 transition-colors text-lg">
                          →
                        </span>

                      </div>

                      <div className="px-5 pb-5 flex-1">

                        <h3 className="font-medium uppercase text-sm text-slate-100 tracking-wide mb-1.5">
                          {report.title}
                        </h3>

                        <p className="text-xs text-slate-500 leading-relaxed">
                          {report.description}
                        </p>

                      </div>

                      <div className="px-5 pb-4 text-[10px] font-mono uppercase tracking-widest text-slate-700 group-hover:text-orange-400 transition-colors">
                        Open Report
                      </div>

                    </Link>
                  );
                })}

              </div>
            </div>
          </>
        )}

      </div>
    </Nav>
  );
}