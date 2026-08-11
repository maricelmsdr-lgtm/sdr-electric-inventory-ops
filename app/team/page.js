"use client";

import { useState, useEffect, useMemo } from "react";
import { Users, Search, Plus, Shield, Mail, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";
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
    // Share the real column names and I'll line this up exactly.
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
    <Nav
      title="Team"
      right={
        <button
          onClick={() => setShowAddUser(true)}
          className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
        >
          <Plus size={15} />
          Add User
        </button>
      }
    >
      <div className="p-4 md:p-6">
        {/* Tabs + Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-6 border-b border-slate-800">
            <button
              onClick={() => setTab("active")}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === "active"
                  ? "border-orange-500 text-orange-400"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setTab("inactive")}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === "inactive"
                  ? "border-orange-500 text-orange-400"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              Inactive
            </button>
          </div>

          <div className="relative">
            <Search
              size={15}
              className="text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users by username, email, or phone..."
              className="w-full md:w-80 pl-9 pr-3 py-2 text-sm bg-slate-900 border border-slate-800 rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
        </div>

        {/* Table */}
        <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-500 text-[10px] f-mono uppercase tracking-widest">
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
                    <td colSpan={6} className="px-5 py-10 text-center text-slate-600">
                      Loading...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-slate-600">
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
                        className="border-b border-slate-900 last:border-0 hover:bg-slate-900/40"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-orange-600 text-white flex items-center justify-center text-sm font-medium shrink-0">
                              {(u.username || "?")[0].toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium text-slate-200">
                                {u.username}
                              </div>
                              {u.role === "admin" && (
                                <div className="flex items-center gap-1 text-xs text-orange-400 mt-0.5">
                                  <Shield size={11} />
                                  Admin
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                            <Mail size={13} />
                            {u.email}
                          </div>
                          {u.phone && (
                            <div className="flex items-center gap-1.5 text-slate-400 text-xs mt-1">
                              <Phone size={13} />
                              {u.phone}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-orange-600/10 text-orange-400 text-xs font-medium">
                            {open}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-slate-800 text-slate-400 text-xs font-medium">
                            {closed}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-medium">
                            {open + closed}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button className="text-sm text-orange-400 hover:text-orange-300 font-medium">
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-slate-800 text-sm text-slate-500">
            <span>
              Showing {filtered.length ? 1 : 0} to {filtered.length} of{" "}
              {filtered.length} results
            </span>
            <div className="flex items-center gap-3">
              <span>Rows per page:</span>
              <select className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-sm text-slate-300">
                <option>10</option>
                <option>25</option>
                <option>50</option>
              </select>
              <button className="text-slate-700" disabled>
                Previous
              </button>
              <span>Page 1 of 1</span>
              <button className="text-slate-700" disabled>
                Next
              </button>
            </div>
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
    </Nav>
  );
}