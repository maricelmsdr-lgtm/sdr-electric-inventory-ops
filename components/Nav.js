"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Zap, LayoutDashboard, Briefcase, Package, Truck, Warehouse, ShoppingCart,
  ArrowLeftRight, ClipboardList, SlidersHorizontal, ListChecks,
  PackagePlus, History, LogOut, BarChart3, ScanLine, Plug,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/parts", label: "Parts", icon: Package },
  { href: "/fleet", label: "Fleet", icon: Truck },
  { href: "/locations", label: "Locations", icon: Warehouse },
  { href: "/purchase-orders", label: "POs", icon: ShoppingCart },
  { href: "/loadouts", label: "Load Out", icon: ArrowLeftRight },
  { href: "/field-requests", label: "Field Req", icon: ClipboardList },
  { href: "/stock-adjustments", label: "Adjust", icon: SlidersHorizontal },
  { href: "/cycle-counts", label: "Cycle Count", icon: ListChecks },
  { href: "/stock-in", label: "Stock In", icon: PackagePlus },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/scanner", label: "Scanner", icon: ScanLine },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/activity", label: "Activity", icon: History },
];

export default function Nav({ right }) {
  const pathname = usePathname();
  const router = useRouter();

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="h-16 border-b border-slate-800 flex items-center justify-between gap-3 px-4 md:px-6 bg-slate-950/80 sticky top-0 z-20">
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-8 h-8 rounded bg-orange-600 flex items-center justify-center">
          <Zap size={16} className="text-white" />
        </div>
        <h2 className="f-display uppercase text-lg text-slate-100 tracking-wide hidden lg:block">
          SDR Electric
        </h2>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 min-w-0">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs f-display uppercase tracking-wide whitespace-nowrap transition-colors border shrink-0 ${
                active
                  ? "bg-orange-600/15 text-orange-400 border-orange-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border-transparent"
              }`}
            >
              <Icon size={14} />
              <span className="hidden xl:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-3 shrink-0">
        {right}
        <button onClick={signOut} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-red-400">
          <LogOut size={15} />
          <span className="hidden sm:inline">Log Out</span>
        </button>
      </div>
    </div>
  );
}
