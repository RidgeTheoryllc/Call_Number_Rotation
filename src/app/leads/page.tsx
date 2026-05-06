"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { AppShell } from "@/components/app-shell";
import type { LeadRecord } from "@/types";
import { useTwilioDevice } from "@/hooks/useTwilioDevice";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function LeadsPage() {
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [callingLeadIds, setCallingLeadIds] = useState<Record<string, boolean>>({});
  const [deletingLeadIds, setDeletingLeadIds] = useState<Record<string, boolean>>({});
  const [leadPendingDelete, setLeadPendingDelete] = useState<LeadRecord | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Record<string, boolean>>({});
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "warn"; message: string } | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [twilioIdentityHint, setTwilioIdentityHint] = useState("");
  const [autoDialEnabled, setAutoDialEnabled] = useState(false);
  const autoDialLockRef = useRef(false);
  const { identity, deviceReady, callStatus, activeCall, deviceError, hangup, mute } = useTwilioDevice(twilioIdentityHint);
  const showCallControls = callStatus === "ringing" || callStatus === "in-progress";
  const LEADS_PER_PAGE = 10;
  const supabase = getSupabaseBrowserClient();

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const showToast = useCallback((tone: "success" | "warn", message: string) => {
    setToast({ tone, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 3500);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const totalPages = Math.max(1, Math.ceil(leads.length / LEADS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * LEADS_PER_PAGE;
  const paginatedLeads = leads.slice(pageStart, pageStart + LEADS_PER_PAGE);

  useEffect(() => {
    if (callStatus !== "in-progress") return;
    const timer = window.setInterval(() => {
      setCallDurationSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [callStatus]);

  const load = useCallback(async () => {
    if (!userId) {
      setLeads([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/leads?user_id=${encodeURIComponent(userId)}`);
      const json = await res.json();
      if (res.ok) setLeads(json);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const bootstrap = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in to view leads.");
        setLeads([]);
        setIsLoading(false);
        return;
      }
      setUserId(user.id);
      setTwilioIdentityHint(`agent-${user.id}`);
    };
    void bootstrap();
  }, [supabase]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const addLead = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId) { setError("You must be signed in to add leads."); return; }
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, user_id: userId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Failed to add lead.");
      return;
    }

    const insertedCount = Number(json.inserted_count ?? 0);
    const skippedDuplicates = Number(json.skipped_duplicates ?? 0);
    if (insertedCount > 0 && skippedDuplicates > 0) {
      showToast("warn", `Added ${insertedCount} lead. Skipped ${skippedDuplicates} duplicate number.`);
    } else if (insertedCount > 0) {
      showToast("success", `Lead added successfully.`);
    } else {
      showToast("warn", `Lead not added because the number already exists.`);
    }

    setName("");
    setPhone("");
    load();
    setCurrentPage(1);
  };

  const onCsvUpload = async (file: File) => {
    if (!userId) { setError("You must be signed in to upload leads."); return; }
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

    const pickField = (row: Record<string, string>, candidates: string[]) => {
      const normalizedEntries = Object.entries(row).map(([key, value]) => [
        key.trim().toLowerCase().replace(/[_\s-]+/g, ""),
        value,
      ] as const);
      for (const candidate of candidates) {
        const normalizedCandidate = candidate.trim().toLowerCase().replace(/[_\s-]+/g, "");
        const matched = normalizedEntries.find(([normalizedKey]) => normalizedKey === normalizedCandidate);
        if (matched?.[1]) return String(matched[1]).trim();
      }
      return "";
    };

    const valid = parsed.data
      .map((row) => {
        const phoneValue = pickField(row, ["phone", "phonenumber", "phone_number", "mobile", "telephone", "tel"]);
        const nameValue = pickField(row, ["name", "fullname", "full_name", "firstname", "first_name"]);
        if (!phoneValue) return null;
        return {
          name: nameValue || "Unknown",
          phone: phoneValue,
          user_id: userId,
        };
      })
      .filter((row): row is { name: string; phone: string; user_id: string } => row !== null);

    if (valid.length === 0) {
      setError("No valid rows found. Make sure your CSV has a phone column (e.g., Phone, Phone number, mobile).");
      return;
    }

    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valid),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Failed to import CSV leads.");
      return;
    }

    const insertedCount = Number(json.inserted_count ?? 0);
    const skippedDuplicates = Number(json.skipped_duplicates ?? 0);
    if (skippedDuplicates > 0) {
      showToast("warn", `Imported ${insertedCount} lead(s). Skipped ${skippedDuplicates} duplicate number(s).`);
    } else {
      showToast("success", `Imported ${insertedCount} lead(s) successfully.`);
    }

    load();
    setCurrentPage(1);
  };

  const dialLead = useCallback(async (lead: LeadRecord) => {
    if (callingLeadIds[lead.id]) return;
    setCallingLeadIds((prev) => ({ ...prev, [lead.id]: true }));
    setError("");
    setCallDurationSeconds(0);
    try {
      const rotateRes = await fetch("/api/rotate-did", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadPhone: lead.phone, user_id: userId }),
      });
      const rotateData = await rotateRes.json();
      if (!rotateRes.ok) { setError(rotateData.error ?? "Failed to rotate DID."); setAutoDialEnabled(false); return; }

      const callRes = await fetch("/api/twilio/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: lead.phone, callerId: rotateData.did, agentIdentity: identity, leadId: lead.id, user_id: userId }),
      });
      const callData = await callRes.json();
      if (!callRes.ok) { setError(callData.error ?? "Call failed."); setAutoDialEnabled(false); return; }

      await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead.id, user_id: userId, status: "dialed", assigned_did: rotateData.did }),
      });
      await load();
      setCurrentPage(1);
    } finally {
      setCallingLeadIds((prev) => ({ ...prev, [lead.id]: false }));
    }
  }, [callingLeadIds, identity, load, userId]);

  const deleteLead = useCallback(async (lead: LeadRecord) => {
    if (!userId || deletingLeadIds[lead.id]) return;
    setDeletingLeadIds((prev) => ({ ...prev, [lead.id]: true }));
    setError("");
    try {
      const res = await fetch("/api/leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead.id, user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to delete lead."); return; }
      await load();
    } finally {
      setDeletingLeadIds((prev) => ({ ...prev, [lead.id]: false }));
    }
  }, [deletingLeadIds, load, userId]);

  const confirmDeleteLead = useCallback(async () => {
    if (!leadPendingDelete) return;
    await deleteLead(leadPendingDelete);
    setLeadPendingDelete(null);
  }, [deleteLead, leadPendingDelete]);

  const selectedCount = Object.values(selectedLeadIds).filter(Boolean).length;
  const selectedOnPageCount = paginatedLeads.filter((lead) => selectedLeadIds[lead.id]).length;
  const allOnPageSelected = paginatedLeads.length > 0 && selectedOnPageCount === paginatedLeads.length;

  const toggleLeadSelected = (leadId: string) => {
    setSelectedLeadIds((prev) => ({ ...prev, [leadId]: !prev[leadId] }));
  };

  const toggleSelectPage = () => {
    setSelectedLeadIds((prev) => {
      const next = { ...prev };
      if (allOnPageSelected) {
        paginatedLeads.forEach((lead) => {
          delete next[lead.id];
        });
      } else {
        paginatedLeads.forEach((lead) => {
          next[lead.id] = true;
        });
      }
      return next;
    });
  };

  const deleteSelectedLeads = useCallback(async () => {
    if (!userId || selectedCount === 0 || isBulkDeleting) return;
    setIsBulkDeleting(true);
    setError("");
    try {
      const ids = Object.entries(selectedLeadIds)
        .filter(([, selected]) => selected)
        .map(([id]) => id);
      const res = await fetch("/api/leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to delete selected leads.");
        return;
      }
      setSelectedLeadIds({});
      await load();
    } finally {
      setIsBulkDeleting(false);
      setBulkDeletePending(false);
    }
  }, [isBulkDeleting, load, selectedCount, selectedLeadIds, userId]);

  useEffect(() => {
    if (!autoDialEnabled) return;
    if (!userId || !identity || !deviceReady) return;
    if (activeCall) return;
    const shouldRun = callStatus === "idle" || callStatus === "ready" || callStatus === "completed";
    if (!shouldRun || isLoading) return;
    if (autoDialLockRef.current) return;
    const isDialing = Object.values(callingLeadIds).some(Boolean);
    if (isDialing) return;
    const nextLead = leads.find((lead) => lead.status === "pending");
    if (!nextLead) { window.setTimeout(() => { setAutoDialEnabled(false); }, 0); return; }
    autoDialLockRef.current = true;
    window.setTimeout(() => {
      void dialLead(nextLead).finally(() => { autoDialLockRef.current = false; });
    }, 0);
  }, [activeCall, autoDialEnabled, callStatus, callingLeadIds, deviceReady, dialLead, identity, isLoading, leads, userId]);

  return (
    <AppShell>
      <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">

        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Leads</h1>
            <p className="mt-0.5 text-sm text-slate-500">Import, route, and execute calls against pending leads.</p>
          </div>
          <div className="flex items-center gap-3">
            {selectedCount > 0 ? (
              <button
                type="button"
                onClick={() => setBulkDeletePending(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-rose-600 px-3 text-xs font-semibold text-white transition hover:bg-rose-700"
              >
                Delete selected ({selectedCount})
              </button>
            ) : null}
            <span className="text-sm font-medium text-slate-500">
              {leads.length} total lead{leads.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Device Status Bar */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            {/* Device ready pill */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                deviceReady
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${deviceReady ? "bg-emerald-500" : "bg-rose-500"}`} />
              {deviceReady ? "Device ready" : "Device not ready"}
            </span>

            {/* Identity */}
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              {identity || "loading…"}
            </span>

            {/* Call status */}
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
              {callStatus}
            </span>

            {/* Duration — only when in-progress */}
            {callStatus === "in-progress" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {formatDuration(callDurationSeconds)}
              </span>
            )}

            {/* Spacer pushes auto-dial to the right */}
            <div className="flex-1" />

            {/* Auto-dial toggle */}
            <button
              type="button"
              onClick={() => { setError(""); setAutoDialEnabled((prev) => !prev); }}
              disabled={!deviceReady || !identity || isLoading}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                autoDialEnabled
                  ? "border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${autoDialEnabled ? "bg-white" : "bg-slate-400"}`} />
              Auto Dial {autoDialEnabled ? "On" : "Off"}
            </button>
          </div>

          {/* Device error */}
          {deviceError && (
            <div className="border-t border-slate-100 px-4 py-2">
              <p className="text-xs font-medium text-rose-600">{deviceError}</p>
            </div>
          )}

          {/* In-call controls */}
          {showCallControls && (
            <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2">
              <button
                onClick={() => { const next = !isMuted; mute(next); setIsMuted(next); }}
                disabled={!activeCall}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isMuted ? (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/></svg>
                ) : (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>
                )}
                {isMuted ? "Unmute" : "Mute"}
              </button>
              <button
                onClick={() => { hangup(); setCallDurationSeconds(0); }}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67m-2.67-3.34a19.79 19.79 0 01-3.07-8.63A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/></svg>
                Hang Up
              </button>
            </div>
          )}
        </div>

        {/* Add Lead Form */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Add Lead</h2>
          <form onSubmit={addLead} className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1" style={{ minWidth: "160px" }}>
              <label className="text-xs font-medium text-slate-500">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                required
                className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1" style={{ minWidth: "160px" }}>
              <label className="text-xs font-medium text-slate-500">Phone</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 415 555 0102"
                required
                className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">CSV Import</label>
              <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-100">
                <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload CSV
                <input
                  type="file"
                  accept=".csv"
                  className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsvUpload(f); }}
                />
              </label>
            </div>
            <button
              type="submit"
              className="h-9 rounded-md bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Add Lead
            </button>
          </form>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {error}
          </div>
        )}

        {/* Leads Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="w-10 px-2 py-2.5 text-left">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectPage}
                    aria-label="Select all leads on page"
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                {["Name", "Phone", "Area Code", "Status", "Assigned DID", "Result", "Actions"].map((col) => (
                  <th
                    key={col}
                    className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${col === "Actions" ? "text-right" : ""}`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                      Loading leads…
                    </span>
                  </td>
                </tr>
              )}
              {!isLoading && leads.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">
                    No leads yet. Add a lead above or upload a CSV to get started.
                  </td>
                </tr>
              )}
              {paginatedLeads.map((lead) => (
                <tr key={lead.id} className="transition hover:bg-slate-50/70">
                  <td className="px-2 py-3">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedLeadIds[lead.id])}
                      onChange={() => toggleLeadSelected(lead.id)}
                      aria-label={`Select ${lead.name}`}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{lead.name}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{lead.phone}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.area_code}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        lead.status === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : lead.status === "dialed"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{lead.assigned_did ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.result ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        disabled={Boolean(callingLeadIds[lead.id]) || !deviceReady || !identity}
                        onClick={() => dialLead(lead)}
                        className="inline-flex h-7 w-20 items-center justify-center rounded-md bg-blue-50 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {callingLeadIds[lead.id]
                          ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
                          : lead.status === "completed" ? "Redial" : "Dial Now"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(deletingLeadIds[lead.id]) || Boolean(callingLeadIds[lead.id])}
                        onClick={() => setLeadPendingDelete(lead)}
                        aria-label={`Delete ${lead.name}`}
                        title="Delete lead"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-50 text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingLeadIds[lead.id] ? (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-rose-300 border-t-rose-700" />
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                            <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {leads.length > LEADS_PER_PAGE && (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-sm text-slate-500">
              Showing{" "}
              <span className="font-semibold text-slate-800">{pageStart + 1}</span>–
              <span className="font-semibold text-slate-800">{Math.min(pageStart + LEADS_PER_PAGE, leads.length)}</span>{" "}
              of{" "}
              <span className="font-semibold text-slate-800">{leads.length}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage === 1}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span className="px-3 py-1 text-sm font-medium text-slate-700">
                {safeCurrentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage === totalPages}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      {leadPendingDelete || bulkDeletePending ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-rose-100">
              <svg className="h-5 w-5 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </div>
            <h2 className="text-base font-semibold text-slate-900">
              {leadPendingDelete ? "Delete this lead?" : `Delete ${selectedCount} selected leads?`}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {leadPendingDelete ? (
                <>
                  <span className="font-medium text-slate-800">{leadPendingDelete.name}</span> will be permanently removed from your leads list.
                </>
              ) : (
                <>This will permanently remove all selected leads from your leads list.</>
              )}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setLeadPendingDelete(null);
                  setBulkDeletePending(false);
                }}
                className="h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (leadPendingDelete) {
                    void confirmDeleteLead();
                    return;
                  }
                  void deleteSelectedLeads();
                }}
                disabled={leadPendingDelete ? Boolean(deletingLeadIds[leadPendingDelete.id]) : isBulkDeleting}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {(leadPendingDelete ? Boolean(deletingLeadIds[leadPendingDelete.id]) : isBulkDeleting) && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-rose-300 border-t-white" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="pointer-events-none fixed right-5 top-5 z-70">
          <div
            className={`max-w-md rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg ${
              toast.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}