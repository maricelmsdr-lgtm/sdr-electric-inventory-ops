"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  Warehouse,
  Truck,
  Package,
  ArrowDown,
  ArrowUp,
  ClipboardList,
  ShoppingCart,
  ArrowLeftRight,
  Sliders,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
import {
  Panel,
  Th,
  Td,
  Badge,
  SearchInput,
  money,
} from "@/components/ui";

const fmtDate = (d) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString()
    : "—";

const STATUS_STYLES = {
  Open: "border-slate-600 text-slate-400",
  Ordered: "border-sky-400/30 text-sky-400",
  Received: "border-emerald-400/30 text-emerald-400",
  Cancelled: "border-red-400/30 text-red-400",
};

const TABS = [
  {
    key: "stock",
    label: "Stock Level",
    icon: Package,
  },
  {
    key: "low",
    label: "Low Stock",
    icon: ClipboardList,
  },
  {
    key: "additions",
    label: "Additions",
    icon: ArrowDown,
  },
  {
    key: "purchases",
    label: "Purchases",
    icon: ShoppingCart,
  },
  {
    key: "transfersIn",
    label: "Transfers In",
    icon: ArrowLeftRight,
  },
  {
    key: "transfersOut",
    label: "Transfers Out",
    icon: ArrowLeftRight,
  },
  {
    key: "adjustments",
    label: "Adjustments",
    icon: Sliders,
  },
];

export default function LocationDetailPage() {
  const router = useRouter();
  const params = useParams();

  const locationId = params?.id;

  const [orgId, setOrgId] = useState(null);
  const [location, setLocation] = useState(null);
  const [stockRows, setStockRows] = useState([]);
  const [purchases, setPurchases] = useState([]);

  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);

  const [error, setError] = useState("");
  const [tab, setTab] = useState("stock");
  const [q, setQ] = useState("");

  /*
   * =========================================================
   * AUTH + ORGANIZATION
   * =========================================================
   */

  useEffect(() => {
    let mounted = true;

    const loadAuth = async () => {
      setAuthLoading(true);
      setError("");

      try {
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();

        if (!mounted) return;

        if (userErr) {
          setError(`Authentication error: ${userErr.message}`);
          return;
        }

        if (!user) {
          router.push("/login");
          return;
        }

        const {
          data: profile,
          error: profileErr,
        } = await supabase
          .from("profiles")
          .select("org_id")
          .eq("id", user.id)
          .single();

        if (!mounted) return;

        if (profileErr) {
          setError(`Profile error: ${profileErr.message}`);
          return;
        }

        if (!profile?.org_id) {
          setError(
            "No organization is assigned to your user profile."
          );
          return;
        }

        setOrgId(profile.org_id);
      } catch (e) {
        if (!mounted) return;

        setError(
          e?.message ||
            "Unable to load your account information."
        );
      } finally {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    };

    loadAuth();

    return () => {
      mounted = false;
    };
  }, [router]);

  /*
   * =========================================================
   * LOCATION DATA
   * =========================================================
   */

  useEffect(() => {
    if (!orgId || !locationId) return;

    fetchLocation();
  }, [orgId, locationId]);

  const fetchLocation = async () => {
    setDataLoading(true);
    setError("");

    try {
      const [
        {
          data: locData,
          error: locErr,
        },
        {
          data: stockData,
          error: stockErr,
        },
        {
          data: poData,
          error: poErr,
        },
      ] = await Promise.all([
        supabase
          .from("locations")
          .select("*")
          .eq("id", locationId)
          .eq("org_id", orgId)
          .single(),

        supabase
          .from("inventory_balances")
          .select(
            "quantity_on_hand, part_id, parts(part_no, sku, unit_cost, min_reorder)"
          )
          .eq("org_id", orgId)
          .eq("location_id", locationId),

        supabase
          .from("purchase_orders")
          .select(
            "*, po_line_items(*, parts(part_no, sku))"
          )
          .eq("delivery_location_id", locationId)
          .eq("org_id", orgId)
          .order("po_date", {
            ascending: false,
          }),
      ]);

      if (locErr) {
        throw new Error(
          `Location query failed: ${locErr.message}`
        );
      }

      if (stockErr) {
        throw new Error(
          `Inventory query failed: ${stockErr.message}`
        );
      }

      if (poErr) {
        throw new Error(
          `Purchase order query failed: ${poErr.message}`
        );
      }

      if (!locData) {
        throw new Error(
          "The requested location could not be found."
        );
      }

      setLocation(locData);
      setStockRows(stockData || []);
      setPurchases(poData || []);
    } catch (e) {
      setLocation(null);
      setStockRows([]);
      setPurchases([]);

      setError(
        e?.message ||
          "Unable to load location information."
      );
    } finally {
      setDataLoading(false);
    }
  };

  /*
   * =========================================================
   * PURCHASES
   * =========================================================
   *
   * Purchase orders are filtered by delivery_location_id.
   *
   * Received quantity currently follows the PO status:
   * - Received = full line quantity
   * - Anything else = 0
   *
   * Partial receiving is not represented here yet.
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
      qty: li.qty,
      unit_cost: li.unit_cost,
      received:
        po.status === "Received"
          ? li.qty
          : 0,
    }))
  );

  /*
   * =========================================================
   * STOCK CALCULATIONS
   * =========================================================
   */

  const filteredStock = stockRows.filter((row) => {
    const searchText = `
      ${row.parts?.part_no || ""}
      ${row.parts?.sku || ""}
    `.toLowerCase();

    return searchText.includes(q.toLowerCase());
  });

  const lowStockRows = stockRows.filter(
    (row) =>
      Number(row.quantity_on_hand || 0) <=
      Number(row.parts?.min_reorder || 0)
  );

  const productCount = stockRows.length;

  const inventoryOnHandQty = stockRows.reduce(
    (sum, row) =>
      sum + Number(row.quantity_on_hand || 0),
    0
  );

  const inventoryOnHandValue = stockRows.reduce(
    (sum, row) =>
      sum +
      Number(row.quantity_on_hand || 0) *
        Number(row.parts?.unit_cost || 0),
    0
  );

  /*
   * =========================================================
   * LOADING STATE
   * =========================================================
   */

  if (authLoading) {
    return (
      <Nav title="Location Detail">
        <div className="p-6 text-sm text-slate-500 f-mono uppercase tracking-widest">
          Loading account...
        </div>
      </Nav>
    );
  }

  if (!orgId) {
    return (
      <Nav title="Location Detail">
        <div className="p-6">
          <div className="text-sm text-red-400">
            {error ||
              "Unable to determine your organization."}
          </div>

          <button
            onClick={() => router.push("/locations")}
            className="mt-4 px-3 py-2 rounded border border-slate-700 text-sm text-slate-300 hover:bg-slate-800"
          >
            Back to Locations
          </button>
        </div>
      </Nav>
    );
  }

  if (dataLoading) {
    return (
      <Nav title="Location Detail">
        <div className="p-6">
          <div className="text-sm text-slate-500 f-mono uppercase tracking-widest">
            Loading location...
          </div>
        </div>
      </Nav>
    );
  }

  if (!location) {
    return (
      <Nav title="Location Detail">
        <div className="p-6">
          <div className="text-sm text-red-400">
            {error ||
              "Location could not be loaded."}
          </div>

          <button
            onClick={() => router.push("/locations")}
            className="mt-4 px-3 py-2 rounded border border-slate-700 text-sm text-slate-300 hover:bg-slate-800"
          >
            Back to Locations
          </button>
        </div>
      </Nav>
    );
  }

  /*
   * =========================================================
   * PAGE
   * =========================================================
   */

  return (
    <Nav title="Location Detail">
      <div className="p-4 md:p-6">

        {/* ================= HEADER ================= */}

        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => router.push("/locations")}
            className="p-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
            title="Back to Locations"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="flex items-center gap-2">
            {location.type === "TRUCK" ? (
              <Truck
                size={18}
                className="text-sky-400"
              />
            ) : (
              <Warehouse
                size={18}
                className="text-orange-400"
              />
            )}

            <span className="text-lg font-medium text-slate-100">
              {location.name}
            </span>

            <Badge
              className={
                location.type === "WAREHOUSE"
                  ? "border-orange-400/30 text-orange-400"
                  : "border-sky-400/30 text-sky-400"
              }
            >
              {location.type}
            </Badge>
          </div>
        </div>

        {/* ================= ERROR ================= */}

        {error && (
          <div className="text-sm text-red-400 mb-3 border border-red-500/20 bg-red-500/5 rounded p-3">
            {error}
          </div>
        )}

        {/* ================= SUMMARY CARDS ================= */}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">

          <Panel
            title="Products"
            icon={Package}
          >
            <div className="text-2xl f-mono text-slate-100">
              {productCount}
            </div>

            <div className="text-xs text-red-400 mt-1">
              {lowStockRows.length} low
            </div>
          </Panel>

          <Panel
            title="Material In"
            icon={ArrowDown}
          >
            <div className="text-2xl f-mono text-slate-100">
              0
            </div>

            <div className="text-xs text-slate-500 mt-1">
              Not tracked yet
            </div>
          </Panel>

          <Panel
            title="Material Out"
            icon={ArrowUp}
          >
            <div className="text-2xl f-mono text-slate-100">
              0
            </div>

            <div className="text-xs text-slate-500 mt-1">
              Not tracked yet
            </div>
          </Panel>

          <Panel
            title="Inventory On Hand"
            icon={ClipboardList}
          >
            <div className="text-2xl f-mono text-slate-100">
              {inventoryOnHandQty}
            </div>

            <div className="text-xs text-emerald-400 mt-1">
              {money(inventoryOnHandValue)}
            </div>
          </Panel>

        </div>

        {/* ================= TABS ================= */}

        <div className="flex gap-4 border-b border-slate-800 mb-4 text-sm overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;

            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
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

        {/* =====================================================
            STOCK LEVEL
        ===================================================== */}

        {tab === "stock" && (
          <Panel
            title="Stock Level"
            icon={Package}
          >
            <div className="mb-3">
              <SearchInput
                value={q}
                onChange={setQ}
                placeholder="Search line items..."
              />
            </div>

            {filteredStock.length === 0 ? (
              <div className="text-sm text-slate-500 p-2">
                No items found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Code/SKU</Th>
                      <Th className="text-right">
                        Avl
                      </Th>
                      <Th className="text-right">
                        Min
                      </Th>
                      <Th className="text-right">
                        Value
                      </Th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredStock.map((row) => (
                      <tr
                        key={`${row.part_id}-${row.location_id || locationId}`}
                        className="border-t border-slate-800/70"
                      >
                        <Td>
                          {row.parts?.part_no || "—"}
                        </Td>

                        <Td className="f-mono text-xs text-slate-400">
                          {row.parts?.sku || "—"}
                        </Td>

                        <Td className="text-right f-mono">
                          {row.quantity_on_hand}
                        </Td>

                        <Td className="text-right f-mono text-slate-500">
                          {row.parts?.min_reorder ??
                            "—"}
                        </Td>

                        <Td className="text-right f-mono">
                          {money(
                            Number(
                              row.quantity_on_hand || 0
                            ) *
                              Number(
                                row.parts?.unit_cost ||
                                  0
                              )
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}

        {/* =====================================================
            LOW STOCK
        ===================================================== */}

        {tab === "low" && (
          <Panel
            title="Low Stock"
            icon={ClipboardList}
          >
            {lowStockRows.length === 0 ? (
              <div className="text-sm text-slate-500 p-2">
                Nothing below min reorder at this
                location.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Code/SKU</Th>
                      <Th className="text-right">
                        Avl
                      </Th>
                      <Th className="text-right">
                        Min
                      </Th>
                    </tr>
                  </thead>

                  <tbody>
                    {lowStockRows.map((row) => (
                      <tr
                        key={`${row.part_id}-${row.location_id || locationId}`}
                        className="border-t border-slate-800/70"
                      >
                        <Td>
                          {row.parts?.part_no || "—"}
                        </Td>

                        <Td className="f-mono text-xs text-slate-400">
                          {row.parts?.sku || "—"}
                        </Td>

                        <Td className="text-right f-mono text-red-400">
                          {row.quantity_on_hand}
                        </Td>

                        <Td className="text-right f-mono text-slate-500">
                          {row.parts?.min_reorder ??
                            "—"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}

        {/* =====================================================
            PURCHASES
        ===================================================== */}

        {tab === "purchases" && (
          <Panel
            title="Purchases"
            icon={ShoppingCart}
          >
            {purchaseRows.length === 0 ? (
              <div className="text-sm text-slate-500 p-2">
                No purchase orders delivered to this
                location yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px]">
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
                    {purchaseRows.map((row, index) => (
                      <tr
                        key={`${row.po_id}-${row.part_no}-${index}`}
                        className="border-t border-slate-800/70"
                      >
                        <Td className="f-mono text-orange-400">
                          {row.po_no}
                        </Td>

                        <Td className="text-slate-400">
                          {fmtDate(row.po_date)}
                        </Td>

                        <Td>
                          {row.vendor || "—"}
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
                            {row.status || "Open"}
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

        {/* =====================================================
            ADDITIONS
        ===================================================== */}

        {tab === "additions" && (
          <Panel
            title="Additions"
            icon={ArrowDown}
          >
            <div className="text-sm text-slate-500 p-2">
              Not built yet — this will log manual
              stock-in additions at this location.
            </div>
          </Panel>
        )}

        {/* =====================================================
            TRANSFERS IN
        ===================================================== */}

        {tab === "transfersIn" && (
          <Panel
            title="Transfers In"
            icon={ArrowLeftRight}
          >
            <div className="text-sm text-slate-500 p-2">
              Not built yet — this will show transfers
              received at this location.
            </div>
          </Panel>
        )}

        {/* =====================================================
            TRANSFERS OUT
        ===================================================== */}

        {tab === "transfersOut" && (
          <Panel
            title="Transfers Out"
            icon={ArrowLeftRight}
          >
            <div className="text-sm text-slate-500 p-2">
              Not built yet — this will show transfers
              sent from this location.
            </div>
          </Panel>
        )}

        {/* =====================================================
            ADJUSTMENTS
        ===================================================== */}

        {tab === "adjustments" && (
          <Panel
            title="Adjustments"
            icon={Sliders}
          >
            <div className="text-sm text-slate-500 p-2">
              Not built yet — this will show manual
              inventory adjustments at this location.
            </div>
          </Panel>
        )}

      </div>
    </Nav>
  );
}