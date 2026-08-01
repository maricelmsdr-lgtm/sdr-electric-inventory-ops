import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Briefcase, Package, ShoppingCart, ArrowLeftRight,
  ClipboardList, Truck, BarChart3, SlidersHorizontal, Plug, History,
  ListChecks, PackagePlus, ScanLine, LogOut, Search, Plus, Pencil,
  Trash2, X, AlertTriangle, Zap, Droplets, Wind, ChevronRight, Check,
  MapPin, User, Building2, Menu
} from "lucide-react";

/* ---------------------------------- THEME BITS ---------------------------------- */
const FontStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    .f-display{font-family:'Barlow Condensed',sans-serif;letter-spacing:0.01em;}
    .f-body{font-family:'Inter',sans-serif;}
    .f-mono{font-family:'IBM Plex Mono',monospace;}
    .bp-grid{
      background-image:
        linear-gradient(rgba(56,189,248,0.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(56,189,248,0.06) 1px, transparent 1px);
      background-size: 26px 26px;
    }
    .rivet::before{content:'';position:absolute;top:8px;left:8px;width:5px;height:5px;border-radius:9999px;background:rgba(255,255,255,0.12);}
    .rivet::after{content:'';position:absolute;top:8px;right:8px;width:5px;height:5px;border-radius:9999px;background:rgba(255,255,255,0.12);}
    ::-webkit-scrollbar{width:8px;height:8px;}
    ::-webkit-scrollbar-track{background:#0f172a;}
    ::-webkit-scrollbar-thumb{background:#334155;border-radius:4px;}
  `}</style>
);

const TRADE_STYLES = {
  Electrical: { text: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/30", dot: "bg-amber-400", icon: Zap },
  Plumbing:   { text: "text-sky-400",   bg: "bg-sky-400/10",   border: "border-sky-400/30",   dot: "bg-sky-400",   icon: Droplets },
  HVAC:       { text: "text-orange-500",bg: "bg-orange-500/10",border: "border-orange-500/30",dot: "bg-orange-500",icon: Wind },
  General:    { text: "text-slate-300", bg: "bg-slate-400/10", border: "border-slate-400/30", dot: "bg-slate-400", icon: Package },
};

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const nextId = (arr) => (arr.length ? Math.max(...arr.map((x) => x.id)) + 1 : 1);

/* ---------------------------------- SEED DATA ---------------------------------- */
const seedParts = [
  { id: 1, partNo: "PN-1001", sku: "EL-BRK-15A", category: "Electrical", location: "Warehouse A1", qty: 84, minReorder: 20, unitCost: 6.25, desc: "15A Circuit Breaker" },
  { id: 2, partNo: "PN-1002", sku: "EL-WIRE-12G", category: "Electrical", location: "Warehouse A2", qty: 12, minReorder: 25, unitCost: 0.85, desc: "12 AWG Romex Wire (ft)" },
  { id: 3, partNo: "PN-1003", sku: "PL-CPR-34", category: "Plumbing", location: "Warehouse B1", qty: 45, minReorder: 15, unitCost: 3.10, desc: "3/4in Copper Fitting" },
  { id: 4, partNo: "PN-1004", sku: "PL-PVC-ELB", category: "Plumbing", location: "Warehouse B2", qty: 8, minReorder: 20, unitCost: 1.20, desc: "PVC Elbow 90°" },
  { id: 5, partNo: "PN-1005", sku: "HV-CAP-45", category: "HVAC", location: "Warehouse C1", qty: 30, minReorder: 10, unitCost: 14.75, desc: "45/5 Dual Run Capacitor" },
  { id: 6, partNo: "PN-1006", sku: "HV-FLTR-16", category: "HVAC", location: "Warehouse C1", qty: 5, minReorder: 12, unitCost: 9.40, desc: "16x20 Furnace Filter" },
  { id: 7, partNo: "PN-1007", sku: "EL-OUT-GFCI", category: "Electrical", location: "Warehouse A1", qty: 60, minReorder: 15, unitCost: 4.50, desc: "GFCI Outlet" },
  { id: 8, partNo: "PN-1008", sku: "PL-VLV-1IN", category: "Plumbing", location: "Warehouse B3", qty: 22, minReorder: 10, unitCost: 8.90, desc: "1in Shutoff Valve" },
];

const seedFleet = [
  { id: 1, truckNumber: "T-01", nickname: "Sparky", driver: "Dan R.", plate: "SDR-101", homeBase: "Main Yard", status: "Active" },
  { id: 2, truckNumber: "T-02", nickname: "Big Blue", driver: "Marco T.", plate: "SDR-102", homeBase: "Main Yard", status: "Active" },
  { id: 3, truckNumber: "T-03", nickname: "The Wrench", driver: "Priya S.", plate: "SDR-103", homeBase: "North Depot", status: "Active" },
  { id: 4, truckNumber: "T-04", nickname: "Ol' Reliable", driver: "Unassigned", plate: "SDR-104", homeBase: "Main Yard", status: "In Shop" },
];

const seedJobs = [
  { id: 1, jobNo: "JOB-1198", client: "R. Simmons", address: "48 Birchwood Ave, Nassau, NY", date: "2026-07-22", technician: "Dan R.",
    lineItems: [{ partId: 2, qty: 40, partCost: 0.85, saleCost: 2.10 }, { partId: 1, qty: 1, partCost: 6.25, saleCost: 18.00 }] },
  { id: 2, jobNo: "JOB-1199", client: "Nassau Diner", address: "220 Front St, Hempstead, NY", date: "2026-07-24", technician: "Priya S.",
    lineItems: [{ partId: 6, qty: 2, partCost: 9.40, saleCost: 24.00 }, { partId: 5, qty: 1, partCost: 14.75, saleCost: 39.00 }] },
  { id: 3, jobNo: "JOB-1200", client: "K. Alvarez", address: "12 Maple Ct, Garden City, NY", date: "2026-07-27", technician: "Marco T.",
    lineItems: [{ partId: 4, qty: 6, partCost: 1.20, saleCost: 3.50 }, { partId: 8, qty: 1, partCost: 8.90, saleCost: 22.00 }] },
];

const seedPOs = [
  { id: 1, poNo: "PO-3041", vendor: "Northeast Electrical Supply", date: "2026-07-18", status: "Received",
    lineItems: [{ partId: 2, qty: 100, unitCost: 0.80 }, { partId: 7, qty: 25, unitCost: 4.10 }] },
  { id: 2, poNo: "PO-3042", vendor: "Ferguson Plumbing Supply", date: "2026-07-26", status: "Ordered",
    lineItems: [{ partId: 4, qty: 40, unitCost: 1.10 }] },
  { id: 3, poNo: "PO-3043", vendor: "Climate Parts Direct", date: "2026-07-29", status: "Ordered",
    lineItems: [{ partId: 6, qty: 24, unitCost: 8.90 }, { partId: 5, qty: 10, unitCost: 13.50 }] },
];

const seedLoadouts = [
  { id: 1, date: "2026-07-22", truckId: 1, direction: "Load Out", jobRef: "", technician: "Dan R.", lineItems: [{ partId: 2, qty: 50 }, { partId: 1, qty: 4 }] },
  { id: 2, date: "2026-07-24", truckId: 3, direction: "Used on Job", jobRef: "JOB-1199", technician: "Priya S.", lineItems: [{ partId: 6, qty: 2 }] },
];

const seedFieldRequests = [
  { id: 1, requestedBy: "Marco T.", truck: "T-02", part: 4, qtyRequested: 20, priority: "Urgent", status: "Pending", notes: "Running low for tomorrow's job." },
  { id: 2, requestedBy: "Priya S.", truck: "T-03", part: 6, qtyRequested: 10, priority: "Normal", status: "Approved", notes: "" },
];

const seedAdjustments = [
  { id: 1, date: "2026-07-20", part: 2, qtyChange: -3, reason: "Damaged", adjustedBy: "Warehouse", notes: "Water damage in bin A2" },
];

const seedCycleCounts = [
  { id: 1, date: "2026-07-25", location: "Warehouse C1", part: 6, systemQty: 7, countedQty: 5, countedBy: "Ops Mgr" },
];

const seedStockIns = [
  { id: 1, date: "2026-07-19", part: 2, qty: 100, vendor: "Northeast Electrical Supply", poRef: "PO-3041", receivedBy: "Warehouse" },
];

const INTEGRATIONS = [
  { key: "qbo", name: "QuickBooks Online", blurb: "Sync parts costs, POs, and job invoices to your books.", color: "text-emerald-400", border: "border-emerald-400/30" },
  { key: "sm8", name: "ServiceM8", blurb: "Pull job details and push parts usage back to jobs.", color: "text-sky-400", border: "border-sky-400/30" },
  { key: "hcp", name: "Housecall Pro", blurb: "Match dispatched jobs to parts consumption automatically.", color: "text-violet-400", border: "border-violet-400/30" },
  { key: "ghl", name: "GoHighLevel", blurb: "Trigger reorder & low-stock alerts into your automations.", color: "text-amber-400", border: "border-amber-400/30" },
];

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "jobs", label: "Jobs", icon: Briefcase },
  { key: "parts", label: "Parts Catalog", icon: Package },
  { key: "pos", label: "Purchase Orders", icon: ShoppingCart },
  { key: "loadout", label: "Truck Load Out", icon: ArrowLeftRight },
  { key: "fieldreq", label: "Field Requests", icon: ClipboardList },
  { key: "fleet", label: "Fleet", icon: Truck },
  { key: "reports", label: "Reports", icon: BarChart3 },
  { key: "adjust", label: "Stock Adjustment", icon: SlidersHorizontal },
  { key: "cyclecount", label: "Cycle Counts", icon: ListChecks },
  { key: "stockin", label: "Stock In", icon: PackagePlus },
  { key: "scanner", label: "Barcode Scanner", icon: ScanLine },
  { key: "integrations", label: "Integrations", icon: Plug },
  { key: "activity", label: "Activity Log", icon: History },
];

/* ---------------------------------- SHARED UI ---------------------------------- */
function Badge({ children, className = "" }) {
  return <span className={`f-mono text-[11px] px-2 py-0.5 rounded border ${className}`}>{children}</span>;
}

function TradeBadge({ category }) {
  const s = TRADE_STYLES[category] || TRADE_STYLES.General;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 ${s.text} ${s.bg} border ${s.border} px-2 py-0.5 rounded f-mono text-[11px]`}>
      <Icon size={11} /> {category}
    </span>
  );
}

function IconBtn({ onClick, children, title, danger }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded border transition-colors ${
        danger
          ? "border-slate-700 text-slate-400 hover:text-red-400 hover:border-red-400/40 hover:bg-red-400/10"
          : "border-slate-700 text-slate-400 hover:text-orange-400 hover:border-orange-400/40 hover:bg-orange-400/10"
      }`}
    >
      {children}
    </button>
  );
}

function PrimaryBtn({ onClick, children, className = "" }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white f-display uppercase tracking-wide text-sm px-3.5 py-2 rounded transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

function Panel({ title, icon: Icon, right, children, className = "" }) {
  return (
    <div className={`relative bg-slate-900/70 border border-slate-800 rounded-lg ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2 text-slate-200">
          {Icon && <Icon size={16} className="text-orange-500" />}
          <h3 className="f-display uppercase tracking-wide text-base">{title}</h3>
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return <th className={`text-left text-[11px] f-mono uppercase text-slate-500 font-medium px-3 py-2 ${className}`}>{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2.5 text-sm text-slate-200 ${className}`}>{children}</td>;
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Search..."}
        className="f-body bg-slate-950 border border-slate-700 rounded pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-orange-500 w-56"
      />
    </div>
  );
}

function ConfirmModal({ title, message, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-sm p-5">
        <div className="flex items-center gap-2 text-red-400 mb-2">
          <AlertTriangle size={18} />
          <h4 className="f-display uppercase text-lg">{title}</h4>
        </div>
        <p className="text-sm text-slate-400 mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-500 text-white f-display uppercase tracking-wide">Delete</button>
        </div>
      </div>
    </div>
  );
}

function ModalShell({ title, icon: Icon, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className={`bg-slate-900 border border-slate-700 rounded-lg w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 sticky top-0 bg-slate-900">
          <div className="flex items-center gap-2 text-slate-100">
            {Icon && <Icon size={17} className="text-orange-500" />}
            <h4 className="f-display uppercase tracking-wide text-lg">{title}</h4>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-[11px] f-mono uppercase text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500";

/* ---------------------------------- GAUGE (signature element) ---------------------------------- */
function Gauge({ value, max, label, sub, color = "#ea580c" }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const angle = -90 + pct * 180;
  const r = 42, cx = 50, cy = 50;
  const arc = (start, end) => {
    const s = (Math.PI * start) / 180, e = (Math.PI * end) / 180;
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 62" className="w-32 h-auto">
        <path d={arc(180, 360)} fill="none" stroke="#1e293b" strokeWidth="8" strokeLinecap="round" />
        <path d={arc(180, 180 + pct * 180)} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={cx + 30 * Math.cos((Math.PI * angle) / 180)} y2={cy + 30 * Math.sin((Math.PI * angle) / 180)} stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3" fill="#e2e8f0" />
      </svg>
      <div className="text-center -mt-1">
        <div className="f-display text-2xl text-slate-100 leading-none">{value}</div>
        <div className="text-[10px] f-mono uppercase text-slate-500">{label}</div>
        {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
      </div>
    </div>
  );
}

/* ================================================================================ */
export default function InventoryApp() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [userName, setUserName] = useState("");
  const [loginName, setLoginName] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);

  const [parts, setParts] = useState(seedParts);
  const [jobs, setJobs] = useState(seedJobs);
  const [pos, setPos] = useState(seedPOs);
  const [loadouts, setLoadouts] = useState(seedLoadouts);
  const [fieldRequests, setFieldRequests] = useState(seedFieldRequests);
  const [fleet, setFleet] = useState(seedFleet);
  const [adjustments, setAdjustments] = useState(seedAdjustments);
  const [cycleCounts, setCycleCounts] = useState(seedCycleCounts);
  const [stockIns, setStockIns] = useState(seedStockIns);
  const [integrations, setIntegrations] = useState(INTEGRATIONS.map((i) => ({ ...i, connected: i.key === "sm8" })));
  const [activityLog, setActivityLog] = useState([
    { id: 1, ts: "2026-07-29 09:14", user: "Ops Mgr", msg: "Cycle count logged for Warehouse C1 — variance found on HV-FLTR-16." },
    { id: 2, ts: "2026-07-26 14:02", user: "Dan R.", msg: "Field request submitted for PL-PVC-ELB (Urgent)." },
    { id: 3, ts: "2026-07-19 08:30", user: "Warehouse", msg: "Received 100 units of EL-WIRE-12G against PO-3041." },
  ]);

  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [scanValue, setScanValue] = useState("");
  const [scanHistory, setScanHistory] = useState([]);
  const [scanResult, setScanResult] = useState(null);

  const [dataLoading, setDataLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);

  /* Load persisted state once on mount */
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("inventory-state", false);
        if (res && res.value) {
          const d = JSON.parse(res.value);
          if (d.parts) setParts(d.parts);
          if (d.jobs) setJobs(d.jobs);
          if (d.pos) setPos(d.pos);
          if (d.loadouts) setLoadouts(d.loadouts);
          if (d.fieldRequests) setFieldRequests(d.fieldRequests);
          if (d.fleet) setFleet(d.fleet);
          if (d.adjustments) setAdjustments(d.adjustments);
          if (d.cycleCounts) setCycleCounts(d.cycleCounts);
          if (d.stockIns) setStockIns(d.stockIns);
          if (d.integrations) setIntegrations(d.integrations);
          if (d.activityLog) setActivityLog(d.activityLog);
        }
      } catch (e) {
        // no saved state yet — first run, seed data will be used
      }
      setDataLoading(false);
    })();
  }, []);

  /* Persist state on every change, after initial load */
  useEffect(() => {
    if (dataLoading) return;
    const state = { parts, jobs, pos, loadouts, fieldRequests, fleet, adjustments, cycleCounts, stockIns, integrations, activityLog };
    window.storage.set("inventory-state", JSON.stringify(state), false)
      .then(() => setSaveError(false))
      .catch(() => setSaveError(true));
  }, [parts, jobs, pos, loadouts, fieldRequests, fleet, adjustments, cycleCounts, stockIns, integrations, activityLog, dataLoading]);

  const partById = (id) => parts.find((p) => p.id === Number(id));
  const truckById = (id) => fleet.find((t) => t.id === Number(id));

  const log = (msg) => setActivityLog((prev) => [{ id: nextId(prev), ts: new Date().toISOString().slice(0, 16).replace("T", " "), user: userName || "You", msg }, ...prev]);

  const adjustPartQty = (partId, delta) => {
    setParts((prev) => prev.map((p) => (p.id === Number(partId) ? { ...p, qty: p.qty + delta } : p)));
  };

  const lowStockParts = useMemo(() => parts.filter((p) => p.qty <= p.minReorder), [parts]);

  /* ---------- LOADING ---------- */
  if (dataLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <FontStyles />
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading Inventory...</div>
        </div>
      </div>
    );
  }

  /* ---------- LOGIN ---------- */
  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-slate-950 bp-grid flex items-center justify-center p-4 f-body">
        <FontStyles />
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 rounded-lg bg-orange-600 flex items-center justify-center mb-3 shadow-lg shadow-orange-900/40">
              <Zap size={26} className="text-white" />
            </div>
            <div className="f-display uppercase text-3xl text-slate-100 tracking-wide">SDR Electric</div>
            <div className="f-mono text-xs text-slate-500 uppercase tracking-widest mt-1">Inventory Ops</div>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-6 relative rivet">
            <Field label="Name">
              <input value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="e.g. Dan R." className={inputCls} />
            </Field>
            <Field label="Password">
              <input type="password" placeholder="••••••••" className={inputCls} defaultValue="demo" />
            </Field>
            <button
              onClick={() => { setUserName(loginName || "Tech Admin"); setLoggedIn(true); }}
              className="w-full mt-2 bg-orange-600 hover:bg-orange-500 text-white f-display uppercase tracking-wide text-base py-2.5 rounded transition-colors"
            >
              Log In
            </button>
            <div className="text-center text-[11px] text-slate-600 mt-3 f-mono">Electrical · Plumbing · HVAC</div>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- ENTITY CONFIG (generic CRUD forms) ---------- */
  const entityConfig = {
    part: {
      title: "Part", icon: Package, list: parts, setList: setParts,
      empty: { partNo: "", sku: "", category: "Electrical", location: "", qty: 0, minReorder: 0, unitCost: 0, desc: "" },
      fields: [
        { key: "partNo", label: "Part No.", type: "text" },
        { key: "sku", label: "SKU", type: "text" },
        { key: "category", label: "Category", type: "select", options: ["Electrical", "Plumbing", "HVAC", "General"] },
        { key: "location", label: "Location", type: "text" },
        { key: "qty", label: "Total Quantity", type: "number" },
        { key: "minReorder", label: "Min Reorder", type: "number" },
        { key: "unitCost", label: "Unit Cost ($)", type: "number", step: "0.01" },
        { key: "desc", label: "Description", type: "text" },
      ],
      label: (d) => `${d.partNo} — ${d.sku}`,
    },
    truck: {
      title: "Truck", icon: Truck, list: fleet, setList: setFleet,
      empty: { truckNumber: "", nickname: "", driver: "", plate: "", homeBase: "", status: "Active" },
      fields: [
        { key: "truckNumber", label: "Truck No.", type: "text" },
        { key: "nickname", label: "Nickname", type: "text" },
        { key: "driver", label: "Assigned Driver", type: "text" },
        { key: "plate", label: "Plate", type: "text" },
        { key: "homeBase", label: "Home Base", type: "text" },
        { key: "status", label: "Status", type: "select", options: ["Active", "In Shop", "Inactive"] },
      ],
      label: (d) => `${d.truckNumber} — ${d.nickname}`,
    },
    fieldreq: {
      title: "Field Request", icon: ClipboardList, list: fieldRequests, setList: setFieldRequests,
      empty: { requestedBy: "", truck: fleet[0]?.truckNumber || "", part: parts[0]?.id, qtyRequested: 1, priority: "Normal", status: "Pending", notes: "" },
      fields: [
        { key: "requestedBy", label: "Requested By", type: "text" },
        { key: "truck", label: "Truck", type: "select", options: fleet.map((t) => t.truckNumber) },
        { key: "part", label: "Part", type: "select", options: parts.map((p) => p.id), optionLabel: (v) => { const p = partById(v); return p ? `${p.partNo} — ${p.sku}` : v; } },
        { key: "qtyRequested", label: "Qty Requested", type: "number" },
        { key: "priority", label: "Priority", type: "select", options: ["Low", "Normal", "Urgent"] },
        { key: "status", label: "Status", type: "select", options: ["Pending", "Approved", "Fulfilled", "Denied"] },
        { key: "notes", label: "Notes", type: "text" },
      ],
      label: (d) => `Request by ${d.requestedBy}`,
    },
    adjust: {
      title: "Stock Adjustment", icon: SlidersHorizontal, list: adjustments, setList: setAdjustments,
      empty: { date: new Date().toISOString().slice(0, 10), part: parts[0]?.id, qtyChange: 0, reason: "Correction", adjustedBy: "", notes: "" },
      fields: [
        { key: "date", label: "Date", type: "date" },
        { key: "part", label: "Part", type: "select", options: parts.map((p) => p.id), optionLabel: (v) => { const p = partById(v); return p ? `${p.partNo} — ${p.sku}` : v; } },
        { key: "qtyChange", label: "Qty Change (+/-)", type: "number" },
        { key: "reason", label: "Reason", type: "select", options: ["Damaged", "Lost", "Found", "Correction", "Return"] },
        { key: "adjustedBy", label: "Adjusted By", type: "text" },
        { key: "notes", label: "Notes", type: "text" },
      ],
      label: (d) => `Adjustment on ${partById(d.part)?.partNo || ""}`,
      onSave: (data, prevData) => {
        const prevDelta = prevData ? Number(prevData.qtyChange) : 0;
        const prevPart = prevData ? prevData.part : null;
        if (prevData && prevPart) adjustPartQty(prevPart, -prevDelta);
        adjustPartQty(data.part, Number(data.qtyChange));
      },
      onDelete: (data) => adjustPartQty(data.part, -Number(data.qtyChange)),
    },
    cyclecount: {
      title: "Cycle Count", icon: ListChecks, list: cycleCounts, setList: setCycleCounts,
      empty: { date: new Date().toISOString().slice(0, 10), location: "", part: parts[0]?.id, systemQty: parts[0]?.qty || 0, countedQty: 0, countedBy: "" },
      fields: [
        { key: "date", label: "Date", type: "date" },
        { key: "location", label: "Location", type: "text" },
        { key: "part", label: "Part", type: "select", options: parts.map((p) => p.id), optionLabel: (v) => { const p = partById(v); return p ? `${p.partNo} — ${p.sku}` : v; } },
        { key: "systemQty", label: "System Qty", type: "number" },
        { key: "countedQty", label: "Counted Qty", type: "number" },
        { key: "countedBy", label: "Counted By", type: "text" },
      ],
      label: (d) => `Count — ${d.location}`,
    },
    stockin: {
      title: "Stock In", icon: PackagePlus, list: stockIns, setList: setStockIns,
      empty: { date: new Date().toISOString().slice(0, 10), part: parts[0]?.id, qty: 1, vendor: "", poRef: "", receivedBy: "" },
      fields: [
        { key: "date", label: "Date", type: "date" },
        { key: "part", label: "Part", type: "select", options: parts.map((p) => p.id), optionLabel: (v) => { const p = partById(v); return p ? `${p.partNo} — ${p.sku}` : v; } },
        { key: "qty", label: "Qty Received", type: "number" },
        { key: "vendor", label: "Vendor", type: "text" },
        { key: "poRef", label: "PO Reference", type: "text" },
        { key: "receivedBy", label: "Received By", type: "text" },
      ],
      label: (d) => `Received ${d.qty} × ${partById(d.part)?.partNo || ""}`,
      onSave: (data, prevData) => {
        if (prevData) adjustPartQty(prevData.part, -Number(prevData.qty));
        adjustPartQty(data.part, Number(data.qty));
      },
      onDelete: (data) => adjustPartQty(data.part, -Number(data.qty)),
    },
  };

  const openCreate = (entity) => setModal({ entity, mode: "create", data: { ...entityConfig[entity].empty } });
  const openEdit = (entity, data) => setModal({ entity, mode: "edit", data: { ...data } });

  const saveGeneric = () => {
    const cfg = entityConfig[modal.entity];
    const data = modal.data;
    if (modal.mode === "create") {
      const rec = { ...data, id: nextId(cfg.list) };
      cfg.setList((prev) => [rec, ...prev]);
      if (cfg.onSave) cfg.onSave(rec, null);
      log(`Added ${cfg.title.toLowerCase()}: ${cfg.label(rec)}`);
    } else {
      const prevData = cfg.list.find((x) => x.id === data.id);
      cfg.setList((prev) => prev.map((x) => (x.id === data.id ? data : x)));
      if (cfg.onSave) cfg.onSave(data, prevData);
      log(`Updated ${cfg.title.toLowerCase()}: ${cfg.label(data)}`);
    }
    setModal(null);
  };

  const deleteGeneric = () => {
    const cfg = entityConfig[confirm.entity];
    const data = cfg.list.find((x) => x.id === confirm.id);
    cfg.setList((prev) => prev.filter((x) => x.id !== confirm.id));
    if (cfg.onDelete && data) cfg.onDelete(data);
    log(`Deleted ${cfg.title.toLowerCase()}: ${cfg.label(data)}`);
    setConfirm(null);
  };

  /* ---------- GENERIC MODAL RENDER ---------- */
  const GenericModal = () => {
    const cfg = entityConfig[modal.entity];
    return (
      <ModalShell title={`${modal.mode === "create" ? "Add" : "Edit"} ${cfg.title}`} icon={cfg.icon} onClose={() => setModal(null)}>
        {cfg.fields.map((f) => (
          <Field label={f.label} key={f.key}>
            {f.type === "select" ? (
              <select
                className={inputCls}
                value={modal.data[f.key]}
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, [f.key]: e.target.value } })}
              >
                {f.options.map((o) => (
                  <option key={o} value={o}>{f.optionLabel ? f.optionLabel(o) : o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type}
                step={f.step}
                className={inputCls}
                value={modal.data[f.key]}
                onChange={(e) => setModal({ ...modal, data: { ...modal.data, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value } })}
              />
            )}
          </Field>
        ))}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
          <PrimaryBtn onClick={saveGeneric}><Check size={15} /> Save</PrimaryBtn>
        </div>
      </ModalShell>
    );
  };

  /* ---------- JOB MODAL (custom, line items) ---------- */
  const JobModal = () => {
    const d = modal.data;
    const updateLine = (i, key, val) => {
      const items = [...d.lineItems];
      items[i] = { ...items[i], [key]: val };
      setModal({ ...modal, data: { ...d, lineItems: items } });
    };
    const addLine = () => setModal({ ...modal, data: { ...d, lineItems: [...d.lineItems, { partId: parts[0]?.id, qty: 1, partCost: parts[0]?.unitCost || 0, saleCost: 0 }] } });
    const removeLine = (i) => setModal({ ...modal, data: { ...d, lineItems: d.lineItems.filter((_, idx) => idx !== i) } });
    const totalParts = d.lineItems.reduce((s, li) => s + Number(li.qty), 0);
    const totalCost = d.lineItems.reduce((s, li) => s + Number(li.qty) * Number(li.partCost), 0);
    const totalSale = d.lineItems.reduce((s, li) => s + Number(li.qty) * Number(li.saleCost), 0);

    return (
      <ModalShell title={`${modal.mode === "create" ? "Log" : "Edit"} Job`} icon={Briefcase} onClose={() => setModal(null)} wide>
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="Job No. / Invoice No."><input className={inputCls} value={d.jobNo} onChange={(e) => setModal({ ...modal, data: { ...d, jobNo: e.target.value } })} /></Field>
          <Field label="Date"><input type="date" className={inputCls} value={d.date} onChange={(e) => setModal({ ...modal, data: { ...d, date: e.target.value } })} /></Field>
          <Field label="Client Name"><input className={inputCls} value={d.client} onChange={(e) => setModal({ ...modal, data: { ...d, client: e.target.value } })} /></Field>
          <Field label="Technician"><input className={inputCls} value={d.technician} onChange={(e) => setModal({ ...modal, data: { ...d, technician: e.target.value } })} /></Field>
        </div>
        <Field label="Client Address"><input className={inputCls} value={d.address} onChange={(e) => setModal({ ...modal, data: { ...d, address: e.target.value } })} /></Field>

        <div className="mt-3 border border-slate-800 rounded">
          <div className="grid grid-cols-[2fr_0.8fr_1fr_1fr_auto] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500">
            <span>Part Used</span><span>Qty</span><span>Part Cost</span><span>Sale Cost</span><span></span>
          </div>
          {d.lineItems.map((li, i) => (
            <div key={i} className="grid grid-cols-[2fr_0.8fr_1fr_1fr_auto] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
              <select className={inputCls} value={li.partId} onChange={(e) => updateLine(i, "partId", Number(e.target.value))}>
                {parts.map((p) => <option key={p.id} value={p.id}>{p.partNo} — {p.sku}</option>)}
              </select>
              <input type="number" className={inputCls} value={li.qty} onChange={(e) => updateLine(i, "qty", Number(e.target.value))} />
              <input type="number" step="0.01" className={inputCls} value={li.partCost} onChange={(e) => updateLine(i, "partCost", Number(e.target.value))} />
              <input type="number" step="0.01" className={inputCls} value={li.saleCost} onChange={(e) => updateLine(i, "saleCost", Number(e.target.value))} />
              <IconBtn danger onClick={() => removeLine(i)}><Trash2 size={14} /></IconBtn>
            </div>
          ))}
          <div className="p-2">
            <button onClick={addLine} className="text-orange-400 text-xs f-mono flex items-center gap-1 hover:text-orange-300"><Plus size={13} /> Add Part Line</button>
          </div>
        </div>

        <div className="flex justify-end gap-6 mt-3 f-mono text-sm text-slate-300">
          <span>Total Qty: <b className="text-slate-100">{totalParts}</b></span>
          <span>Parts Cost: <b className="text-slate-100">{money(totalCost)}</b></span>
          <span>Sales Total: <b className="text-emerald-400">{money(totalSale)}</b></span>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
          <PrimaryBtn onClick={saveJob}><Check size={15} /> Save Job</PrimaryBtn>
        </div>
      </ModalShell>
    );
  };

  const saveJob = () => {
    const d = modal.data;
    if (modal.mode === "create") {
      const rec = { ...d, id: nextId(jobs) };
      setJobs((prev) => [rec, ...prev]);
      rec.lineItems.forEach((li) => adjustPartQty(li.partId, -Number(li.qty)));
      log(`Logged job ${rec.jobNo} for ${rec.client}`);
    } else {
      const prevJob = jobs.find((j) => j.id === d.id);
      prevJob.lineItems.forEach((li) => adjustPartQty(li.partId, Number(li.qty)));
      d.lineItems.forEach((li) => adjustPartQty(li.partId, -Number(li.qty)));
      setJobs((prev) => prev.map((j) => (j.id === d.id ? d : j)));
      log(`Updated job ${d.jobNo}`);
    }
    setModal(null);
  };

  /* ---------- PO MODAL (custom, line items) ---------- */
  const POModal = () => {
    const d = modal.data;
    const updateLine = (i, key, val) => {
      const items = [...d.lineItems];
      items[i] = { ...items[i], [key]: val };
      setModal({ ...modal, data: { ...d, lineItems: items } });
    };
    const addLine = () => setModal({ ...modal, data: { ...d, lineItems: [...d.lineItems, { partId: parts[0]?.id, qty: 1, unitCost: parts[0]?.unitCost || 0 }] } });
    const removeLine = (i) => setModal({ ...modal, data: { ...d, lineItems: d.lineItems.filter((_, idx) => idx !== i) } });
    const total = d.lineItems.reduce((s, li) => s + Number(li.qty) * Number(li.unitCost), 0);

    return (
      <ModalShell title={`${modal.mode === "create" ? "Create" : "Edit"} Purchase Order`} icon={ShoppingCart} onClose={() => setModal(null)} wide>
        <div className="grid grid-cols-3 gap-x-4">
          <Field label="PO No."><input className={inputCls} value={d.poNo} onChange={(e) => setModal({ ...modal, data: { ...d, poNo: e.target.value } })} /></Field>
          <Field label="Vendor"><input className={inputCls} value={d.vendor} onChange={(e) => setModal({ ...modal, data: { ...d, vendor: e.target.value } })} /></Field>
          <Field label="Date"><input type="date" className={inputCls} value={d.date} onChange={(e) => setModal({ ...modal, data: { ...d, date: e.target.value } })} /></Field>
        </div>
        <Field label="Status">
          <select className={inputCls} value={d.status} onChange={(e) => setModal({ ...modal, data: { ...d, status: e.target.value } })}>
            {["Draft", "Ordered", "Received", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>

        <div className="mt-2 border border-slate-800 rounded">
          <div className="grid grid-cols-[2fr_0.8fr_1fr_auto] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500">
            <span>Part</span><span>Qty</span><span>Unit Cost</span><span></span>
          </div>
          {d.lineItems.map((li, i) => (
            <div key={i} className="grid grid-cols-[2fr_0.8fr_1fr_auto] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
              <select className={inputCls} value={li.partId} onChange={(e) => updateLine(i, "partId", Number(e.target.value))}>
                {parts.map((p) => <option key={p.id} value={p.id}>{p.partNo} — {p.sku}</option>)}
              </select>
              <input type="number" className={inputCls} value={li.qty} onChange={(e) => updateLine(i, "qty", Number(e.target.value))} />
              <input type="number" step="0.01" className={inputCls} value={li.unitCost} onChange={(e) => updateLine(i, "unitCost", Number(e.target.value))} />
              <IconBtn danger onClick={() => removeLine(i)}><Trash2 size={14} /></IconBtn>
            </div>
          ))}
          <div className="p-2">
            <button onClick={addLine} className="text-orange-400 text-xs f-mono flex items-center gap-1 hover:text-orange-300"><Plus size={13} /> Add Line Item</button>
          </div>
        </div>
        <div className="flex justify-end mt-3 f-mono text-sm text-slate-300">PO Total: <b className="text-slate-100 ml-2">{money(total)}</b></div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
          <PrimaryBtn onClick={savePO}><Check size={15} /> Save PO</PrimaryBtn>
        </div>
      </ModalShell>
    );
  };

  const savePO = () => {
    const d = modal.data;
    if (modal.mode === "create") {
      const rec = { ...d, id: nextId(pos) };
      setPos((prev) => [rec, ...prev]);
      log(`Created PO ${rec.poNo} — ${rec.vendor}`);
    } else {
      setPos((prev) => prev.map((p) => (p.id === d.id ? d : p)));
      log(`Updated PO ${d.poNo}`);
    }
    setModal(null);
  };

  /* ---------- LOADOUT MODAL (custom, line items) ---------- */
  const LoadoutModal = () => {
    const d = modal.data;
    const updateLine = (i, key, val) => {
      const items = [...d.lineItems];
      items[i] = { ...items[i], [key]: val };
      setModal({ ...modal, data: { ...d, lineItems: items } });
    };
    const addLine = () => setModal({ ...modal, data: { ...d, lineItems: [...d.lineItems, { partId: parts[0]?.id, qty: 1 }] } });
    const removeLine = (i) => setModal({ ...modal, data: { ...d, lineItems: d.lineItems.filter((_, idx) => idx !== i) } });

    return (
      <ModalShell title={`${modal.mode === "create" ? "Log" : "Edit"} Truck Load Out`} icon={ArrowLeftRight} onClose={() => setModal(null)} wide>
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="Date"><input type="date" className={inputCls} value={d.date} onChange={(e) => setModal({ ...modal, data: { ...d, date: e.target.value } })} /></Field>
          <Field label="Truck">
            <select className={inputCls} value={d.truckId} onChange={(e) => setModal({ ...modal, data: { ...d, truckId: Number(e.target.value) } })}>
              {fleet.map((t) => <option key={t.id} value={t.id}>{t.truckNumber} — {t.nickname}</option>)}
            </select>
          </Field>
          <Field label="Direction">
            <select className={inputCls} value={d.direction} onChange={(e) => setModal({ ...modal, data: { ...d, direction: e.target.value } })}>
              {["Load Out", "Used on Job", "Return to Warehouse"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Job Reference (optional)"><input className={inputCls} value={d.jobRef} onChange={(e) => setModal({ ...modal, data: { ...d, jobRef: e.target.value } })} /></Field>
        </div>
        <Field label="Technician"><input className={inputCls} value={d.technician} onChange={(e) => setModal({ ...modal, data: { ...d, technician: e.target.value } })} /></Field>

        <div className="mt-2 border border-slate-800 rounded">
          <div className="grid grid-cols-[2fr_1fr_auto] gap-2 px-3 py-2 border-b border-slate-800 text-[11px] f-mono uppercase text-slate-500">
            <span>Part</span><span>Qty</span><span></span>
          </div>
          {d.lineItems.map((li, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_auto] gap-2 px-3 py-2 items-center border-b border-slate-800/60 last:border-0">
              <select className={inputCls} value={li.partId} onChange={(e) => updateLine(i, "partId", Number(e.target.value))}>
                {parts.map((p) => <option key={p.id} value={p.id}>{p.partNo} — {p.sku}</option>)}
              </select>
              <input type="number" className={inputCls} value={li.qty} onChange={(e) => updateLine(i, "qty", Number(e.target.value))} />
              <IconBtn danger onClick={() => removeLine(i)}><Trash2 size={14} /></IconBtn>
            </div>
          ))}
          <div className="p-2">
            <button onClick={addLine} className="text-orange-400 text-xs f-mono flex items-center gap-1 hover:text-orange-300"><Plus size={13} /> Add Part Line</button>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={() => setModal(null)} className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Cancel</button>
          <PrimaryBtn onClick={saveLoadout}><Check size={15} /> Save</PrimaryBtn>
        </div>
      </ModalShell>
    );
  };

  const saveLoadout = () => {
    const d = modal.data;
    if (modal.mode === "create") {
      const rec = { ...d, id: nextId(loadouts) };
      setLoadouts((prev) => [rec, ...prev]);
      log(`Logged truck load-out (${rec.direction}) for ${truckById(rec.truckId)?.truckNumber}`);
    } else {
      setLoadouts((prev) => prev.map((l) => (l.id === d.id ? d : l)));
      log(`Updated truck load-out for ${truckById(d.truckId)?.truckNumber}`);
    }
    setModal(null);
  };

  /* ---------- BARCODE SCAN ---------- */
  const handleScan = (val) => {
    if (!val) return;
    const found = parts.find((p) => p.sku.toLowerCase() === val.toLowerCase() || p.partNo.toLowerCase() === val.toLowerCase());
    setScanResult(found || null);
    setScanHistory((prev) => [{ id: nextId(prev), code: val, ts: new Date().toLocaleTimeString(), found: !!found }, ...prev].slice(0, 12));
    if (found) log(`Scanned ${found.partNo} (${found.sku})`);
  };

  /* ---------- SIDEBAR ---------- */
  const Sidebar = () => (
    <div className={`fixed md:static z-40 inset-y-0 left-0 w-60 bg-slate-950 border-r border-slate-800 flex flex-col transition-transform ${navOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
      <div className="flex items-center gap-2 px-4 h-16 border-b border-slate-800">
        <div className="w-8 h-8 rounded bg-orange-600 flex items-center justify-center shrink-0"><Zap size={16} className="text-white" /></div>
        <div>
          <div className="f-display uppercase text-sm leading-none text-slate-100 tracking-wide">SDR Electric</div>
          <div className="text-[10px] f-mono text-slate-500 uppercase tracking-widest">Inventory Ops</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = activeTab === n.key;
          return (
            <button
              key={n.key}
              onClick={() => { setActiveTab(n.key); setNavOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm f-body transition-colors border-l-2 ${
                active ? "bg-orange-600/10 border-orange-500 text-orange-400" : "border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Icon size={16} /> {n.label}
              {n.key === "parts" && lowStockParts.length > 0 && (
                <span className="ml-auto text-[10px] f-mono bg-red-500/20 text-red-400 px-1.5 rounded">{lowStockParts.length}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="p-3 border-t border-slate-800">
        <div className="flex items-center gap-2 px-2 py-2 text-slate-300 text-sm">
          <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center"><User size={14} /></div>
          <span className="f-body truncate">{userName}</span>
        </div>
        <button onClick={() => setLoggedIn(false)} className="w-full flex items-center gap-2 px-2 py-2 text-sm text-slate-500 hover:text-red-400 transition-colors">
          <LogOut size={15} /> Log Out
        </button>
      </div>
    </div>
  );

  /* ---------- TOPBAR ---------- */
  const Topbar = ({ title }) => (
    <div className="h-16 border-b border-slate-800 flex items-center justify-between px-4 md:px-6 bg-slate-950/80 sticky top-0 z-20 backdrop-blur">
      <div className="flex items-center gap-3">
        <button className="md:hidden text-slate-400" onClick={() => setNavOpen(true)}><Menu size={20} /></button>
        <h2 className="f-display uppercase text-xl md:text-2xl text-slate-100 tracking-wide">{title}</h2>
      </div>
      <div className="flex items-center gap-3">
        {saveError ? (
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] f-mono text-red-400 bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 rounded">
            <AlertTriangle size={12} /> SAVE FAILED
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] f-mono text-slate-600">
            <Check size={12} /> Saved
          </div>
        )}
        {lowStockParts.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] f-mono text-red-400 bg-red-500/10 border border-red-500/30 px-2.5 py-1.5 rounded">
            <AlertTriangle size={12} /> {lowStockParts.length} LOW STOCK
          </div>
        )}
      </div>
    </div>
  );

  /* ================================ TAB VIEWS ================================ */

  const DashboardView = () => {
    const totalPartsValue = parts.reduce((s, p) => s + p.qty * p.unitCost, 0);
    const totalSkus = parts.length;
    const openPOs = pos.filter((p) => p.status === "Ordered").length;
    const jobsThisWeek = jobs.length;
    const jobsSalesTotal = jobs.reduce((s, j) => s + j.lineItems.reduce((a, li) => a + li.qty * li.saleCost, 0), 0);
    const jobsCostTotal = jobs.reduce((s, j) => s + j.lineItems.reduce((a, li) => a + li.qty * li.partCost, 0), 0);

    return (
      <div className="p-4 md:p-6 space-y-6 bp-grid">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Panel title="Catalog Value" icon={Package}><Gauge value={Math.round(totalPartsValue)} max={5000} label="On-Hand $" color="#f97316" /></Panel>
          <Panel title="Low Stock" icon={AlertTriangle}><Gauge value={lowStockParts.length} max={totalSkus} label="Parts" sub="need reorder" color="#ef4444" /></Panel>
          <Panel title="Open POs" icon={ShoppingCart}><Gauge value={openPOs} max={pos.length || 1} label="Awaiting" color="#38bdf8" /></Panel>
          <Panel title="Job Margin" icon={Briefcase}><Gauge value={Math.round(jobsSalesTotal - jobsCostTotal)} max={Math.max(jobsSalesTotal, 100)} label="Profit $" color="#34d399" /></Panel>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Panel title="Recent Jobs" icon={Briefcase} className="lg:col-span-2">
            <table className="w-full">
              <thead><tr><Th>Job No.</Th><Th>Client</Th><Th>Date</Th><Th className="text-right">Sales</Th></tr></thead>
              <tbody>
                {jobs.slice(0, 5).map((j) => (
                  <tr key={j.id} className="border-t border-slate-800/70">
                    <Td className="f-mono text-orange-400">{j.jobNo}</Td>
                    <Td>{j.client}</Td>
                    <Td className="text-slate-400">{fmtDate(j.date)}</Td>
                    <Td className="text-right f-mono text-emerald-400">{money(j.lineItems.reduce((a, li) => a + li.qty * li.saleCost, 0))}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Reorder Alerts" icon={AlertTriangle}>
            <div className="space-y-2">
              {lowStockParts.length === 0 && <div className="text-sm text-slate-500">All parts above minimum. Nice.</div>}
              {lowStockParts.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-red-500/5 border border-red-500/20 rounded px-3 py-2">
                  <div>
                    <div className="f-mono text-sm text-slate-200">{p.partNo}</div>
                    <div className="text-[11px] text-slate-500">{p.sku}</div>
                  </div>
                  <div className="text-right">
                    <div className="f-mono text-sm text-red-400">{p.qty}/{p.minReorder}</div>
                    <TradeBadge category={p.category} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title="Fleet Snapshot" icon={Truck}>
            <div className="grid grid-cols-2 gap-3">
              {fleet.map((t) => (
                <div key={t.id} className="border border-slate-800 rounded px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="f-mono text-sm text-slate-200">{t.truckNumber}</span>
                    <Badge className={t.status === "Active" ? "border-emerald-400/30 text-emerald-400" : "border-slate-600 text-slate-400"}>{t.status}</Badge>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{t.nickname} · {t.driver}</div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Latest Activity" icon={History}>
            <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
              {activityLog.slice(0, 6).map((a) => (
                <div key={a.id} className="text-sm text-slate-400 border-l-2 border-slate-800 pl-3">
                  <span className="text-slate-200">{a.msg}</span>
                  <div className="text-[11px] f-mono text-slate-600 mt-0.5">{a.ts} · {a.user}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    );
  };

  const JobsView = () => {
    const [q, setQ] = useState("");
    const filtered = jobs.filter((j) => `${j.jobNo} ${j.client} ${j.address}`.toLowerCase().includes(q.toLowerCase()));
    return (
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search job, client, address..." />
          <PrimaryBtn onClick={() => setModal({ entity: "job", mode: "create", data: { jobNo: "", client: "", address: "", date: new Date().toISOString().slice(0, 10), technician: "", lineItems: [{ partId: parts[0]?.id, qty: 1, partCost: parts[0]?.unitCost || 0, saleCost: 0 }] } })}>
            <Plus size={15} /> Log Job
          </PrimaryBtn>
        </div>
        <Panel title="Job Log" icon={Briefcase}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr><Th>Job / Invoice No.</Th><Th>Client</Th><Th>Address</Th><Th>Qty Parts</Th><Th className="text-right">Parts Cost</Th><Th className="text-right">Sales Cost</Th><Th>Date</Th><Th></Th></tr></thead>
              <tbody>
                {filtered.map((j) => {
                  const totQty = j.lineItems.reduce((s, li) => s + Number(li.qty), 0);
                  const totCost = j.lineItems.reduce((s, li) => s + li.qty * li.partCost, 0);
                  const totSale = j.lineItems.reduce((s, li) => s + li.qty * li.saleCost, 0);
                  return (
                    <tr key={j.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                      <Td className="f-mono text-orange-400">{j.jobNo}</Td>
                      <Td>{j.client}</Td>
                      <Td className="text-slate-400 text-xs max-w-[220px] truncate">{j.address}</Td>
                      <Td className="f-mono">{totQty}</Td>
                      <Td className="text-right f-mono">{money(totCost)}</Td>
                      <Td className="text-right f-mono text-emerald-400">{money(totSale)}</Td>
                      <Td className="text-slate-400">{fmtDate(j.date)}</Td>
                      <Td>
                        <div className="flex gap-1.5 justify-end">
                          <IconBtn onClick={() => openEdit("job", j)}><Pencil size={13} /></IconBtn>
                          <IconBtn danger onClick={() => setConfirm({ entity: "job", id: j.id, name: j.jobNo })}><Trash2 size={13} /></IconBtn>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    );
  };

  const PartsView = () => {
    const [q, setQ] = useState("");
    const filtered = parts.filter((p) => `${p.partNo} ${p.sku} ${p.category} ${p.location}`.toLowerCase().includes(q.toLowerCase()));
    return (
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder="Search part no, SKU, location..." />
          <PrimaryBtn onClick={() => openCreate("part")}><Plus size={15} /> Add Part</PrimaryBtn>
        </div>
        <Panel title="Parts Catalog" icon={Package}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr><Th>Part No.</Th><Th>SKU</Th><Th>Category</Th><Th>Location</Th><Th className="text-right">Total Qty</Th><Th className="text-right">Min Reorder</Th><Th></Th></tr></thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className={`border-t border-slate-800/70 hover:bg-slate-900/40 ${p.qty <= p.minReorder ? "bg-red-500/5" : ""}`}>
                    <Td className="f-mono text-slate-100">{p.partNo}</Td>
                    <Td className="f-mono text-slate-400">{p.sku}</Td>
                    <Td><TradeBadge category={p.category} /></Td>
                    <Td className="text-slate-400 flex items-center gap-1"><MapPin size={12} className="text-slate-600" />{p.location}</Td>
                    <Td className={`text-right f-mono ${p.qty <= p.minReorder ? "text-red-400" : "text-slate-200"}`}>{p.qty}</Td>
                    <Td className="text-right f-mono text-slate-500">{p.minReorder}</Td>
                    <Td>
                      <div className="flex gap-1.5 justify-end">
                        <IconBtn onClick={() => openEdit("part", p)}><Pencil size={13} /></IconBtn>
                        <IconBtn danger onClick={() => setConfirm({ entity: "part", id: p.id, name: p.partNo })}><Trash2 size={13} /></IconBtn>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    );
  };

  const POsView = () => (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div />
        <PrimaryBtn onClick={() => setModal({ entity: "po", mode: "create", data: { poNo: "", vendor: "", date: new Date().toISOString().slice(0, 10), status: "Ordered", lineItems: [{ partId: parts[0]?.id, qty: 1, unitCost: parts[0]?.unitCost || 0 }] } })}>
          <Plus size={15} /> New PO
        </PrimaryBtn>
      </div>
      <Panel title="Purchase Orders" icon={ShoppingCart}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead><tr><Th>PO No.</Th><Th>Vendor</Th><Th>Date</Th><Th>Line Items</Th><Th className="text-right">Total</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>
              {pos.map((p) => {
                const total = p.lineItems.reduce((s, li) => s + li.qty * li.unitCost, 0);
                return (
                  <tr key={p.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                    <Td className="f-mono text-orange-400">{p.poNo}</Td>
                    <Td>{p.vendor}</Td>
                    <Td className="text-slate-400">{fmtDate(p.date)}</Td>
                    <Td className="text-slate-400 text-xs">{p.lineItems.length} item{p.lineItems.length !== 1 ? "s" : ""}</Td>
                    <Td className="text-right f-mono">{money(total)}</Td>
                    <Td><Badge className={p.status === "Received" ? "border-emerald-400/30 text-emerald-400" : p.status === "Ordered" ? "border-sky-400/30 text-sky-400" : "border-slate-600 text-slate-400"}>{p.status}</Badge></Td>
                    <Td>
                      <div className="flex gap-1.5 justify-end">
                        <IconBtn onClick={() => openEdit("po", p)}><Pencil size={13} /></IconBtn>
                        <IconBtn danger onClick={() => setConfirm({ entity: "po", id: p.id, name: p.poNo })}><Trash2 size={13} /></IconBtn>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );

  const LoadoutView = () => (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div />
        <PrimaryBtn onClick={() => setModal({ entity: "loadout", mode: "create", data: { date: new Date().toISOString().slice(0, 10), truckId: fleet[0]?.id, direction: "Load Out", jobRef: "", technician: "", lineItems: [{ partId: parts[0]?.id, qty: 1 }] } })}>
          <Plus size={15} /> Log Load Out
        </PrimaryBtn>
      </div>
      <Panel title="Truck Load Out Log" icon={ArrowLeftRight}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead><tr><Th>Date</Th><Th>Truck</Th><Th>Direction</Th><Th>Job Ref</Th><Th>Technician</Th><Th>Parts</Th><Th></Th></tr></thead>
            <tbody>
              {loadouts.map((l) => (
                <tr key={l.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                  <Td className="text-slate-400">{fmtDate(l.date)}</Td>
                  <Td className="f-mono">{truckById(l.truckId)?.truckNumber}</Td>
                  <Td><Badge className={l.direction === "Return to Warehouse" ? "border-sky-400/30 text-sky-400" : "border-orange-400/30 text-orange-400"}>{l.direction}</Badge></Td>
                  <Td className="text-slate-400">{l.jobRef || "—"}</Td>
                  <Td>{l.technician}</Td>
                  <Td className="text-xs text-slate-400">{l.lineItems.map((li) => `${partById(li.partId)?.sku} ×${li.qty}`).join(", ")}</Td>
                  <Td>
                    <div className="flex gap-1.5 justify-end">
                      <IconBtn onClick={() => openEdit("loadout", l)}><Pencil size={13} /></IconBtn>
                      <IconBtn danger onClick={() => setConfirm({ entity: "loadout", id: l.id, name: `load-out ${fmtDate(l.date)}` })}><Trash2 size={13} /></IconBtn>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );

  const genericListView = (entityKey, title, icon, columns) => {
    const cfg = entityConfig[entityKey];
    return (
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <div />
          <PrimaryBtn onClick={() => openCreate(entityKey)}><Plus size={15} /> Add {cfg.title}</PrimaryBtn>
        </div>
        <Panel title={title} icon={icon}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead><tr>{columns.map((c) => <Th key={c.key} className={c.right ? "text-right" : ""}>{c.label}</Th>)}<Th></Th></tr></thead>
              <tbody>
                {cfg.list.map((row) => (
                  <tr key={row.id} className="border-t border-slate-800/70 hover:bg-slate-900/40">
                    {columns.map((c) => <Td key={c.key} className={c.right ? "text-right f-mono" : ""}>{c.render ? c.render(row) : row[c.key]}</Td>)}
                    <Td>
                      <div className="flex gap-1.5 justify-end">
                        <IconBtn onClick={() => openEdit(entityKey, row)}><Pencil size={13} /></IconBtn>
                        <IconBtn danger onClick={() => setConfirm({ entity: entityKey, id: row.id, name: cfg.label(row) })}><Trash2 size={13} /></IconBtn>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    );
  };

  const FleetView = () => genericListView("truck", "Fleet", Truck, [
    { key: "truckNumber", label: "Truck No." },
    { key: "nickname", label: "Nickname" },
    { key: "driver", label: "Driver" },
    { key: "plate", label: "Plate" },
    { key: "homeBase", label: "Home Base" },
    { key: "status", label: "Status", render: (r) => <Badge className={r.status === "Active" ? "border-emerald-400/30 text-emerald-400" : "border-slate-600 text-slate-400"}>{r.status}</Badge> },
  ]);

  const FieldReqView = () => genericListView("fieldreq", "Field Requests", ClipboardList, [
    { key: "requestedBy", label: "Requested By" },
    { key: "truck", label: "Truck" },
    { key: "part", label: "Part", render: (r) => <span className="f-mono text-xs">{partById(r.part)?.partNo}</span> },
    { key: "qtyRequested", label: "Qty", right: true },
    { key: "priority", label: "Priority", render: (r) => <Badge className={r.priority === "Urgent" ? "border-red-400/30 text-red-400" : "border-slate-600 text-slate-400"}>{r.priority}</Badge> },
    { key: "status", label: "Status", render: (r) => <Badge className={r.status === "Fulfilled" ? "border-emerald-400/30 text-emerald-400" : r.status === "Pending" ? "border-amber-400/30 text-amber-400" : "border-sky-400/30 text-sky-400"}>{r.status}</Badge> },
  ]);

  const AdjustView = () => genericListView("adjust", "Stock Adjustments", SlidersHorizontal, [
    { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
    { key: "part", label: "Part", render: (r) => <span className="f-mono text-xs">{partById(r.part)?.partNo}</span> },
    { key: "qtyChange", label: "Qty Change", right: true, render: (r) => <span className={r.qtyChange < 0 ? "text-red-400" : "text-emerald-400"}>{r.qtyChange > 0 ? "+" : ""}{r.qtyChange}</span> },
    { key: "reason", label: "Reason" },
    { key: "adjustedBy", label: "Adjusted By" },
  ]);

  const CycleCountView = () => genericListView("cyclecount", "Cycle Counts", ListChecks, [
    { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
    { key: "location", label: "Location" },
    { key: "part", label: "Part", render: (r) => <span className="f-mono text-xs">{partById(r.part)?.partNo}</span> },
    { key: "systemQty", label: "System Qty", right: true },
    { key: "countedQty", label: "Counted Qty", right: true },
    { key: "variance", label: "Variance", right: true, render: (r) => { const v = r.countedQty - r.systemQty; return <span className={v === 0 ? "text-slate-400" : v < 0 ? "text-red-400" : "text-emerald-400"}>{v > 0 ? "+" : ""}{v}</span>; } },
  ]);

  const StockInView = () => genericListView("stockin", "Stock In", PackagePlus, [
    { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
    { key: "part", label: "Part", render: (r) => <span className="f-mono text-xs">{partById(r.part)?.partNo}</span> },
    { key: "qty", label: "Qty Received", right: true },
    { key: "vendor", label: "Vendor" },
    { key: "poRef", label: "PO Ref" },
    { key: "receivedBy", label: "Received By" },
  ]);

  const ReportsView = () => {
    const byCategory = ["Electrical", "Plumbing", "HVAC", "General"].map((cat) => ({
      cat, value: parts.filter((p) => p.category === cat).reduce((s, p) => s + p.qty * p.unitCost, 0),
    })).filter((c) => c.value > 0);
    const maxVal = Math.max(...byCategory.map((c) => c.value), 1);
    const jobsSales = jobs.reduce((s, j) => s + j.lineItems.reduce((a, li) => a + li.qty * li.saleCost, 0), 0);
    const jobsCost = jobs.reduce((s, j) => s + j.lineItems.reduce((a, li) => a + li.qty * li.partCost, 0), 0);
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title="Inventory Value by Trade" icon={BarChart3}>
            <div className="space-y-3">
              {byCategory.map((c) => {
                const s = TRADE_STYLES[c.cat];
                return (
                  <div key={c.cat}>
                    <div className="flex justify-between text-xs f-mono text-slate-400 mb-1"><span>{c.cat}</span><span>{money(c.value)}</span></div>
                    <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden"><div className={`h-full ${s.dot}`} style={{ width: `${(c.value / maxVal) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel title="Job Profitability" icon={Briefcase}>
            <div className="flex items-center justify-around py-3">
              <Gauge value={Math.round(jobsCost)} max={Math.max(jobsSales, 100)} label="Parts Cost" color="#f97316" />
              <Gauge value={Math.round(jobsSales)} max={Math.max(jobsSales, 100)} label="Sales Total" color="#34d399" />
            </div>
            <div className="text-center text-sm text-slate-400 mt-1">Margin: <b className="text-emerald-400">{money(jobsSales - jobsCost)}</b> ({jobsSales ? Math.round(((jobsSales - jobsCost) / jobsSales) * 100) : 0}%)</div>
          </Panel>
        </div>
        <Panel title="Reorder Report" icon={AlertTriangle}>
          <table className="w-full">
            <thead><tr><Th>Part No.</Th><Th>SKU</Th><Th>Category</Th><Th className="text-right">On Hand</Th><Th className="text-right">Min</Th><Th className="text-right">Suggested Order Qty</Th></tr></thead>
            <tbody>
              {lowStockParts.map((p) => (
                <tr key={p.id} className="border-t border-slate-800/70">
                  <Td className="f-mono">{p.partNo}</Td><Td className="f-mono text-slate-400">{p.sku}</Td><Td><TradeBadge category={p.category} /></Td>
                  <Td className="text-right f-mono text-red-400">{p.qty}</Td><Td className="text-right f-mono text-slate-500">{p.minReorder}</Td>
                  <Td className="text-right f-mono text-emerald-400">{Math.max(p.minReorder * 2 - p.qty, p.minReorder)}</Td>
                </tr>
              ))}
              {lowStockParts.length === 0 && <tr><Td className="text-slate-500" colSpan={6}>Nothing to reorder right now.</Td></tr>}
            </tbody>
          </table>
        </Panel>
      </div>
    );
  };

  const IntegrationsView = () => (
    <div className="p-4 md:p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {integrations.map((i) => (
          <div key={i.key} className={`bg-slate-900/70 border ${i.border} rounded-lg p-5`}>
            <div className="flex items-center justify-between mb-2">
              <h4 className={`f-display uppercase text-lg ${i.color}`}>{i.name}</h4>
              <Badge className={i.connected ? "border-emerald-400/30 text-emerald-400" : "border-slate-600 text-slate-500"}>{i.connected ? "Connected" : "Not Connected"}</Badge>
            </div>
            <p className="text-sm text-slate-400 mb-4">{i.blurb}</p>
            <button
              onClick={() => { setIntegrations((prev) => prev.map((x) => (x.key === i.key ? { ...x, connected: !x.connected } : x))); log(`${i.connected ? "Disconnected" : "Connected"} ${i.name} integration`); }}
              className={`text-sm f-display uppercase tracking-wide px-3.5 py-2 rounded border transition-colors ${i.connected ? "border-slate-700 text-slate-400 hover:bg-slate-800" : "bg-orange-600 border-orange-600 hover:bg-orange-500 text-white"}`}
            >
              {i.connected ? "Disconnect" : "Connect"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  const ActivityView = () => (
    <div className="p-4 md:p-6">
      <Panel title="Activity Log" icon={History}>
        <div className="space-y-3">
          {activityLog.map((a) => (
            <div key={a.id} className="flex gap-3 border-b border-slate-800/60 pb-3 last:border-0">
              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-2 shrink-0" />
              <div>
                <div className="text-sm text-slate-200">{a.msg}</div>
                <div className="text-[11px] f-mono text-slate-500 mt-0.5">{a.ts} · {a.user}</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );

  const ScannerView = () => (
    <div className="p-4 md:p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Scan / Enter Code" icon={ScanLine}>
          <div className="flex flex-col items-center py-6">
            <div className="w-full max-w-xs aspect-square border-2 border-dashed border-slate-700 rounded-lg flex items-center justify-center mb-4 bp-grid">
              <ScanLine size={48} className="text-slate-600" />
            </div>
            <input
              autoFocus
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { handleScan(scanValue); setScanValue(""); } }}
              placeholder="Scan barcode or type SKU / Part No. + Enter"
              className={`${inputCls} max-w-xs text-center f-mono`}
            />
            <button onClick={() => { handleScan(scanValue); setScanValue(""); }} className="mt-3 text-orange-400 text-xs f-mono hover:text-orange-300">Simulate Scan ↵</button>
          </div>
          {scanResult !== null && (
            scanResult ? (
              <div className="border border-emerald-400/30 bg-emerald-400/5 rounded p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="f-mono text-slate-100">{scanResult.partNo}</span>
                  <TradeBadge category={scanResult.category} />
                </div>
                <div className="text-sm text-slate-400">{scanResult.desc}</div>
                <div className="flex gap-6 mt-2 text-sm f-mono">
                  <span>Qty: <b className="text-slate-100">{scanResult.qty}</b></span>
                  <span>Location: <b className="text-slate-100">{scanResult.location}</b></span>
                </div>
              </div>
            ) : (
              <div className="border border-red-400/30 bg-red-400/5 rounded p-4 text-sm text-red-400">No matching part found for that code.</div>
            )
          )}
        </Panel>
        <Panel title="Scan History" icon={History}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {scanHistory.length === 0 && <div className="text-sm text-slate-500">No scans yet this session.</div>}
            {scanHistory.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm border-b border-slate-800/60 pb-2">
                <span className="f-mono text-slate-300">{s.code}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">{s.ts}</span>
                  <Badge className={s.found ? "border-emerald-400/30 text-emerald-400" : "border-red-400/30 text-red-400"}>{s.found ? "Found" : "No Match"}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );

  const TITLES = {
    dashboard: "Dashboard", jobs: "Jobs", parts: "Parts Catalog", pos: "Purchase Orders",
    loadout: "Truck Load Out", fieldreq: "Field Requests", fleet: "Fleet", reports: "Reports",
    adjust: "Stock Adjustment", cyclecount: "Cycle Counts", stockin: "Stock In",
    scanner: "Barcode Scanner", integrations: "Integrations", activity: "Activity Log",
  };

  const VIEWS = {
    dashboard: DashboardView, jobs: JobsView, parts: PartsView, pos: POsView,
    loadout: LoadoutView, fieldreq: FieldReqView, fleet: FleetView, reports: ReportsView,
    adjust: AdjustView, cyclecount: CycleCountView, stockin: StockInView,
    scanner: ScannerView, integrations: IntegrationsView, activity: ActivityView,
  };
  const ActiveView = VIEWS[activeTab];

  return (
    <div className="min-h-screen bg-slate-950 f-body flex">
      <FontStyles />
      {navOpen && <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={() => setNavOpen(false)} />}
      <Sidebar />
      <div className="flex-1 min-w-0">
        <Topbar title={TITLES[activeTab]} />
        <ActiveView />
      </div>

      {modal?.entity === "job" && <JobModal />}
      {modal?.entity === "po" && <POModal />}
      {modal?.entity === "loadout" && <LoadoutModal />}
      {modal && !["job", "po", "loadout"].includes(modal.entity) && <GenericModal />}
      {confirm && (
        <ConfirmModal
          title="Delete Record"
          message={`Are you sure you want to delete "${confirm.name}"? This can't be undone.`}
          onCancel={() => setConfirm(null)}
          onConfirm={deleteGeneric}
        />
      )}
    </div>
  );
}
