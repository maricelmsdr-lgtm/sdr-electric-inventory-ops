"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Warehouse, Truck, Package } from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { Panel, Th, Td, Badge, money } from "@/components/ui";

export default function LocationsPage() {
  const router = useRouter();

  const [orgId, setOrgId] = useState(null);
  const [locations, setLocations] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /*
   * =========================================================
   * AUTHENTICATION + ORGANIZATION
   * =========================================================
   */

  useEffect(() => {
    let mounted = true;

    const loadAuth = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (!mounted) return;

        if (userError) {
          setError(userError.message);
          setLoading(false);
          return;
        }

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

        if (!mounted) return;

        if (profileError) {
          setError(profileError.message);
          setLoading(false);
          return;
        }

        if (!profile?.org_id) {
          setError(
            "No organization is assigned to your user profile."
          );
          setLoading(false);
          return;
        }

        setOrgId(profile.org_id);
      } catch (err) {
        if (!mounted) return;

        setError(
          err?.message ||
            "Unable to load your account information."
        );
        setLoading(false);
      }
    };

    loadAuth();

    return () => {
      mounted = false;
    };
  }, [router]);

  /*
   * =========================================================
   * LOAD LOCATIONS + INVENTORY
   * =========================================================
   */

  useEffect(() => {
    if (!orgId) return;

    let mounted = true;

    const loadData = async () => {
      setLoading(true);
      setError("");

      try {
        const [
          {
            data: locData,
            error: locError,
          },
          {
            data: stockData,
            error: stockError,
          },
        ] = await Promise.all([
          supabase
            .from("locations")
            .select("*")
            .eq("org_id", orgId)
            .order("type")
            .order("name"),

          supabase
            .from("inventory_balances")
            .select(
              "quantity_on_hand, part_id, location_id, parts(part_no, sku, unit_cost)"
            )
            .eq("org_id", orgId)
            .gt("quantity_on_hand", 0),
        ]);

        if (!mounted) return;

        if (locError) {
          throw new Error(
            `Locations query failed: ${locError.message}`
          );
        }

        if (stockError) {
          throw new Error(
            `Inventory query failed: ${stockError.message}`
          );
        }

        setLocations(locData || []);
        setRows(stockData || []);
      } catch (err) {
        if (!mounted) return;

        setLocations([]);
        setRows([]);
        setError(
          err?.message ||
            "Unable to load locations."
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, [orgId]);

  /*
   * =========================================================
   * INVENTORY SUMMARY
   * =========================================================
   */

  const rowsForLocation = (locationId) => {
    return rows.filter(
      (row) => row.location_id === locationId
    );
  };

  const summaryFor = (locationId) => {
    const items = rowsForLocation(locationId);

    return {
      skuCount: items.length,

      totalQty: items.reduce(
        (sum, row) =>
          sum + Number(row.quantity_on_hand || 0),
        0
      ),

      totalValue: items.reduce(
        (sum, row) =>
          sum +
          Number(row.quantity_on_hand || 0) *
            Number(row.parts?.unit_cost || 0),
        0
      ),
    };
  };

  /*
   * =========================================================
   * LOADING
   * =========================================================
   */

  if (loading && !orgId) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="f-mono text-xs text-slate-500 uppercase tracking-widest">
          Loading...
        </div>
      </div>
    );
  }

  /*
   * =========================================================
   * PAGE
   * =========================================================
   */

  return (
    <Nav title="Locations">
      <div className="p-4 md:p-6">

        {error && (
          <div className="text-sm text-red-400 mb-3 border border-red-500/20 bg-red-500/5 rounded p-3">
            {error}
          </div>
        )}

        <Panel
          title="Locations"
          icon={Warehouse}
        >
          {loading ? (
            <div className="text-sm text-slate-500 p-2">
              Loading...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">

                <thead>
                  <tr>
                    <Th>Location</Th>
                    <Th>Type</Th>

                    <Th className="text-right">
                      Distinct Parts
                    </Th>

                    <Th className="text-right">
                      Total Qty
                    </Th>

                    <Th className="text-right">
                      Est. Value
                    </Th>

                    <Th></Th>
                  </tr>
                </thead>

                <tbody>
                  {locations.map((location) => {
                    const summary =
                      summaryFor(location.id);

                    return (
                      <tr
                        key={location.id}
                        className="border-t border-slate-800/70 hover:bg-slate-900/40"
                      >

                        {/* LOCATION */}

                        <Td className="text-slate-100">
                          <div className="flex items-center gap-1.5">
                            {location.type === "TRUCK" ? (
                              <Truck
                                size={13}
                                className="text-slate-500"
                              />
                            ) : (
                              <Warehouse
                                size={13}
                                className="text-slate-500"
                              />
                            )}

                            {location.name}
                          </div>
                        </Td>

                        {/* TYPE */}

                        <Td>
                          <Badge
                            className={
                              location.type ===
                              "WAREHOUSE"
                                ? "border-orange-400/30 text-orange-400"
                                : "border-sky-400/30 text-sky-400"
                            }
                          >
                            {location.type}
                          </Badge>
                        </Td>

                        {/* DISTINCT PARTS */}

                        <Td className="text-right f-mono text-slate-300">
                          {summary.skuCount}
                        </Td>

                        {/* TOTAL QTY */}

                        <Td className="text-right f-mono text-slate-200">
                          {summary.totalQty}
                        </Td>

                        {/* ESTIMATED VALUE */}

                        <Td className="text-right f-mono text-emerald-400">
                          {money(summary.totalValue)}
                        </Td>

                        {/* VIEW */}

                        <Td className="text-right">
                          <button
                            type="button"
                            onClick={() =>
                              router.push(
                                `/locations/${location.id}`
                              )
                            }
                            className="text-xs text-slate-500 hover:text-orange-400 transition-colors"
                          >
                            View
                          </button>
                        </Td>

                      </tr>
                    );
                  })}

                  {locations.length === 0 && (
                    <tr>
                      <Td
                        colSpan={6}
                        className="text-slate-500"
                      >
                        <div className="flex items-center gap-1.5">
                          <Package size={13} />
                          No locations yet.
                        </div>
                      </Td>
                    </tr>
                  )}
                </tbody>

              </table>
            </div>
          )}
        </Panel>

      </div>
    </Nav>
  );
}