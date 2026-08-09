"use client";
import { useEffect, useRef, useState } from "react";
import { Search, X, AlertTriangle, Zap, Droplets, Wind, Package, MoreVertical } from "lucide-react";

export const TRADE_STYLES = {
  Electrical: { text: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/30", dot: "bg-amber-400", icon: Zap },
  Plumbing:   { text: "text-sky-400",   bg: "bg-sky-400/10",   border: "border-sky-400/30",   dot: "bg-sky-400",   icon: Droplets },
  HVAC:       { text: "text-orange-500",bg: "bg-orange-500/10",border: "border-orange-500/30",dot: "bg-orange-500",icon: Wind },
  General:    { text: "text-slate-300", bg: "bg-slate-400/10", border: "border-slate-400/30", dot: "bg-slate-400", icon: Package },
};

export const money = (n) => `$${Number(n || 0).toFixed(2)}`;
export const inputCls = "w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500";

export function Badge({ children, className = "" }) {
  return <span className={`f-mono text-[11px] px-2 py-0.5 rounded border ${className}`}>{children}</span>;
}

export function TradeBadge({ category }) {
  const s = TRADE_STYLES[category] || TRADE_STYLES.General;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 ${s.text} ${s.bg} border ${s.border} px-2 py-0.5 rounded f-mono text-[11px]`}>
      <Icon size={11} /> {category}
    </span>
  );
}

export function IconBtn({ onClick, children, title, danger }) {
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

export function PrimaryBtn({ onClick, children, className = "", disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 bg-orange-600 hover:bg-orange-500 text-white f-display uppercase tracking-wide text-sm px-3.5 py-2 rounded transition-colors disabled:opacity-50 disabled:pointer-events-none ${className}`}
    >
      {children}
    </button>
  );
}

export function Panel({ title, icon: Icon, right, children, className = "" }) {
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

export function Th({ children, className = "", ...rest }) {
  return <th className={`text-left text-[11px] f-mono uppercase text-slate-500 font-medium px-3 py-2 ${className}`} {...rest}>{children}</th>;
}
export function Td({ children, className = "", ...rest }) {
  return <td className={`px-3 py-2.5 text-sm text-slate-200 ${className}`} {...rest}>{children}</td>;
}

export function Gauge({ value, max, label, sub, color = "#ea580c" }) {
  const pct = Math.max(0, Math.min(1, value / (max || 1)));
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

export function SearchInput({ value, onChange, placeholder }) {
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

export function ConfirmModal({ title, message, onCancel, onConfirm }) {
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

export function ModalShell({ title, icon: Icon, onClose, children, wide }) {
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

export function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-[11px] f-mono uppercase text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

// Type-to-search dropdown for picking a part by number or SKU — swap in
// anywhere a plain <select> of parts would otherwise force scrolling
// through a huge list (Jobs, Stock In, Stock Adjustments, POs, Loadouts,
// Field Requests, Cycle Counts). Matches on part_no, sku, and description.
export function PartPicker({ parts, value, onChange, placeholder = "Type part no. or SKU..." }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);

  const selected = parts.find((p) => p.id === value);
  const label = (p) => `${p.part_no}${p.sku ? " — " + p.sku : ""}`;

  useEffect(() => {
    if (!open) setQuery(selected ? label(selected) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, parts.length]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery(selected ? label(selected) : "");
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const q = query.trim().toLowerCase();
  const filtered = (
    q ? parts.filter((p) => `${p.part_no} ${p.sku || ""} ${p.description || ""}`.toLowerCase().includes(q)) : parts
  ).slice(0, 50);

  const pick = (p) => {
    onChange(p.id);
    setQuery(label(p));
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <input
        className={inputCls}
        value={query}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight]); }
          else if (e.key === "Escape") { setOpen(false); setQuery(selected ? label(selected) : ""); }
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto bg-slate-900 border border-slate-700 rounded shadow-lg">
          {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">No matching parts.</div>}
          {filtered.map((p, i) => (
            <button
              type="button"
              key={p.id}
              onClick={() => pick(p)}
              className={`w-full text-left px-3 py-1.5 text-sm ${i === highlight ? "bg-orange-600/20 text-orange-300" : "text-slate-200 hover:bg-slate-800"}`}
            >
              <span className="f-mono">{p.part_no}</span>
              {p.sku ? <span className="text-slate-500"> — {p.sku}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Small "..." row-action menu (Edit / Deactivate / Delete, etc.) — used by
// screens with more actions per row than fit as inline icon buttons, e.g.
// Vendors. `trigger` defaults to a MoreVertical dots icon if omitted.
export function DropdownMenu({ trigger, items, align = "right" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800"
      >
        {trigger || <MoreVertical size={15} />}
      </button>
      {open && (
        <>
          {/* Click-outside catcher — sits under the menu, above everything else */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-50 mt-1 ${align === "right" ? "right-0" : "left-0"} bg-slate-900 border border-slate-700 rounded shadow-lg min-w-[170px] py-1`}
          >
            {items.map((it, idx) => (
              <button
                key={idx}
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-800 flex items-center gap-2 ${it.danger ? "text-red-400" : "text-slate-200"}`}
              >
                {it.icon && <it.icon size={14} />}
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}