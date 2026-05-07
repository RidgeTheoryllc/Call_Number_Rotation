"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { CallLogRecord } from "@/types";

export default function CallLogsPage() {
  const [logs, setLogs] = useState<CallLogRecord[]>([]);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteIds, setSavingNoteIds] = useState<Record<string, boolean>>({});
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

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

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in to view call logs.");
        setLogs([]);
        return;
      }
      setUserId(user.id);

      const res = await fetch(`/api/call-logs?user_id=${encodeURIComponent(user.id)}`);
      const json = await res.json();
      if (res.ok) {
        const nextLogs = json as CallLogRecord[];
        setLogs(nextLogs);
        const initialDrafts: Record<string, string> = {};
        nextLogs.forEach((log) => {
          initialDrafts[log.id] = log.call_notes ?? "";
        });
        setNoteDrafts(initialDrafts);
      } else {
        setError(json.error ?? "Failed to load call logs.");
      }
    };
    void load();
  }, [supabase]);

  const saveCallNote = async (log: CallLogRecord) => {
    if (savingNoteIds[log.id]) return;

    const nextNote = (noteDrafts[log.id] ?? "").trim();
    setSavingNoteIds((prev) => ({ ...prev, [log.id]: true }));
    setError("");
    try {
      let resolvedUserId = userId;
      if (!resolvedUserId) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        resolvedUserId = user?.id ?? null;
      }
      if (!resolvedUserId) {
        setError("You must be signed in to save call notes.");
        return;
      }

      const res = await fetch("/api/call-logs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: log.id,
          user_id: resolvedUserId,
          call_notes: nextNote,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to save call note.");
        return;
      }

      setLogs((prev) =>
        prev.map((item) => (item.id === log.id ? { ...item, call_notes: nextNote } : item)),
      );
    } finally {
      setSavingNoteIds((prev) => ({ ...prev, [log.id]: false }));
    }
  };

  const downloadCsv = () => {
    const formatPhoneForCsv = (phone: string) => {
      const cleaned = phone.trim();
      if (!cleaned) return "";
      // Prefix with apostrophe so Excel keeps it as text (prevents scientific notation).
      return `'${cleaned}`;
    };

    const escapeCsv = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
    const headers = ["Lead Name", "Phone", "Direction", "Call Timestamp", "Notes"];
    const rows = logs.map((log) => [
      (log.lead_name ?? "").trim() || "Unknown",
      formatPhoneForCsv(log.phone ?? ""),
      log.direction === "inbound" ? "Inbound" : "Outbound",
      new Date(log.timestamp).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      (noteDrafts[log.id] ?? log.call_notes ?? "").trim(),
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
          <p className="mt-1 text-sm text-slate-500">Historical outbound call events and execution outcomes.</p>
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
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
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
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Call Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
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
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        value={noteDrafts[log.id] ?? ""}
                        onChange={(e) =>
                          setNoteDrafts((prev) => ({
                            ...prev,
                            [log.id]: e.target.value,
                          }))
                        }
                        placeholder="e.g. Busy, not interested"
                        className="h-8 w-56 rounded-md border border-slate-300 px-2.5 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() => void saveCallNote(log)}
                        disabled={Boolean(savingNoteIds[log.id])}
                        className="inline-flex h-8 items-center rounded-md bg-slate-900 px-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingNoteIds[log.id] ? "Saving..." : "Save"}
                      </button>
                    </div>
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
        </div>
      </section>
    </AppShell>
  );
}
