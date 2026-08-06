"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Zap, LayoutDashboard, Briefcase, Package, Truck, Warehouse, ShoppingCart,
  ArrowLeftRight, ClipboardList, SlidersHorizontal, ListChecks,
  PackagePlus, History, LogOut, BarChart3, ScanLine, Plug, Menu, X, RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Inventory",
    items: [
      { href: "/parts", label: "Parts", icon: Package },
      { href: "/locations", label: "Locations", icon: Warehouse },
      { href: "/fleet", label: "Fleet", icon: Truck },
      { href: "/stock-in", label: "Stock In", icon: PackagePlus },
      { href: "/stock-adjustments", label: "Adjust", icon: SlidersHorizontal },
      { href: "/cycle-counts", label: "Cycle Count", icon: ListChecks },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/jobs", label: "Jobs", icon: Briefcase },
      { href: "/purchase-orders", label: "Purchase Orders", icon: ShoppingCart },
      { href: "/loadouts", label: "Load Out", icon: ArrowLeftRight },
      { href: "/field-requests", label: "Field Requests", icon: ClipboardList },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/scanner", label: "Scanner", icon: ScanLine },
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/sync-history", label: "Sync History", icon: RefreshCw },
      { href: "/activity", label: "Activity", icon: History },
    ],
  },
];

function Brand() {
  return (
    <div className="flex items-center gap-2 px-4 h-16 border-b border-slate-800 shrink-0">
      <div className="w-8 h-8 rounded bg-orange-600 flex items-center justify-center shrink-0">
        <Zap size={16} className="text-white" />
      </div>
      <div>
        <div className="f-display uppercase text-sm leading-none text-slate-100 tracking-wide">SDR Electric</div>
        <div className="text-[10px] f-mono text-slate-500 uppercase tracking-widest">Inventory Ops</div>
      </div>
    </div>
  );
}

function SidebarLinks({ pathname, onNavigate }) {
  return (
    <nav className="flex-1 overflow-y-auto py-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="text-[10px] f-mono uppercase tracking-widest text-slate-600 px-4 pt-3 pb-1">
            {group.label}
          </div>
          {group.items.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={`flex items-center gap-2.5 px-4 py-2 text-sm transition-colors border-l-2 ${
                  active
                    ? "bg-orange-600/10 border-orange-500 text-orange-400"
                    : "border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`}
              >
                <Icon size={15} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export default function Nav({ title, right, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-slate-950 f-body flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 bg-slate-950 border-r border-slate-800 flex-col">
        <Brand />
        <SidebarLinks pathname={pathname} />
        <div className="border-t border-slate-800 p-3">
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-2 py-2 text-sm text-slate-500 hover:text-red-400 transition-colors"
          >
            <LogOut size={15} /> Log Out
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-950 border-r border-slate-800 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 h-16 px-4">
              <Brand />
              <button onClick={() => setDrawerOpen(false)} className="text-slate-500 hover:text-slate-200 shrink-0 ml-2">
                <X size={20} />
              </button>
            </div>
            <SidebarLinks pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            <div className="border-t border-slate-800 p-3">
              <button
                onClick={signOut}
                className="w-full flex items-center gap-2 px-2 py-2 text-sm text-slate-500 hover:text-red-400 transition-colors"
              >
                <LogOut size={15} /> Log Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-16 border-b border-slate-800 flex items-center justify-between gap-3 px-4 md:px-6 bg-slate-950/80 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setDrawerOpen(true)} className="md:hidden text-slate-400 shrink-0">
              <Menu size={20} />
            </button>
            <h1 className="f-display uppercase text-base md:text-lg text-slate-100 tracking-wide truncate">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-3 shrink-0">{right}</div>
        </div>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
