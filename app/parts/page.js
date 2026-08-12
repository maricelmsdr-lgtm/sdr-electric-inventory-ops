"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Package,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  Warehouse,
  ImagePlus,
  Truck,
  MoreVertical,
  Wrench,
  Layers,
  FolderOpen,
  CheckCircle2,
  CircleOff,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { uploadOrgFile, getPublicUrl } from "@/lib/storage";
import Nav from "@/components/Nav";
import {
  Panel,
  Th,
  Td,
  Badge,
  TradeBadge,
  IconBtn,
  PrimaryBtn,
  SearchInput,
  ConfirmModal,
  ModalShell,
  Field,
  inputCls,
} from "@/components/ui";

const emptyPart = {
  part_no: "",
  sku: "",
  category: "Electrical",
  location: "",
  min_reorder: 0,
  unit_cost: 0,
  description: "",
  photo_path: null,
};

const CATEGORIES = ["Electrical", "Plumbing", "HVAC", "General"];
const PAGE_SIZE = 200;

const TABS = [
  { key: "products", label: "Products", icon: Package },
  { key: "services", label: "Services", icon: Wrench },
  { key: "kits", label: "Kits", icon: Layers },
  { key: "categories", label: "Categories", icon: FolderOpen },
];

const STOCK_FILTERS = [
  { key: "all", label: "All", icon: Package },
  { key: "in_stock", label: "In Stock", icon: CheckCircle2 },
  { key: "out_of_stock", label: "Out of Stock", icon: CircleOff },
];

function PartsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);

  const [parts, setParts] = useState([]);
  const [matchCount, setMatchCount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);

  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  const [lowStockOnly, setLowStockOnly] = useState(
    searchParams.get("lowStock") === "1"
  );

  const [stockFilter, setStockFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [modal, setModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [locModal, setLocModal] = useState(null);

  const [error, setError] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [tab, setTab] = useState("products");
  const [selected, setSelected] = useState(new Set());
  const [actionsOpen, setActionsOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  /*
   * REAL INVENTORY
   *
   * {
   *   [part_id]: {
   *      warehouse: number,
   *      truck: number
   *   }
   * }
   */
  const [inventoryByType, setInventoryByType] = useState({});

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      setUser(user);

      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      setOrgId(profile?.org_id || null);
    })();
  }, [router]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim());
    }, 300);

    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!orgId) return;
    fetchParts();
  }, [orgId, debouncedQ, lowStockOnly, categoryFilter]);

  useEffect(() => {
    if (!orgId) return;
    fetchLowStockCount();
  }, [orgId]);

  /*
   * =========================================================
   * FETCH PARTS
   * =========================================================
   */
  const fetchParts = async () => {
    setLoading(true);
    setError("");

    let query = supabase
      .from("parts")
      .select("*", { count: "exact" })
      .eq("org_id", orgId);

    if (lowStockOnly) {
      query = query.eq("is_low_stock", true);
    }

    if (categoryFilter) {
      query = query.eq("category", categoryFilter);
    }

    if (debouncedQ) {
      const term = debouncedQ.replace(/[%,]/g, "\\$&");

      query = query.or(
        `part_no.ilike.%${term}%,sku.ilike.%${term}%,location.ilike.%${term}%,description.ilike.%${term}%,category.ilike.%${term}%`
      );
    }

    const { data, error, count } = await query
      .order("part_no")
      .limit(PAGE_SIZE);

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const partList = data || [];

    setParts(partList);
    setMatchCount(count ?? partList.length);

    await fetchInventoryByType(partList);

    setLoading(false);
  };

  /*
   * =========================================================
   * INVENTORY BY LOCATION TYPE
   * =========================================================
   *
   * Uses inventory_balances as the source of truth.
   *
   * Warehouse quantities are summed separately from truck
   * quantities.
   */
  const fetchInventoryByType = async (partsList) => {
    if (partsList.length === 0) {
      setInventoryByType({});
      return;
    }

    const partIds = partsList.map((p) => p.id);

    const { data, error } = await supabase
      .from("inventory_balances")
      .select("part_id, quantity_on_hand, locations(type)")
      .eq("org_id", orgId)
      .in("part_id", partIds);

    if (error) {
      setError(error.message);
      return;
    }

    const map = {};

    for (const row of data || []) {
      const pid = row.part_id;

      if (!map[pid]) {
        map[pid] = {
          warehouse: 0,
          truck: 0,
        };
      }

      const type = row.locations?.type;

      if (type === "WAREHOUSE") {
        map[pid].warehouse += Number(row.quantity_on_hand || 0);
      }

      if (type === "TRUCK") {
        map[pid].truck += Number(row.quantity_on_hand || 0);
      }
    }

    setInventoryByType(map);
  };

  /*
   * =========================================================
   * LOW STOCK COUNT
   * =========================================================
   */
  const fetchLowStockCount = async () => {
    const { count, error } = await supabase
      .from("parts")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("org_id", orgId)
      .eq("is_low_stock", true);

    if (!error) {
      setLowStockCount(count ?? 0);
    }
  };

  /*
   * =========================================================
   * INVENTORY STATUS
   * =========================================================
   *
   * This is intentionally calculated from inventory_balances.
   *
   * IN STOCK:
   * Warehouse + Truck > 0
   *
   * OUT OF STOCK:
   * Warehouse + Truck <= 0
   */
  const getInventory = (partId) => {
    return (
      inventoryByType[partId] || {
        warehouse: 0,
        truck: 0,
      }
    );
  };

  const getTotalStock = (partId) => {
    const inv = getInventory(partId);

    return Number(inv.warehouse || 0) + Number(inv.truck || 0);
  };

  /*
   * Apply the stock toggle to the currently loaded products.
   *
   * We do this client-side because inventory is stored in
   * inventory_balances and is already loaded for the visible
   * parts.
   */
  const displayedParts = parts.filter((p) => {
    const totalStock = getTotalStock(p.id);

    if (stockFilter === "in_stock") {
      return totalStock > 0;
    }

    if (stockFilter === "out_of_stock") {
      return totalStock <= 0;
    }

    return true;
  });

  /*
   * =========================================================
   * CREATE / EDIT / DELETE
   * =========================================================
   */
  const openCreate = () => {
    setModal({
      mode: "create",
      data: { ...emptyPart },
    });
  };

  const openEdit = (p) => {
    setModal({
      mode: "edit",
      data: { ...p },
    });

    setOpenMenuId(null);
  };

  const openLocations = async (p) => {
    setLocModal({
      part: p,
      rows: null,
    });

    setOpenMenuId(null);

    const { data, error } = await supabase
      .from("inventory_balances")
      .select("quantity_on_hand, locations(id, name, type)")
      .eq("part_id", p.id)
      .order("quantity_on_hand", {
        ascending: false,
      });

    if (error) {
      setLocModal({
        part: p,
        rows: [],
        error: error.message,
      });

      return;
    }

    setLocModal({
      part: p,
      rows: (data || []).filter(
        (r) => Number(r.quantity_on_hand || 0) !== 0
      ),
    });
  };

  const save = async () => {
    const d = modal.data;

    setError("");

    if (modal.mode === "create") {
      const { error } = await supabase
        .from("parts")
        .insert({
          ...d,
          org_id: orgId,
        });

      if (error) {
        setError(error.message);
        return;
      }

      await logActivity(
        `Added part ${d.part_no} — ${d.sku}`
      );
    } else {
      const {
        id,
        qty,
        is_low_stock,
        ...rest
      } = d;

      const { error } = await supabase
        .from("parts")
        .update(rest)
        .eq("id", id);

      if (error) {
        setError(error.message);
        return;
      }

      await logActivity(
        `Updated part ${d.part_no}`
      );
    }

    setModal(null);

    await fetchParts();
    await fetchLowStockCount();
  };

  const remove = async () => {
    const { error } = await supabase
      .from("parts")
      .delete()
      .eq("id", confirmDelete.id);

    if (!error) {
      await logActivity(
        `Deleted part ${confirmDelete.part_no}`
      );
    }

    setConfirmDelete(null);
    setOpenMenuId(null);

    await fetchParts();
    await fetchLowStockCount();
  };

  const logActivity = async (message) => {
    if (!user || !orgId) return;

    await supabase
      .from("activity_log")
      .insert({
        org_id: orgId,
        user_id: user.id,
        message,
      });
  };

  /*
   * =========================================================
   * PHOTO
   * =========================================================
   */
  const handlePhotoChange = async (file) => {
    if (!file) return;

    setUploadingPhoto(true);
    setError("");

    try {
      const path = await uploadOrgFile(
        "part-photos",
        orgId,
        file
      );

      setModal((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          photo_path: path,
        },
      }));
    } catch (e) {
      setError(
        e.message || "Photo upload failed."
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  /*
   * =========================================================
   * SELECTION
   * =========================================================
   */
  const toggleSelect = (id) => {
    const next = new Set(selected);

    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    setSelected(next);
  };

  const toggleSelectAll = () => {
    if (
      displayedParts.length > 0 &&
      selected.size === displayedParts.length
    ) {
      setSelected(new Set());
    } else {
      setSelected(
        new Set(displayedParts.map((p) => p.id))
      );
    }
  };

  /*
   * =========================================================
   * LOADING
   * =========================================================
   */
  if (!orgId) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="f-mono text-xs text-slate-500 uppercase tracking-widest">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <Nav title="Parts Management">
      <div className="p-4 md:p-6">

        {/* ================= HEADER ================= */}

        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-orange-500/15 flex items-center justify-center">
                <Package
                  size={18}
                  className="text-orange-400"
                />
              </div>

              <div>
                <div className="text-lg font-medium text-slate-100">
                  Parts Management
                </div>

                <div className="text-xs text-slate-500">
                  Manage your parts and services efficiently
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <PrimaryBtn onClick={openCreate}>
              <Plus size={15} />
              Add Part
            </PrimaryBtn>

            <div className="relative">
              <button
                onClick={() =>
                  setActionsOpen((v) => !v)
                }
                className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1.5"
              >
                Actions
              </button>

              {actionsOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-slate-900 border border-slate-800 rounded shadow-lg z-10 text-sm">
                  <div className="px-3 py-2 text-slate-500 text-xs">
                    Bulk actions — coming soon
                    {selected.size > 0 &&
                      ` (${selected.size} selected)`}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ================= TABS ================= */}

        <div className="flex gap-4 border-b border-slate-800 mb-4 text-sm">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-2 px-1 flex items-center gap-1.5 ${
                tab === t.key
                  ? "text-orange-400 border-b-2 border-orange-500"
                  : "text-slate-500"
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>

        {/* ================= PRODUCTS ================= */}

        {tab === "products" && (
          <>
            {/* ================= FILTER BAR ================= */}

            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">

              <div className="flex items-center gap-2 flex-wrap">

                <SearchInput
                  value={q}
                  onChange={setQ}
                  placeholder="Search part no, SKU, location..."
                />

                <select
                  className={`${inputCls} w-auto`}
                  value={categoryFilter}
                  onChange={(e) =>
                    setCategoryFilter(e.target.value)
                  }
                >
                  <option value="">
                    All Categories
                  </option>

                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                {/* ================= STOCK TOGGLE ================= */}

                <div className="flex items-center rounded border border-slate-700 bg-slate-950 overflow-hidden">

                  {STOCK_FILTERS.map((filter) => {
                    const Icon = filter.icon;
                    const active =
                      stockFilter === filter.key;

                    return (
                      <button
                        key={filter.key}
                        onClick={() =>
                          setStockFilter(filter.key)
                        }
                        className={`px-2.5 py-1.5 text-[11px] f-mono flex items-center gap-1.5 border-r last:border-r-0 border-slate-700 transition-colors ${
                          active
                            ? filter.key === "in_stock"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : filter.key === "out_of_stock"
                              ? "bg-red-500/15 text-red-400"
                              : "bg-orange-500/15 text-orange-400"
                            : "text-slate-500 hover:text-slate-300 hover:bg-slate-900"
                        }`}
                      >
                        <Icon size={12} />
                        {filter.label}
                      </button>
                    );
                  })}

                </div>

                {lowStockOnly && (
                  <button
                    onClick={() =>
                      setLowStockOnly(false)
                    }
                    className="text-[11px] f-mono text-red-300 bg-red-500/10 border border-red-500/30 px-2 py-1.5 rounded hover:bg-red-500/15"
                  >
                    Low stock only ✕
                  </button>
                )}

              </div>

              {/* ================= LOW STOCK ================= */}

              {lowStockCount > 0 && (
                <button
                  onClick={() =>
                    setLowStockOnly((v) => !v)
                  }
                  className={`flex items-center gap-1.5 text-[11px] f-mono px-2.5 py-1.5 rounded border ${
                    lowStockOnly
                      ? "text-red-300 bg-red-500/20 border-red-500/50"
                      : "text-red-400 bg-red-500/10 border-red-500/30 hover:bg-red-500/15"
                  }`}
                >
                  <AlertTriangle size={12} />
                  {lowStockCount} LOW STOCK
                </button>
              )}

            </div>

            {/* ================= FILTER SUMMARY ================= */}

            <div className="flex items-center justify-between mb-3 text-xs">

              <div className="text-slate-500">
                {stockFilter === "in_stock" && (
                  <>
                    Showing parts with available stock
                  </>
                )}

                {stockFilter === "out_of_stock" && (
                  <>
                    Showing parts with zero stock
                  </>
                )}

                {stockFilter === "all" && (
                  <>
                    Showing all parts
                  </>
                )}
              </div>

              <div className="f-mono text-slate-600">
                {displayedParts.length} shown
              </div>

            </div>

            {error && (
              <div className="text-sm text-red-400 mb-3">
                {error}
              </div>
            )}

            {/* ================= PRODUCTS TABLE ================= */}

            <Panel
              title="Products"
              icon={Package}
            >
              {matchCount > parts.length && (
                <div className="text-xs text-slate-500 mb-3">
                  Showing the first {parts.length} of{" "}
                  {matchCount} matching parts — refine your
                  search to narrow further.
                </div>
              )}

              {loading ? (
                <div className="text-sm text-slate-500 p-2">
                  Loading parts...
                </div>
              ) : (
                <div className="overflow-x-auto">

                  <table className="w-full min-w-[1080px]">

                    <thead>
                      <tr>

                        <Th>
                          <input
                            type="checkbox"
                            checked={
                              displayedParts.length > 0 &&
                              selected.size ===
                                displayedParts.length
                            }
                            onChange={
                              toggleSelectAll
                            }
                          />
                        </Th>

                        <Th></Th>

                        <Th>Details</Th>

                        <Th>Code/SKU</Th>

                        <Th>Category</Th>

                        <Th className="text-right">
                          Min/Max
                        </Th>

                        <Th className="text-right">
                          Inventory
                        </Th>

                        <Th className="text-right">
                          Pricing
                        </Th>

                        <Th></Th>

                      </tr>
                    </thead>

                    <tbody>

                      {displayedParts.map((p) => {

                        const inv =
                          getInventory(p.id);

                        const totalStock =
                          getTotalStock(p.id);

                        const isOutOfStock =
                          totalStock <= 0;

                        return (
                          <tr
                            key={p.id}
                            className={`border-t border-slate-800/70 hover:bg-slate-900/40 ${
                              p.qty <= p.min_reorder
                                ? "bg-red-500/5"
                                : ""
                            }`}
                          >

                            {/* SELECT */}

                            <Td>
                              <input
                                type="checkbox"
                                checked={selected.has(
                                  p.id
                                )}
                                onChange={() =>
                                  toggleSelect(p.id)
                                }
                              />
                            </Td>

                            {/* PHOTO */}

                            <Td>
                              {p.photo_path ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={getPublicUrl(
                                    "part-photos",
                                    p.photo_path
                                  )}
                                  alt={p.part_no}
                                  className="w-9 h-9 rounded object-cover border border-slate-700"
                                />
                              ) : (
                                <div className="w-9 h-9 rounded border border-slate-800 bg-slate-950 flex items-center justify-center text-slate-700">
                                  <ImagePlus
                                    size={14}
                                  />
                                </div>
                              )}
                            </Td>

                            {/* DETAILS */}

                            <Td>

                              <div className="flex items-center gap-1.5">

                                <span className="text-slate-100">
                                  {p.part_no}
                                </span>

                                {isOutOfStock ? (
                                  <Badge className="border-red-400/30 text-red-400 text-[10px]">
                                    OUT OF STOCK
                                  </Badge>
                                ) : p.qty <=
                                  p.min_reorder ? (
                                  <Badge className="border-red-400/30 text-red-400 text-[10px]">
                                    LOW
                                  </Badge>
                                ) : null}

                              </div>

                              {p.description && (
                                <div className="text-xs text-slate-500">
                                  {p.description}
                                </div>
                              )}

                            </Td>

                            {/* SKU */}

                            <Td>

                              <div className="flex flex-col gap-1">

                                <span className="f-mono text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded w-fit">
                                  {p.part_no}
                                </span>

                                <span className="f-mono text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded w-fit">
                                  {p.sku}
                                </span>

                              </div>

                            </Td>

                            {/* CATEGORY */}

                            <Td>
                              <TradeBadge
                                category={p.category}
                              />
                            </Td>

                            {/* MIN / MAX */}

                            <Td className="text-right">

                              <div className="text-xs">

                                <div className="text-red-400">
                                  MIN {p.min_reorder}
                                </div>

                                <div className="text-emerald-400">
                                  MAX —
                                </div>

                              </div>

                            </Td>

                            {/* INVENTORY */}

                            <Td className="text-right">

                              <div className="flex flex-col items-end gap-1">

                                <div
                                  className={`text-xs f-mono font-medium ${
                                    isOutOfStock
                                      ? "text-red-400"
                                      : "text-emerald-400"
                                  }`}
                                >
                                  {isOutOfStock
                                    ? "OUT OF STOCK"
                                    : `${totalStock} TOTAL`}
                                </div>

                                <div className="flex items-center justify-end gap-3 text-xs f-mono">

                                  <span
                                    className="flex items-center gap-1 text-slate-400"
                                    title="Warehouse"
                                  >
                                    <Warehouse size={12} />
                                    {inv.warehouse}
                                  </span>

                                  <span
                                    className="flex items-center gap-1 text-slate-400"
                                    title="Truck"
                                  >
                                    <Truck size={12} />
                                    {inv.truck}
                                  </span>

                                </div>

                              </div>

                            </Td>

                            {/* PRICING */}

                            <Td className="text-right">

                              <div className="text-xs">

                                <div className="text-sky-400">
                                  BUY $
                                  {Number(
                                    p.unit_cost || 0
                                  ).toFixed(2)}
                                </div>

                                <div className="text-slate-600">
                                  SALE —
                                </div>

                              </div>

                            </Td>

                            {/* ACTIONS */}

                            <Td>

                              <div className="relative flex justify-end">

                                <IconBtn
                                  onClick={() =>
                                    setOpenMenuId(
                                      openMenuId ===
                                        p.id
                                        ? null
                                        : p.id
                                    )
                                  }
                                >
                                  <MoreVertical
                                    size={14}
                                  />
                                </IconBtn>

                                {openMenuId ===
                                  p.id && (
                                  <div className="absolute right-0 top-8 w-40 bg-slate-900 border border-slate-800 rounded shadow-lg z-10 text-sm">

                                    <button
                                      onClick={() =>
                                        openLocations(p)
                                      }
                                      className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2"
                                    >
                                      <Warehouse
                                        size={13}
                                      />
                                      By Location
                                    </button>

                                    <button
                                      onClick={() =>
                                        openEdit(p)
                                      }
                                      className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2"
                                    >
                                      <Pencil
                                        size={13}
                                      />
                                      Edit
                                    </button>

                                    <button
                                      onClick={() => {
                                        setConfirmDelete(
                                          p
                                        );
                                        setOpenMenuId(
                                          null
                                        );
                                      }}
                                      className="w-full text-left px-3 py-2 hover:bg-slate-800 text-red-400 flex items-center gap-2"
                                    >
                                      <Trash2
                                        size={13}
                                      />
                                      Delete
                                    </button>

                                  </div>
                                )}

                              </div>

                            </Td>

                          </tr>
                        );
                      })}

                      {/* EMPTY */}

                      {displayedParts.length === 0 && (
                        <tr>
                          <Td
                            colSpan={9}
                            className="text-slate-500"
                          >
                            {stockFilter ===
                            "in_stock"
                              ? "No parts currently have stock."
                              : stockFilter ===
                                "out_of_stock"
                              ? "No parts are currently out of stock."
                              : debouncedQ ||
                                lowStockOnly ||
                                categoryFilter
                              ? "No parts match your search."
                              : "No parts yet — add your first one above."}
                          </Td>
                        </tr>
                      )}

                    </tbody>

                  </table>

                </div>
              )}

            </Panel>
          </>
        )}

        {/* ================= SERVICES ================= */}

        {tab === "services" && (
          <Panel
            title="Services"
            icon={Wrench}
          >
            <div className="text-sm text-slate-500 p-2">
              Not built yet — services (labor,
              non-stock line items) need their own data
              model, separate from physical parts.
              Future session.
            </div>
          </Panel>
        )}

        {/* ================= KITS ================= */}

        {tab === "kits" && (
          <Panel
            title="Kits"
            icon={Layers}
          >
            <div className="text-sm text-slate-500 p-2">
              Not built yet — kits (bundles of multiple
              parts sold/used together) need their own
              data model. Future session.
            </div>
          </Panel>
        )}

        {/* ================= CATEGORIES ================= */}

        {tab === "categories" && (
          <Panel
            title="Categories"
            icon={FolderOpen}
          >
            <div className="text-sm text-slate-500 p-2">
              Categories currently live as a fixed list
              on each part (
              {CATEGORIES.join(", ")}). A dedicated
              categories management view (add/rename/
              reorder) would need its own table —
              future session.
            </div>
          </Panel>
        )}

      </div>

      {/* ================= CREATE / EDIT MODAL ================= */}

      {modal && (
        <ModalShell
          title={`${
            modal.mode === "create"
              ? "Add"
              : "Edit"
          } Part`}
          icon={Package}
          onClose={() => setModal(null)}
        >

          <Field label="Part No.">
            <input
              className={inputCls}
              value={modal.data.part_no}
              onChange={(e) =>
                setModal({
                  ...modal,
                  data: {
                    ...modal.data,
                    part_no: e.target.value,
                  },
                })
              }
            />
          </Field>

          <Field label="SKU">
            <input
              className={inputCls}
              value={modal.data.sku}
              onChange={(e) =>
                setModal({
                  ...modal,
                  data: {
                    ...modal.data,
                    sku: e.target.value,
                  },
                })
              }
            />
          </Field>

          <Field label="Category">
            <select
              className={inputCls}
              value={modal.data.category}
              onChange={(e) =>
                setModal({
                  ...modal,
                  data: {
                    ...modal.data,
                    category: e.target.value,
                  },
                })
              }
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>

          <Field label="Shelf / Bin (optional)">
            <input
              className={inputCls}
              value={modal.data.location || ""}
              onChange={(e) =>
                setModal({
                  ...modal,
                  data: {
                    ...modal.data,
                    location: e.target.value,
                  },
                })
              }
              placeholder="e.g. Shelf A3, Bin 12"
            />
          </Field>

          <Field label="Min Reorder">
            <input
              type="number"
              className={inputCls}
              value={modal.data.min_reorder}
              onChange={(e) =>
                setModal({
                  ...modal,
                  data: {
                    ...modal.data,
                    min_reorder: Number(
                      e.target.value
                    ),
                  },
                })
              }
            />
          </Field>

          <Field label="Unit Cost ($)">
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={modal.data.unit_cost}
              onChange={(e) =>
                setModal({
                  ...modal,
                  data: {
                    ...modal.data,
                    unit_cost: Number(
                      e.target.value
                    ),
                  },
                })
              }
            />
          </Field>

          <Field label="Description">
            <input
              className={inputCls}
              value={
                modal.data.description || ""
              }
              onChange={(e) =>
                setModal({
                  ...modal,
                  data: {
                    ...modal.data,
                    description:
                      e.target.value,
                  },
                })
              }
            />
          </Field>

          <Field label="Photo (optional)">
            <div className="flex items-center gap-3">

              {modal.data.photo_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getPublicUrl(
                    "part-photos",
                    modal.data.photo_path
                  )}
                  alt=""
                  className="w-14 h-14 rounded object-cover border border-slate-700"
                />
              ) : (
                <div className="w-14 h-14 rounded border border-dashed border-slate-700 bg-slate-950 flex items-center justify-center text-slate-700">
                  <ImagePlus size={18} />
                </div>
              )}

              <input
                type="file"
                accept="image/*"
                onChange={(e) =>
                  handlePhotoChange(
                    e.target.files?.[0]
                  )
                }
                disabled={uploadingPhoto}
                className="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-slate-700 file:bg-slate-900 file:text-slate-300 file:text-xs"
              />

            </div>

            {uploadingPhoto && (
              <div className="text-xs text-slate-500 mt-1">
                Uploading...
              </div>
            )}
          </Field>

          {modal.mode === "create" && (
            <div className="text-xs text-slate-500 -mt-1 mb-3">
              New parts start at 0 on hand — use{" "}
              <span className="text-orange-400">
                Stock In
              </span>{" "}
              afterward to receive quantity into a
              location.
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4">

            <button
              onClick={() => setModal(null)}
              className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>

            <PrimaryBtn
              onClick={save}
              disabled={uploadingPhoto}
            >
              Save
            </PrimaryBtn>

          </div>

        </ModalShell>
      )}

      {/* ================= LOCATION MODAL ================= */}

      {locModal && (
        <ModalShell
          title={`${locModal.part.part_no} — By Location`}
          icon={Warehouse}
          onClose={() => setLocModal(null)}
        >

          {locModal.rows === null ? (
            <div className="text-sm text-slate-500">
              Loading...
            </div>
          ) : locModal.error ? (
            <div className="text-sm text-red-400">
              {locModal.error}
            </div>
          ) : locModal.rows.length === 0 ? (
            <div className="text-sm text-slate-500">
              Not currently stocked anywhere. Use
              Stock In to receive it.
            </div>
          ) : (
            <div className="space-y-2">

              {locModal.rows.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between border border-slate-800 rounded px-3 py-2"
                >

                  <div>
                    <div className="text-sm text-slate-200">
                      {r.locations?.name ||
                        "Unknown"}
                    </div>

                    <div className="text-[10px] f-mono text-slate-600 uppercase">
                      {r.locations?.type ||
                        "LOCATION"}
                    </div>
                  </div>

                  <span className="f-mono text-sm text-orange-400">
                    {r.quantity_on_hand}
                  </span>

                </div>
              ))}

            </div>
          )}

          <div className="flex justify-end mt-4">

            <button
              onClick={() => setLocModal(null)}
              className="px-3.5 py-2 text-sm rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Close
            </button>

          </div>

        </ModalShell>
      )}

      {/* ================= DELETE MODAL ================= */}

      {confirmDelete && (
        <ConfirmModal
          title="Delete Part"
          message={`Delete "${confirmDelete.part_no}"? This can't be undone.`}
          onCancel={() =>
            setConfirmDelete(null)
          }
          onConfirm={remove}
        />
      )}

    </Nav>
  );
}

export default function PartsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center">
          <div className="f-mono text-xs text-slate-500 uppercase tracking-widest">
            Loading...
          </div>
        </div>
      }
    >
      <PartsPageInner />
    </Suspense>
  );
}