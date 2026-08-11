"use client";

import { useState, useEffect } from "react";
import { X, Eye, EyeOff, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabaseClient"; // ASSUMPTION: adjust to your actual client path

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
    const supabase = createClient();
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
    const supabase = createClient();

    try {
      // 1. Create the auth user
      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email: email.trim(),
          password,
          email_confirm: true,
        });

      if (authError) throw authError;

      // 2. Create the profile row
      // ASSUMPTION: profiles table columns — adjust to your real schema
      const { error: profileError } = await supabase.from("profiles").insert({
        id: authData.user.id,
        username: username.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        location_id: locationId || null,
        role,
        job_access: jobAccess,
        purchase_access: purchaseAccess,
        cycle_count_access: cycleCountAccess,
        active: true,
      });

      if (profileError) throw profileError;

      onSaved?.();
    } catch (e) {
      setError(e.message || "Failed to create user.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2 sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-gray-900">Add User</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* User Name */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1.5">
              User Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1.5">
              Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1.5">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1.5">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1.5">
              Assign Location (Optional)
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="">Select a location...</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Select a location to assign to this user
            </p>
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1.5">
              Role <span className="text-red-500">*</span>
            </label>
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              <button
                type="button"
                onClick={() => setRole("technician")}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  role === "technician"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Technician
              </button>
              <button
                type="button"
                onClick={() => setRole("admin")}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  role === "admin"
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Admin
              </button>
            </div>

            {role === "technician" && (
              <div className="flex items-start gap-2 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <Smartphone className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800">
                  <span className="font-medium">Mobile access only.</span>{" "}
                  Technicians can only log in via the mobile app. They will
                  not have access to the web dashboard.
                </p>
              </div>
            )}
          </div>

          {/* Job Access */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Job Access
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="jobAccess"
                  checked={jobAccess === "all"}
                  onChange={() => setJobAccess("all")}
                  className="w-4 h-4 text-blue-600"
                />
                Access to All Jobs
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="jobAccess"
                  checked={jobAccess === "assigned"}
                  onChange={() => setJobAccess("assigned")}
                  className="w-4 h-4 text-blue-600"
                />
                Access to Assigned Jobs
              </label>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Permissions
            </label>
            <div className="space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={purchaseAccess}
                  onChange={(e) => setPurchaseAccess(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-blue-600 rounded"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    Purchase Access
                  </div>
                  <div className="text-xs text-gray-500">
                    Can create and view purchase orders
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cycleCountAccess}
                  onChange={(e) => setCycleCountAccess(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-blue-600 rounded"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    Cycle Count Access
                  </div>
                  <div className="text-xs text-gray-500">
                    Can perform and submit cycle counts
                  </div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
