"use client";

import Link from "next/link";
import {
  Package,
  DollarSign,
  FileBarChart,
  ShoppingCart,
  BarChart3,
  ClipboardCheck,
  ArrowLeftRight,
} from "lucide-react";
import Nav from "@/components/Nav";

// ASSUMPTION: these hrefs are placeholders — adjust to match your real
// report routes (or tell me what they should be and I'll wire them up).
const REPORTS = [
  {
    href: "/reports/inventory-on-hand",
    icon: Package,
    title: "Inventory On Hand",
    description: "View current stock levels and availability",
  },
  {
    href: "/reports/inventory-valuation",
    icon: DollarSign,
    title: "Inventory Valuation Report",
    description: "Analyze total inventory value and cost breakdown",
  },
  {
    href: "/reports/job-cost",
    icon: FileBarChart,
    title: "Job Cost Report",
    description: "Track project costs and profitability",
  },
  {
    href: "/reports/purchases",
    icon: ShoppingCart,
    title: "Purchase Report",
    description: "Monitor purchasing patterns and supplier performance",
  },
  {
    href: "/reports/material-consumption",
    icon: BarChart3,
    title: "Material Consumption Report",
    description: "Review material usage and consumption analytics",
  },
  {
    href: "/reports/cycle-count",
    icon: ClipboardCheck,
    title: "Cycle Count Report",
    description: "Track inventory accuracy and variance analysis",
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
  return (
    <Nav title="Reports">
      <div className="p-4 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORTS.map((report) => {
            const Icon = report.icon;
            return (
              <Link
                key={report.href}
                href={report.href}
                className="group border border-slate-800 rounded-lg bg-slate-900/40 hover:border-orange-600/50 hover:bg-slate-900 transition-colors overflow-hidden flex flex-col"
              >
                <div className="p-5 flex items-start justify-between">
                  <div className="w-10 h-10 rounded bg-orange-600/10 border border-orange-600/20 flex items-center justify-center group-hover:bg-orange-600/20 transition-colors">
                    <Icon size={18} className="text-orange-400" />
                  </div>
                </div>
                <div className="px-5 pb-5 flex-1">
                  <h3 className="f-display uppercase text-sm text-slate-100 tracking-wide mb-1.5">
                    {report.title}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {report.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </Nav>
  );
}