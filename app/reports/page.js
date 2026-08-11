"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Box,
  DollarSign,
  FileText,
  ShoppingCart,
  BarChart3,
  ClipboardCheck,
  ArrowLeftRight,
} from "lucide-react";

import Nav from "@/components/Nav";

const reports = [
  {
    title: "REORDER REPORT",
    description: "View parts that are at or below their reorder level",
    href: "/reports/reorder",
    icon: AlertTriangle,
  },
  {
    title: "INVENTORY ON HAND",
    description: "View current stock levels and availability",
    href: "/reports/inventory-on-hand",
    icon: Box,
  },
  {
    title: "INVENTORY VALUATION REPORT",
    description: "Analyze total inventory value and cost breakdown",
    href: "/reports/inventory-valuation",
    icon: DollarSign,
  },
  {
    title: "JOB COST REPORT",
    description: "Track project costs and profitability",
    href: "/reports/job-cost",
    icon: FileText,
  },
  {
    title: "PURCHASE REPORT",
    description: "Monitor purchasing patterns and supplier performance",
    href: "/reports/purchase",
    icon: ShoppingCart,
  },
  {
    title: "MATERIAL CONSUMPTION REPORT",
    description: "Review material usage and consumption analytics",
    href: "/reports/material-consumption",
    icon: BarChart3,
  },
  {
    title: "CYCLE COUNT REPORT",
    description: "Track inventory accuracy and variance analysis",
    href: "/reports/cycle-count",
    icon: ClipboardCheck,
  },
  {
    title: "STOCK MOVEMENT SUMMARY",
    description:
      "Analyze inbound vs outbound stock movements, net quantities and costs by product",
    href: "/reports/stock-movement",
    icon: ArrowLeftRight,
  },
];

export default function ReportsPage() {
  return (
    <Nav title="Reports">
      <div className="min-h-full bg-slate-950 p-4 md:p-6">

        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold tracking-wide text-slate-100">
            REPORTS
          </h1>

          <p className="mt-1 text-xs text-slate-500">
            Select a report to view detailed inventory and operational data.
          </p>
        </div>

        {/* Reports Grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((report) => {
            const Icon = report.icon;

            return (
              <Link
                key={report.title}
                href={report.href}
                className="group block"
              >
                <div className="h-full rounded-lg border border-slate-800 bg-slate-900/40 p-5 transition-all duration-150 hover:border-slate-600 hover:bg-slate-900/80">

                  {/* Icon */}
                  <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md border border-orange-500/30 bg-orange-500/5">
                    <Icon
                      size={18}
                      strokeWidth={1.8}
                      className="text-orange-400"
                    />
                  </div>

                  {/* Title */}
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="text-sm font-medium tracking-wide text-slate-100">
                      {report.title}
                    </h2>

                    <span className="mt-0.5 text-sm text-slate-600 transition-transform duration-150 group-hover:translate-x-1 group-hover:text-orange-400">
                      →
                    </span>
                  </div>

                  {/* Description */}
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {report.description}
                  </p>

                  {/* Open indicator */}
                  <div className="mt-5 text-[10px] font-medium uppercase tracking-widest text-slate-600 group-hover:text-orange-400">
                    Open Report
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </Nav>
  );
}