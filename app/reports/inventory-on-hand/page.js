"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Package,
  Download,
  FileText,
  Search,
  X,
} from "lucide-react";
import Nav from "@/components/Nav";

const CATEGORIES = ["Electrical", "Plumbing", "HVAC", "General"];

function money(value) {
  const n = Number(value || 0);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function number(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function escapeCsv(value) {
  const text = String(value ?? "");

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export default function InventoryOnHandPage() {
  const [orgId, setOrgId] = useState(null);

  const [parts, setParts] = useState([]);
  const [locations, setLocations] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [productFilter, setProductFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");

  const [sortField, setSortField] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  /*
   * ---------------------------------------------------------
   * AUTH / ORGANIZATION
   * ---------------------------------------------------------
   */

  useEffect(() => {
    let cancelled = false;

    async function loadOrganization() {
      try {
        setLoading(true);
        setError("");

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) {
          throw authError;
        }

        if (!user) {
          window.location.href = "/login";
          return;
        }

        const {
          data: profile,
          error: profileError,
        } = await supabase
          .from("profiles")
          .select("org_id")
          .eq("id", user.id)
          .single();

        if (profileError) {
          throw profileError;
        }

        if (!profile?.org_id) {
          throw new Error("No organization is assigned to this user.");
        }

        if (!cancelled) {
          setOrgId(profile.org_id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Unable to load organization.");
          setLoading(false);
        }
      }
    }

    loadOrganization();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * ---------------------------------------------------------
   * LOAD INVENTORY
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (!orgId) return;

    let cancelled = false;

    async function loadInventory() {
      try {
        setLoading(true);
        setError("");

        /*
         * We intentionally select * here because the current
         * SDR schema has evolved during the inventory-engine
         * work. This allows the report to work with the existing
         * parts records without depending on columns that may
         * differ between migrations.
         */

        const partsResult = await supabase
          .from("parts")
          .select("*")
          .eq("org_id", orgId);

        if (partsResult.error) {
          throw partsResult.error;
        }

        /*
         * Locations are optional for this report.
         *
         * If the locations table is not available or RLS blocks
         * it, the inventory report will still work using parts.
         */

        const locationsResult = await supabase
          .from("locations")
          .select("*")
          .eq("org_id", orgId);

        const loadedParts = partsResult.data || [];
        const loadedLocations =
          locationsResult.error || !locationsResult.data
            ? []
            : locationsResult.data;

        if (!cancelled) {
          setParts(loadedParts);
          setLocations(loadedLocations);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Unable to load inventory.");
          setParts([]);
          setLocations([]);
          setLoading(false);
        }
      }
    }

    loadInventory();

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  /*
   * ---------------------------------------------------------
   * LOCATION HELPERS
   * ---------------------------------------------------------
   */

  const locationMap = useMemo(() => {
    const map = new Map();

    for (const location of locations) {
      const id = location.id;

      if (!id) continue;

      map.set(
        id,
        location.name ||
          location.location_name ||
          location.title ||
          location.code ||
          id
      );
    }

    return map;
  }, [locations]);

  function getLocationId(part) {
    return (
      part.location_id ||
      part.locationId ||
      part.warehouse_id ||
      part.warehouseId ||
      null
    );
  }

  function getLocationName(part) {
    const locationId = getLocationId(part);

    if (locationId && locationMap.has(locationId)) {
      return locationMap.get(locationId);
    }

    return (
      part.location_name ||
      part.location ||
      part.warehouse_name ||
      part.warehouse ||
      "All Locations"
    );
  }

  /*
   * ---------------------------------------------------------
   * NORMALIZE PARTS
   * ---------------------------------------------------------
   */

  const inventoryRows = useMemo(() => {
    return parts.map((part) => {
      const qty = Number(
        part.qty ??
          part.quantity ??
          part.on_hand ??
          part.on_hand_qty ??
          0
      );

      const unitCost = Number(
        part.unit_cost ??
          part.cost ??
          part.average_cost ??
          part.avg_cost ??
          0
      );

      const productName =
        part.name ||
        part.part_name ||
        part.description ||
        part.product_name ||
        part.part_no ||
        "Unnamed Product";

      const productCode =
        part.sku ||
        part.part_no ||
        part.product_code ||
        part.code ||
        "";

      const uom =
        part.uom ||
        part.unit_of_measure ||
        part.unit ||
        "Nos";

      const category =
        part.category ||
        part.trade ||
        part.type ||
        "General";

      const locationId = getLocationId(part);

      const locationName = getLocationName(part);

      return {
        id: part.id,
        productName,
        productCode,
        uom,
        category,
        locationId,
        locationName,
        qty,
        unitCost,
        totalValue: qty * unitCost,
        raw: part,
      };
    });
  }, [parts, locationMap]);

  /*
   * ---------------------------------------------------------
   * FILTERS
   * ---------------------------------------------------------
   */

  const productOptions = useMemo(() => {
    const map = new Map();

    for (const row of inventoryRows) {
      const key = row.productCode || row.productName;

      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, {
          key,
          name: row.productName,
          code: row.productCode,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [inventoryRows]);

  const locationOptions = useMemo(() => {
    const names = new Set();

    for (const row of inventoryRows) {
      if (row.locationName) {
        names.add(row.locationName);
      }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [inventoryRows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return inventoryRows.filter((row) => {
      if (
        productFilter &&
        row.productCode !== productFilter &&
        row.productName !== productFilter
      ) {
        return false;
      }

      if (
        locationFilter &&
        row.locationName !== locationFilter
      ) {
        return false;
      }

      if (
        categoryFilter &&
        row.category !== categoryFilter
      ) {
        return false;
      }

      if (query) {
        const searchable = [
          row.productName,
          row.productCode,
          row.category,
          row.locationName,
          row.uom,
        ]
          .join(" ")
          .toLowerCase();

        if (!searchable.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [
    inventoryRows,
    productFilter,
    locationFilter,
    categoryFilter,
    search,
  ]);

  /*
   * ---------------------------------------------------------
   * SORTING
   * ---------------------------------------------------------
   */

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];

    rows.sort((a, b) => {
      let av;
      let bv;

      switch (sortField) {
        case "code":
          av = a.productCode;
          bv = b.productCode;
          break;

        case "category":
          av = a.category;
          bv = b.category;
          break;

        case "location":
          av = a.locationName;
          bv = b.locationName;
          break;

        case "qty":
          av = a.qty;
          bv = b.qty;
          break;

        case "unitCost":
          av = a.unitCost;
          bv = b.unitCost;
          break;

        case "value":
          av = a.totalValue;
          bv = b.totalValue;
          break;

        case "name":
        default:
          av = a.productName;
          bv = b.productName;
          break;
      }

      if (typeof av === "number" && typeof bv === "number") {
        return sortDirection === "asc"
          ? av - bv
          : bv - av;
      }

      return sortDirection === "asc"
        ? String(av ?? "").localeCompare(String(bv ?? ""))
        : String(bv ?? "").localeCompare(String(av ?? ""));
    });

    return rows;
  }, [filteredRows, sortField, sortDirection]);

  /*
   * ---------------------------------------------------------
   * SUMMARY
   * ---------------------------------------------------------
   */

  const totalQuantity = useMemo(
    () =>
      filteredRows.reduce(
        (sum, row) => sum + row.qty,
        0
      ),
    [filteredRows]
  );

  const totalValue = useMemo(
    () =>
      filteredRows.reduce(
        (sum, row) => sum + row.totalValue,
        0
      ),
    [filteredRows]
  );

  const uniqueProducts = useMemo(() => {
    const set = new Set();

    for (const row of filteredRows) {
      set.add(row.productCode || row.productName);
    }

    return set.size;
  }, [filteredRows]);

  /*
   * ---------------------------------------------------------
   * PAGINATION
   * ---------------------------------------------------------
   */

  const totalPages = Math.max(
    1,
    Math.ceil(sortedRows.length / pageSize)
  );

  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;

    return sortedRows.slice(
      start,
      start + pageSize
    );
  }, [sortedRows, safePage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [
    productFilter,
    locationFilter,
    categoryFilter,
    search,
    pageSize,
  ]);

  /*
   * ---------------------------------------------------------
   * SORT HANDLER
   * ---------------------------------------------------------
   */

  function handleSort(field) {
    if (sortField === field) {
      setSortDirection((current) =>
        current === "asc" ? "desc" : "asc"
      );
      return;
    }

    setSortField(field);
    setSortDirection("asc");
  }

  function sortIndicator(field) {
    if (sortField !== field) {
      return "↕";
    }

    return sortDirection === "asc" ? "↑" : "↓";
  }

  /*
   * ---------------------------------------------------------
   * EXPORT EXCEL
   * ---------------------------------------------------------
   */

  function exportExcel() {
    const rows = [
      [
        "Product Name",
        "Product Code",
        "Category",
        "Location",
        "UOM",
        "On Hand Qty",
        "Unit Cost",
        "Total Value",
      ],
      ...sortedRows.map((row) => [
        row.productName,
        row.productCode,
        row.category,
        row.locationName,
        row.uom,
        row.qty,
        row.unitCost,
        row.totalValue,
      ]),
    ];

    const csv = rows
      .map((row) =>
        row.map(escapeCsv).join(",")
      )
      .join("\n");

    downloadFile(
      csv,
      `inventory-on-hand-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`,
      "text/csv;charset=utf-8;"
    );
  }

  /*
   * ---------------------------------------------------------
   * EXPORT PDF
   * ---------------------------------------------------------
   *
   * Uses the browser print dialog so we don't introduce another
   * PDF library into the existing application.
   */

  function exportPdf() {
    const printWindow = window.open(
      "",
      "_blank",
      "width=1200,height=800"
    );

    if (!printWindow) {
      alert("Please allow popups to export the report.");
      return;
    }

    const rowsHtml = sortedRows
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.productName)}</td>
            <td>${escapeHtml(row.productCode)}</td>
            <td>${escapeHtml(row.category)}</td>
            <td>${escapeHtml(row.locationName)}</td>
            <td>${escapeHtml(row.uom)}</td>
            <td class="number">${number(row.qty)}</td>
            <td class="number">${money(row.unitCost)}</td>
            <td class="number">${money(row.totalValue)}</td>
          </tr>
        `
      )
      .join("");

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Inventory On Hand</title>

          <style>
            * {
              box-sizing: border-box;
            }

            body {
              font-family: Arial, sans-serif;
              padding: 32px;
              color: #111827;
            }

            h1 {
              margin: 0 0 8px;
              font-size: 24px;
            }

            .meta {
              color: #6b7280;
              font-size: 12px;
              margin-bottom: 24px;
            }

            .summary {
              display: flex;
              gap: 16px;
              margin-bottom: 24px;
            }

            .card {
              flex: 1;
              border: 1px solid #e5e7eb;
              border-radius: 8px;
              padding: 14px;
            }

            .label {
              color: #6b7280;
              font-size: 11px;
              margin-bottom: 6px;
            }

            .value {
              font-size: 20px;
              font-weight: 700;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 11px;
            }

            th {
              background: #f3f4f6;
              text-align: left;
              font-weight: 700;
            }

            th,
            td {
              border: 1px solid #e5e7eb;
              padding: 8px;
            }

            .number {
              text-align: right;
            }

            @media print {
              body {
                padding: 0;
              }
            }
          </style>
        </head>

        <body>
          <h1>Inventory On Hand</h1>

          <div class="meta">
            Generated ${new Date().toLocaleString()}
          </div>

          <div class="summary">
            <div class="card">
              <div class="label">Products</div>
              <div class="value">${uniqueProducts}</div>
            </div>

            <div class="card">
              <div class="label">Total Quantity</div>
              <div class="value">${number(totalQuantity)}</div>
            </div>

            <div class="card">
              <div class="label">Inventory Value</div>
              <div class="value">${money(totalValue)}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Product Code</th>
                <th>Category</th>
                <th>Location</th>
                <th>UOM</th>
                <th>On Hand Qty</th>
                <th>Unit Cost</th>
                <th>Total Value</th>
              </tr>
            </thead>

            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
    }, 300);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clearFilters() {
    setProductFilter("");
    setLocationFilter("");
    setCategoryFilter("");
    setSearch("");
    setPage(1);
  }

  /*
   * ---------------------------------------------------------
   * LOADING
   * ---------------------------------------------------------
   */

  if (!orgId && loading) {
    return (
      <Nav title="Inventory On Hand">
        <div className="min-h-full bg-slate-950 p-6">
          <div className="flex min-h-[300px] items-center justify-center">
            <div className="text-xs uppercase tracking-widest text-slate-500">
              Loading inventory...
            </div>
          </div>
        </div>
      </Nav>
    );
  }

  /*
   * ---------------------------------------------------------
   * PAGE
   * ---------------------------------------------------------
   */

  return (
    <Nav title="Inventory On Hand">
      <div className="min-h-full bg-slate-950 p-4 md:p-6">
        {/* HEADER */}

        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-wide text-slate-100">
              Inventory on Hand
            </h1>

            <p className="mt-1 text-xs text-slate-500">
              Current inventory quantities, locations, costs and
              valuation.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportExcel}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
            >
              <Download size={15} />
              Export Excel
            </button>

            <button
              type="button"
              onClick={exportPdf}
              className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-500"
            >
              <FileText size={15} />
              Export PDF
            </button>
          </div>
        </div>

        {/* KPI CARDS */}

        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Products
            </div>

            <div className="flex items-center justify-between">
              <div className="text-2xl font-semibold text-slate-100">
                {number(uniqueProducts)}
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
                <Package size={18} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Total Quantity
            </div>

            <div className="flex items-center justify-between">
              <div className="text-2xl font-semibold text-slate-100">
                {number(totalQuantity)}
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500/10 text-orange-400">
                <Package size={18} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Total Inventory Value
            </div>

            <div className="flex items-center justify-between">
              <div className="text-2xl font-semibold text-emerald-400">
                {money(totalValue)}
              </div>

              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                $
              </div>
            </div>
          </div>
        </div>

        {/* ERROR */}

        {error && (
          <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-400">
            <div className="font-semibold">
              Unable to load inventory
            </div>

            <div className="mt-1 text-xs text-red-400/80">
              {error}
            </div>
          </div>
        )}

        {/* FILTERS */}

        <div className="mb-5 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <div className="mb-4 text-xs font-medium uppercase tracking-widest text-slate-400">
            Filters
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {/* PRODUCT */}

            <div>
              <label className="mb-1.5 block text-xs text-slate-400">
                Products
              </label>

              <select
                value={productFilter}
                onChange={(event) =>
                  setProductFilter(event.target.value)
                }
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-orange-500"
              >
                <option value="">
                  All Products
                </option>

                {productOptions.map((product) => (
                  <option
                    key={product.key}
                    value={product.code || product.name}
                  >
                    {product.name}
                    {product.code
                      ? ` — ${product.code}`
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* LOCATION */}

            <div>
              <label className="mb-1.5 block text-xs text-slate-400">
                Locations
              </label>

              <select
                value={locationFilter}
                onChange={(event) =>
                  setLocationFilter(event.target.value)
                }
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-orange-500"
              >
                <option value="">
                  All Locations
                </option>

                {locationOptions.map((location) => (
                  <option
                    key={location}
                    value={location}
                  >
                    {location}
                  </option>
                ))}
              </select>
            </div>

            {/* CATEGORY */}

            <div>
              <label className="mb-1.5 block text-xs text-slate-400">
                Category
              </label>

              <select
                value={categoryFilter}
                onChange={(event) =>
                  setCategoryFilter(event.target.value)
                }
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-orange-500"
              >
                <option value="">
                  All Categories
                </option>

                {CATEGORIES.map((category) => (
                  <option
                    key={category}
                    value={category}
                  >
                    {category}
                  </option>
                ))}
              </select>
            </div>

            {/* SEARCH */}

            <div>
              <label className="mb-1.5 block text-xs text-slate-400">
                Search
              </label>

              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
                />

                <input
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Search products..."
                  className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-orange-500"
                />
              </div>
            </div>
          </div>

          {(productFilter ||
            locationFilter ||
            categoryFilter ||
            search) && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-orange-400"
              >
                <X size={13} />
                Clear Filters
              </button>
            </div>
          )}
        </div>

        {/* TABLE */}

        <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
          <div className="border-b border-slate-800 px-4 py-3">
            <div className="text-xs text-slate-400">
              Showing{" "}
              <span className="font-medium text-slate-200">
                {sortedRows.length}
              </span>{" "}
              {sortedRows.length === 1
                ? "product"
                : "products"}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/70">
                  <th
                    onClick={() => handleSort("name")}
                    className="cursor-pointer px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                  >
                    Product Name{" "}
                    {sortIndicator("name")}
                  </th>

                  <th
                    onClick={() => handleSort("code")}
                    className="cursor-pointer px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                  >
                    Product Code{" "}
                    {sortIndicator("code")}
                  </th>

                  <th
                    onClick={() =>
                      handleSort("category")
                    }
                    className="cursor-pointer px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                  >
                    Category{" "}
                    {sortIndicator("category")}
                  </th>

                  <th
                    onClick={() =>
                      handleSort("location")
                    }
                    className="cursor-pointer px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                  >
                    Location{" "}
                    {sortIndicator("location")}
                  </th>

                  <th
                    className="px-4 py-3 text-left text-[10px] font-medium uppercase tracking-widest text-slate-500"
                  >
                    UOM
                  </th>

                  <th
                    onClick={() => handleSort("qty")}
                    className="cursor-pointer px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                  >
                    On Hand Qty{" "}
                    {sortIndicator("qty")}
                  </th>

                  <th
                    onClick={() =>
                      handleSort("unitCost")
                    }
                    className="cursor-pointer px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                  >
                    Unit Cost{" "}
                    {sortIndicator("unitCost")}
                  </th>

                  <th
                    onClick={() => handleSort("value")}
                    className="cursor-pointer px-4 py-3 text-right text-[10px] font-medium uppercase tracking-widest text-slate-500 hover:text-slate-300"
                  >
                    Total Value{" "}
                    {sortIndicator("value")}
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-12 text-center text-xs text-slate-600"
                    >
                      Loading inventory...
                    </td>
                  </tr>
                ) : pageRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-12 text-center text-xs text-slate-600"
                    >
                      No inventory data available.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-800/70 transition hover:bg-slate-900/70"
                    >
                      <td className="px-4 py-3 text-xs font-medium text-slate-200">
                        {row.productName}
                      </td>

                      <td className="px-4 py-3 font-mono text-xs text-slate-400">
                        {row.productCode || "—"}
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-400">
                        {row.category}
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-400">
                        {row.locationName}
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-400">
                        {row.uom}
                      </td>

                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-200">
                        {number(row.qty)}
                      </td>

                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-400">
                        {money(row.unitCost)}
                      </td>

                      <td className="px-4 py-3 text-right font-mono text-xs font-medium text-emerald-400">
                        {money(row.totalValue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION */}

          <div className="flex flex-col gap-3 border-t border-slate-800 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-slate-500">
              Showing{" "}
              {sortedRows.length === 0
                ? 0
                : (safePage - 1) * pageSize + 1}{" "}
              to{" "}
              {Math.min(
                safePage * pageSize,
                sortedRows.length
              )}{" "}
              of {sortedRows.length} entries
            </div>

            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(event) =>
                  setPageSize(
                    Number(event.target.value)
                  )
                }
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300 outline-none"
              >
                <option value={10}>10 per page</option>
                <option value={25}>25 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
              </select>

              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage(1)}
                className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 hover:text-slate-200"
              >
                First
              </button>

              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() =>
                  setPage((current) =>
                    Math.max(1, current - 1)
                  )
                }
                className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 hover:text-slate-200"
              >
                Previous
              </button>

              <div className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
                {safePage}
              </div>

              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() =>
                  setPage((current) =>
                    Math.min(totalPages, current + 1)
                  )
                }
                className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 hover:text-slate-200"
              >
                Next
              </button>

              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage(totalPages)}
                className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-500 disabled:cursor-not-allowed disabled:opacity-40 hover:text-slate-200"
              >
                Last
              </button>
            </div>
          </div>
        </div>
      </div>
    </Nav>
  );
}