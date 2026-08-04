"use client";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Warehouse, Truck, Package } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, Badge, money } from "@/components/ui";

export default function LocationsPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState(null);
  const [locations, setLocations] = useState([]);
  const [rows, setRows] = useState([]); // inventory_balances joined with parts + locations
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
      setOrgId(profile?.org_id || null);
    })();
  }, [router]);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      setLoading(true);
      const [{ data: locData, error: locErr }, { data: stockData, error: stockErr }] = await Promise.all([
        supabase.from("locations").select("*").eq("org_id", orgId).order("type").order("name"),
        supabase.from("inventory_balances").select("quantity_on_hand, part_id, location_id, parts(part_no, sku, unit_cost)").eq("org_id", orgId).gt("quantity_on_hand", 0),
      ]);
      setError(locErr?.message || stockErr?.message || "");
      setLocations(locData || []);
      setRows(stockData || []);
      setLoading(false);
    })();
  }, [orgId]);

  const rowsForLocation = (locId) => rows.filter((r) => r.location_id === locId);
  const summaryFor = (locId) => {
    const items = rowsForLocation(locId);
    return {
      skuCount: items.length,
      totalQty: items.reduce((s, r) => s + r.quantity_on_hand, 0),
      totalValue: items.reduce((s, r) => s + r.quantity_on_hand * (r.parts?.unit_cost || 0), 0),
    };
  };

  if (!orgId) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="f-mono text-xs text-slate-500 uppercase tracking-widest">Loading...</div></div>;
  }

  return (
    <Nav title="Locations">
      <div className="p-4 md:p-6">
        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}
        <Panel title="Locations" icon={Warehouse}>
          {loading ? (
            <div className="text-sm text-slate-500 p-2">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead><tr><Th>Location</Th><Th>Type</Th><Th className="text-right">Distinct Parts</Th><Th className="text-right">Total Qty</Th><Th className="text-right">Est. Value</Th><Th></Th></tr></thead>
                <tbody>
                  {locations.map((l) => {
                    const s = summaryFor(l.id);
                    const isOpen = expanded === l.id;
                    return (
                      <Fragment key={l.id}>
                        <tr className="border-t border-slate-800/70 hover:bg-slate-900/40 cursor-pointer" onClick={() => setExpanded(isOpen ? null : l.id)}>
                          <Td className="text-slate-100 flex items-center gap-1.5">
                            {l.type === "TRUCK" ? <Truck size={13} className="text-slate-500" /> : <Warehouse size={13} className="text-slate-500" />}
                            {l.name}
                          </Td>
                          <Td><Badge className={l.type === "WAREHOUSE" ? "border-orange-400/30 text-orange-400" : "border-sky-400/30 text-sky-400"}>{l.type}</Badge></Td>
                          <Td className="text-right f-mono text-slate-300">{s.skuCount}</Td>
                          <Td className="text-right f-mono text-slate-200">{s.totalQty}</Td>
                          <Td className="text-right f-mono text-emerald-400">{money(s.totalValue)}</Td>
                          <Td className="text-slate-500 text-xs">{isOpen ? "Hide" : "View"}</Td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-slate-900/40">
                            <td colSpan={6} className="p-3">
                              {rowsForLocation(l.id).length === 0 ? (
                                <div className="text-sm text-slate-500 flex items-center gap-1.5"><Package size={13} /> Nothing stocked here.</div>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {rowsForLocation(l.id).map((r, i) => (
                                    <div key={i} className="flex items-center justify-between border border-slate-800 rounded px-3 py-1.5 text-sm">
                                      <span className="f-mono text-slate-300">{r.parts?.part_no}</span>
                                      <span className="f-mono text-orange-400">{r.quantity_on_hand}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {locations.length === 0 && <tr><Td colSpan={6} className="text-slate-500">No locations yet.</Td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </Nav>
  );
}
