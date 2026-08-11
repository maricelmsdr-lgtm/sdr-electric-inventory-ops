"use client";

import { useState, useEffect } from "react";
import { X, Eye, EyeOff, Smartphone } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function AddUserModal({ onClose, onSaved }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState([]);
  const [role, setRole] = useState("technician"); // "technician" | "admin"
  const [jobAccess, setJobAccess] = useState("assigned"); // "all" | "assigned"
  const [purchaseAccess, setPurchaseAccess] = useState(false);
  const [cycleCountAccess, setCycleCountAccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadLocations();
  }, []);

  async function loadLocations() {
    // ASSUMPTION: locations table has id, name — adjust to your schema
    const { data } = await supabase.from("locations").select("id, name");
    setLocations(data || []);
  }

  async function handleSave() {
    setError("");

    if (!username.trim()) return setError("User name is required.");
    if (!password.trim()) return setError("Password is required.");
    if (!email.trim()) return setError("Email is required.");

    setSaving(true);

    try {
      const res = await fetch("/api/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password,
          phone: phone.trim(),
          locationId,
          role,
          jobAccess,
          purchaseAccess,
          cycleCountAccess,
          // ASSUMPTION: you'll need to pass the current admin's org_id
          // here somehow — e.g. from a session/auth context — so the
          // new user gets created under the right organization.
        }),
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.error || "Failed to create user.");
      }

      onSaved?.();
    } catch (e) {
      setError(e.message || "Failed to create user.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-950 border border-slate-800 rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2 sticky top-0 bg-slate-950">
          <h2 className="f-display uppercase text-base text-slate-100 tracking-wide">
            Add User
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-900 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* User Name */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              User Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-slate-900 border border-slate-800 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Password <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 text-sm bg-slate-900 border border-slate-800 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Email <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-slate-900 border border-slate-800 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-slate-900 border border-slate-800 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Assign Location (Optional)
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-slate-900 border border-slate-800 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
            >
              <option value="">Select a location...</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Select a location to assign to this user
            </p>
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Role <span className="text-red-400">*</span>
            </label>
            <div className="flex rounded overflow-hidden border border-slate-800">
              <button
                type="button"
                onClick={() => setRole("technician")}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  role === "technician"
                    ? "bg-orange-600 text-white"
                    : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                }`}
              >
                Technician
              </button>
              <button
                type="button"
                onClick={() => setRole("admin")}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  role === "admin"
                    ? "bg-orange-600 text-white"
                    : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                }`}
              >
                Admin
              </button>
            </div>

            {role === "technician" && (
              <div className="flex items-start gap-2 mt-3 bg-amber-500/10 border border-amber-900 rounded px-3 py-2.5">
                <Smartphone size={15} className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-400">
                  <span className="font-medium">Mobile access only.</span>{" "}
                  Technicians can only log in via the mobile app. They will
                  not have access to the web dashboard.
                </p>
              </div>
            )}
          </div>

          {/* Job Access */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Job Access
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="jobAccess"
                  checked={jobAccess === "all"}
                  onChange={() => setJobAccess("all")}
                  className="w-4 h-4 accent-orange-600"
                />
                Access to All Jobs
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="jobAccess"
                  checked={jobAccess === "assigned"}
                  onChange={() => setJobAccess("assigned")}
                  className="w-4 h-4 accent-orange-600"
                />
                Access to Assigned Jobs
              </label>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Permissions
            </label>
            <div className="space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={purchaseAccess}
                  onChange={(e) => setPurchaseAccess(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-orange-600 rounded"
                />
                <div>
                  <div className="text-sm font-medium text-slate-200">
                    Purchase Access
                  </div>
                  <div className="text-xs text-slate-500">
                    Can create and view purchase orders
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cycleCountAccess}
                  onChange={(e) => setCycleCountAccess(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-orange-600 rounded"
                />
                <div>
                  <div className="text-sm font-medium text-slate-200">
                    Cycle Count Access
                  </div>
                  <div className="text-xs text-slate-500">
                    Can perform and submit cycle counts
                  </div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-800 sticky bottom-0 bg-slate-950">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-slate-300 border border-slate-800 rounded hover:bg-slate-900"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2.5 text-sm font-medium text-white bg-orange-600 rounded hover:bg-orange-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}