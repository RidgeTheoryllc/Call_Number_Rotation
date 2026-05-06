"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { CallLogRecord } from "@/types";

export default function CallLogsPage() {
  const [logs, setLogs] = useState<CallLogRecord[]>([]);
  const [error, setError] = useState("");
  const supabase = getSupabaseBrowserClient();

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

      const res = await fetch(`/api/call-logs?user_id=${encodeURIComponent(user.id)}`);
      const json = await res.json();
      if (res.ok) {
        setLogs(json);
      } else {
        setError(json.error ?? "Failed to load call logs.");
      }
    };
    void load();
  }, [supabase]);

  return (
    <AppShell>
      <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Call Logs</h1>
          <p className="mt-1 text-sm text-slate-500">Historical outbound call events and execution outcomes.</p>
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
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Result</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Timestamp</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <tr key={log.id} className="transition hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-medium text-slate-900">{log.lead_name ?? "-"}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{log.phone}</td>
                  <td className="px-4 py-3 text-slate-700">{log.did}</td>
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
                </tr>
              ))}
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
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
