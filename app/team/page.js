"use client";

import { useState, useEffect, useMemo } from "react";
import { Users, Search, Plus, Shield, Mail, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AddUserModal from "./AddUserModal";

export default function TeamPage() {
  const [tab, setTab] = useState("active"); // "active" | "inactive"
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);

  useEffect(() => {
    loadUsers();
  }, [tab]);

  async function loadUsers() {
    setLoading(true);

    // ASSUMPTION: profiles table has: id, username, email, phone, role,
    // active (bool), org_id. Job counts come from a `jobs` table with
    // `assigned_to` (profile id) and `status` ('open' | 'closed').
    // Adjust field names to match your real schema.
    const { data, error } = await supabase
      .from("profiles")
      .select(
        `
        id,
        username,
        email,
        phone,
        role,
        active,
        jobs_open:jobs!jobs_assigned_to_fkey(count),
        jobs_closed:jobs!jobs_assigned_to_fkey(count)
      `
      )
      .eq("active", tab === "active");

    if (!error && data) {
      setUsers(data);
    } else if (error) {
      console.error("[team] failed to load users:", error.message);
      setUsers([]);
    }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.username?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.phone?.toLowerCase().includes(q)
    );
  }, [users, search]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              User Management
            </h1>
            <p className="text-sm text-gray-500">
              Manage your technicians and team members
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAddUser(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-6 border-b border-gray-200 -mb-px">
          <button
            onClick={() => setTab("active")}
            className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${
              tab === "active"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <span className="w-3.5 h-3.5 rounded-full border-2 border-current flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
            </span>
            Active
          </button>
          <button
            onClick={() => setTab("inactive")}
            className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${
              tab === "inactive"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <span className="w-3.5 h-3.5 rounded-full border-2 border-current" />
            Inactive
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users by username, email, or phone..."
            className="w-80 pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <th className="text-left font-medium px-5 py-3">Username</th>
              <th className="text-left font-medium px-5 py-3">
                Contact Info
              </th>
              <th className="text-center font-medium px-5 py-3">Open</th>
              <th className="text-center font-medium px-5 py-3">Closed</th>
              <th className="text-center font-medium px-5 py-3">Total</th>
              <th className="text-right font-medium px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-gray-400">
                  No {tab} users found.
                </td>
              </tr>
            ) : (
              filtered.map((u) => {
                const open = u.jobs_open?.[0]?.count ?? 0;
                const closed = u.jobs_closed?.[0]?.count ?? 0;
                return (
                  <tr
                    key={u.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">
                          {(u.username || "?")[0].toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">
                            {u.username}
                          </div>
                          {u.role === "admin" && (
                            <div className="flex items-center gap-1 text-xs text-purple-600 mt-0.5">
                              <Shield className="w-3 h-3" />
                              Admin
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 text-gray-600 text-xs">
                        <Mail className="w-3.5 h-3.5" />
                        {u.email}
                      </div>
                      {u.phone && (
                        <div className="flex items-center gap-1.5 text-gray-600 text-xs mt-1">
                          <Phone className="w-3.5 h-3.5" />
                          {u.phone}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                        {open}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                        {closed}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                        {open + closed}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 text-sm text-gray-500">
          <span>
            Showing {filtered.length ? 1 : 0} to {filtered.length} of{" "}
            {filtered.length} results
          </span>
          <div className="flex items-center gap-3">
            <span>Rows per page:</span>
            <select className="border border-gray-200 rounded-md px-2 py-1 text-sm">
              <option>10</option>
              <option>25</option>
              <option>50</option>
            </select>
            <button className="text-gray-400" disabled>
              Previous
            </button>
            <span>Page 1 of 1</span>
            <button className="text-gray-400" disabled>
              Next
            </button>
          </div>
        </div>
      </div>

      {showAddUser && (
        <AddUserModal
          onClose={() => setShowAddUser(false)}
          onSaved={() => {
            setShowAddUser(false);
            loadUsers();
          }}
        />
      )}
    </div>
  );
}
