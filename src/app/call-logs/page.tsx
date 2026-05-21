"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { CallbackSchedulePicker } from "@/components/callback-schedule-picker";
import { useWorkspaceDataCache } from "@/components/workspace-data-cache";
import { isoToDatetimeLocalValue, parseDatetimeLocalValue } from "@/lib/callback-schedule";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { CallLogRecord, LeadRecord } from "@/types";

const LOGS_PER_PAGE = 10;

export default function CallLogsPage() {
  const [logs, setLogs] = useState<CallLogRecord[]>([]);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scheduleLead, setScheduleLead] = useState<LeadRecord | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "warn"; message: string } | null>(null);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const workspaceCache = useWorkspaceDataCache();

  const showToast = useCallback((tone: "success" | "warn", message: string) => {
    setToast({ tone, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!scheduleLead) return;
    queueMicrotask(() => {
      setScheduleNotes(scheduleLead.callback_notes ?? "");
      setScheduleAt(
        scheduleLead.callback_at
          ? isoToDatetimeLocalValue(scheduleLead.callback_at)
          : isoToDatetimeLocalValue(new Date(Date.now() + 15 * 60 * 1000).toISOString()),
      );
    });
  }, [scheduleLead]);

  const loadLogs = useCallback(
    async (resolvedUserId?: string | null) => {
      let activeUserId = resolvedUserId;
      if (!activeUserId) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        activeUserId = user?.id ?? null;
      }

      if (!activeUserId) {
        setError("You must be signed in to view call logs.");
        setLogs([]);
        return;
      }

      setUserId(activeUserId);
      const res = await fetch(`/api/call-logs?user_id=${encodeURIComponent(activeUserId)}`);
      const json = await res.json();
      if (res.ok) {
        const nextLogs = json as CallLogRecord[];
        setLogs(nextLogs);
        workspaceCache.setCachedCallLogs(activeUserId, nextLogs);
        setError("");
      } else {
        setError(json.error ?? "Failed to load call logs.");
      }
    },
    [supabase, workspaceCache],
  );

  const openScheduleFromLog = useCallback(
    async (log: CallLogRecord) => {
      if (!userId) return;
      if (!log.lead_id) {
        showToast("warn", "No lead matches this number. Add them on the Leads page first.");
        return;
      }
      setError("");
      let lead = workspaceCache.getCachedLeads(userId)?.find((l) => l.id === log.lead_id);
      if (!lead) {
        const res = await fetch(`/api/leads?user_id=${encodeURIComponent(userId)}`);
        const json = await res.json();
        if (!res.ok) {
          setError((json as { error?: string }).error ?? "Failed to load leads.");
          return;
        }
        const rows = json as LeadRecord[];
        workspaceCache.setCachedLeads(userId, rows);
        lead = rows.find((l) => l.id === log.lead_id);
      }
      if (!lead) {
        showToast("warn", "That lead no longer exists. It may have been deleted.");
        return;
      }
      setScheduleLead(lead);
    },
    [showToast, userId, workspaceCache],
  );

  const saveCallbackSchedule = async () => {
    if (!userId || !scheduleLead) return;
    if (!scheduleAt.trim()) {
      showToast("warn", "Pick a date and time for the callback.");
      return;
    }
    const parsed = parseDatetimeLocalValue(scheduleAt);
    if (!parsed) {
      showToast("warn", "That date and time is not valid.");
      return;
    }
    setScheduleSaving(true);
    setError("");
    try {
      const res = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: scheduleLead.id,
          user_id: userId,
          callback_at: parsed.toISOString(),
          callback_notes: scheduleNotes.trim() ? scheduleNotes.trim() : null,
        }),
      });
      const json = (await res.json()) as LeadRecord & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to save callback.");
        return;
      }
      showToast("success", "Callback scheduled.");
      setScheduleLead(null);
      const updated = json as LeadRecord;
      const cached = workspaceCache.getCachedLeads(userId);
      if (cached) {
        workspaceCache.setCachedLeads(
          userId,
          cached.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)),
        );
      }
      await loadLogs(userId);
    } finally {
      setScheduleSaving(false);
    }
  };

  const clearCallbackSchedule = async () => {
    if (!userId || !scheduleLead) return;
    setScheduleSaving(true);
    setError("");
    try {
      const res = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: scheduleLead.id,
          user_id: userId,
          callback_at: null,
          callback_notes: null,
        }),
      });
      const json = (await res.json()) as LeadRecord & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to clear callback.");
        return;
      }
      showToast("success", "Callback schedule cleared.");
      setScheduleLead(null);
      const updated = json as LeadRecord;
      const cached = workspaceCache.getCachedLeads(userId);
      if (cached) {
        workspaceCache.setCachedLeads(
          userId,
          cached.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)),
        );
      }
      await loadLogs(userId);
    } finally {
      setScheduleSaving(false);
    }
  };

  const formatDuration = (value: number | null) => {
    if (value == null) return "-";
    const mins = Math.floor(value / 60);
    const secs = value % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const getResultTone = (result: CallLogRecord["result"]) => {
    if (result === "answered") return "bg-emerald-100 text-emerald-700";
    if (result === "no_answer" || result === "busy") return "bg-amber-100 text-amber-700";
    if (result === "failed" || result === "spam_flagged") return "bg-rose-100 text-rose-700";
    return "bg-slate-100 text-slate-700";
  };

  const getDirectionTone = (direction?: CallLogRecord["direction"]) => {
    if (direction === "inbound") return "bg-violet-100 text-violet-700";
    return "bg-cyan-100 text-cyan-700";
  };

  const totalPages = Math.max(1, Math.ceil(logs.length / LOGS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * LOGS_PER_PAGE;
  const paginatedLogs = logs.slice(pageStart, pageStart + LOGS_PER_PAGE);

  useEffect(() => {
    const bootstrap = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in to view call logs.");
        setLogs([]);
        return;
      }
      setUserId(user.id);
    };
    void bootstrap();
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    const cached = workspaceCache.getCachedCallLogs(userId);
    if (cached !== null) {
      queueMicrotask(() => {
        setLogs(cached);
      });
      return;
    }
    const timer = window.setTimeout(() => {
      void loadLogs(userId);
    }, 0);
    return () => clearTimeout(timer);
  }, [userId, workspaceCache, loadLogs]);

  useEffect(() => {
    if (!userId) return;
    const intervalId = window.setInterval(() => {
      void loadLogs(userId);
    }, 10000);
    return () => clearInterval(intervalId);
  }, [userId, loadLogs]);

  const downloadCsv = () => {
    const formatPhoneForCsv = (phone: string) => {
      const cleaned = phone.trim();
      if (!cleaned) return "";
      return `'${cleaned}`;
    };

    const escapeCsv = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const headers = ["Lead Name", "Phone", "DID Used", "Direction", "Result", "Call Timestamp", "Duration (mm:ss)"];
    const rows = logs.map((log) => [
      (log.lead_name ?? "").trim() || "Unknown",
      formatPhoneForCsv(log.phone ?? ""),
      formatPhoneForCsv(log.did ?? ""),
      log.direction === "inbound" ? "Inbound" : "Outbound",
      log.result.replace("_", " "),
      new Date(log.timestamp).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      formatDuration(log.duration),
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((value) => escapeCsv(String(value ?? ""))).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateLabel = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `call-logs-${dateLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Call Logs</h1>
            <p className="mt-1 text-sm text-slate-500">
              Historical inbound and outbound call events ({logs.length} total). Schedule callbacks from a row when it links to a lead.
            </p>
          </div>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={logs.length === 0}
            className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download CSV
          </button>
        </div>
        {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Lead Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Phone</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">DID Used</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Direction</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Result</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Timestamp</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Duration</th>
                <th className="min-w-34 px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedLogs.map((log) => (
                <tr key={log.id} className="transition hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-medium text-slate-900">{log.lead_name ?? "-"}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{log.phone}</td>
                  <td className="px-4 py-3 text-slate-700">{log.did}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getDirectionTone(log.direction)}`}>
                      {log.direction === "inbound" ? "Inbound" : "Outbound"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getResultTone(log.result)}`}>
                      {log.result.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {formatDuration(log.duration)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={!log.lead_id}
                      title={log.lead_id ? "Schedule a callback on the linked lead" : "Add this number as a lead on the Leads page to enable scheduling"}
                      onClick={() => void openScheduleFromLog(log)}
                      className="inline-flex h-8 items-center justify-center rounded-md bg-violet-50 px-2.5 text-xs font-semibold text-violet-800 ring-1 ring-violet-200 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Schedule
                    </button>
                  </td>
                </tr>
              ))}
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    No call logs yet. Completed calls will appear here.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {logs.length > LOGS_PER_PAGE ? (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-sm text-slate-500">
              Showing{" "}
              <span className="font-semibold text-slate-800">{pageStart + 1}</span>–
              <span className="font-semibold text-slate-800">{Math.min(pageStart + LOGS_PER_PAGE, logs.length)}</span> of{" "}
              <span className="font-semibold text-slate-800">{logs.length}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
                disabled={safeCurrentPage === 1}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Previous page"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="px-3 py-1 text-sm font-medium text-slate-700">
                {safeCurrentPage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage(Math.min(totalPages, safeCurrentPage + 1))}
                disabled={safeCurrentPage === totalPages}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Next page"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {scheduleLead ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/45 px-4 pt-10 pb-12 sm:items-center sm:pt-8 sm:pb-8">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-7 shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">Schedule callback</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Reminder only — dial from <span className="font-medium text-slate-700">Leads</span> or{" "}
                  <span className="font-medium text-slate-700">Callbacks</span> when you are ready.
                </p>
                <p className="mt-2 truncate text-sm font-medium text-slate-800">{scheduleLead.name}</p>
                <p className="truncate text-xs text-slate-500">{scheduleLead.phone}</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                  <path d="M12 14v3l2 1" />
                </svg>
              </div>
            </div>
            <div className="mt-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                When to call back <span className="font-normal normal-case text-slate-400">(your device&apos;s local time)</span>
              </label>
              <CallbackSchedulePicker idPrefix="call-logs-callback-modal" value={scheduleAt} onChange={setScheduleAt} />
            </div>
            <div className="mt-5 flex flex-col gap-1.5">
              <label htmlFor="call-logs-callback-notes" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Notes (optional)
              </label>
              <textarea
                id="call-logs-callback-notes"
                value={scheduleNotes}
                onChange={(e) => setScheduleNotes(e.target.value)}
                rows={3}
                placeholder="e.g. Demo booked, send deck first…"
                className="resize-y rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-5">
              <button
                type="button"
                disabled={scheduleSaving || !scheduleLead.callback_at}
                onClick={() => void clearCallbackSchedule()}
                className="h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear schedule
              </button>
              <button
                type="button"
                onClick={() => setScheduleLead(null)}
                className="h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={scheduleSaving}
                onClick={() => void saveCallbackSchedule()}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {scheduleSaving ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-200 border-t-white" />
                ) : null}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="pointer-events-none fixed right-5 top-5 z-60">
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
