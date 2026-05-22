"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { CallbackSchedulePicker } from "@/components/callback-schedule-picker";
import { useTwilioDeviceContext } from "@/components/twilio-device-provider";
import { TwilioMicSelector } from "@/components/twilio-mic-selector";
import { useWorkspaceDataCache } from "@/components/workspace-data-cache";
import {
  isoToDatetimeLocalValue,
  isSameLocalCalendarDay,
  parseDatetimeLocalValue,
} from "@/lib/callback-schedule";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { LeadRecord } from "@/types";

function sortLeadsByPriority(rows: LeadRecord[]): LeadRecord[] {
  const rank: Record<LeadRecord["status"], number> = { pending: 0, dialed: 1, completed: 2 };
  return [...rows].sort((a, b) => {
    const rd = rank[a.status] - rank[b.status];
    if (rd !== 0) return rd;
    const ac = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bc = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bc - ac;
  });
}

function mergeLeadUpdate(rows: LeadRecord[], updated: LeadRecord): LeadRecord[] {
  return sortLeadsByPriority(rows.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)));
}

export default function CallbacksPage() {
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [todayOnly, setTodayOnly] = useState(false);
  const [callingLeadIds, setCallingLeadIds] = useState<Record<string, boolean>>({});
  const [scheduleLead, setScheduleLead] = useState<LeadRecord | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "warn"; message: string } | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [activeLeadCall, setActiveLeadCall] = useState<{ name: string; phone: string } | null>(null);
  /** True while POST /api/twilio/call has not yet produced a ringing/in-progress client leg. */
  const awaitingTwilioClientLegRef = useRef(false);
  const clearActiveLeadCallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    identity,
    deviceReady,
    callStatus,
    activeCall,
    hangup,
    answerIncomingCall,
    rejectIncomingCall,
    mute,
    signalOutboundClientLegExpected,
    clearOutboundClientLegExpected,
  } = useTwilioDeviceContext();
  const workspaceCache = useWorkspaceDataCache();
  const showCallControls = callStatus === "ringing" || callStatus === "in-progress";
  const isInboundRinging = callStatus === "ringing" && !activeLeadCall;
  const incomingCaller = isInboundRinging ? activeCall?.parameters.From ?? activeCall?.parameters.Caller : null;
  const activeLeadCallLabel = callStatus === "in-progress" ? "On call with" : "Connecting to";
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
    if (callStatus !== "in-progress") return;
    const timer = window.setInterval(() => {
      setCallDurationSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [callStatus]);

  useEffect(() => {
    if (callStatus === "ringing" || callStatus === "in-progress") {
      awaitingTwilioClientLegRef.current = false;
    }
  }, [callStatus]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!scheduleLead) return;
    queueMicrotask(() => {
      setError("");
      setScheduleNotes(scheduleLead.callback_notes ?? "");
      setScheduleAt(
        scheduleLead.callback_at
          ? isoToDatetimeLocalValue(scheduleLead.callback_at)
          : isoToDatetimeLocalValue(new Date(Date.now() + 15 * 60 * 1000).toISOString()),
      );
    });
  }, [scheduleLead]);

  const applyLeads = useCallback(
    (rows: LeadRecord[]) => {
      const sorted = sortLeadsByPriority(rows);
      setLeads(sorted);
      if (userId) workspaceCache.setCachedLeads(userId, sorted);
    },
    [userId, workspaceCache],
  );

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!userId) {
        setLeads([]);
        setIsLoading(false);
        return;
      }
      if (!opts?.silent) setIsLoading(true);
      try {
        const res = await fetch(`/api/leads?user_id=${encodeURIComponent(userId)}`, { cache: "no-store" });
        const json = await res.json();
        if (res.ok) {
          applyLeads(json as LeadRecord[]);
        }
      } finally {
        if (!opts?.silent) setIsLoading(false);
      }
    },
    [userId, applyLeads],
  );

  useEffect(() => {
    const run = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in to view scheduled callbacks.");
        setLeads([]);
        setIsLoading(false);
        return;
      }
      setUserId(user.id);
    };
    void run();
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    const cached = workspaceCache.getCachedLeads(userId);
    if (cached !== null) {
      queueMicrotask(() => {
        setLeads(cached);
        setIsLoading(false);
      });
    }
    const timer = window.setTimeout(() => void load({ silent: cached !== null }), 0);
    return () => clearTimeout(timer);
  }, [userId, workspaceCache, load]);

  const scheduledRows = useMemo(() => {
    const withCb = leads.filter((l) => Boolean(l.callback_at));
    const q = searchQuery.trim().toLowerCase();
    const searched = q
      ? withCb.filter((lead) => {
          const hay = [lead.name, lead.phone, lead.callback_notes, lead.callback_at]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          const qd = q.replace(/\D/g, "");
          const pd = (lead.phone ?? "").replace(/\D/g, "");
          const phoneMatch =
            qd.length >= 3 && (pd.includes(qd) || pd.endsWith(qd));
          return hay.includes(q) || phoneMatch;
        })
      : withCb;
    const dayFiltered = todayOnly ? searched.filter((l) => l.callback_at && isSameLocalCalendarDay(l.callback_at)) : searched;
    return [...dayFiltered].sort((a, b) => {
      const ta = new Date(a.callback_at!).getTime();
      const tb = new Date(b.callback_at!).getTime();
      return ta - tb;
    });
  }, [leads, searchQuery, todayOnly]);

  const dialLead = useCallback(
    async (lead: LeadRecord) => {
      if (!userId || callingLeadIds[lead.id]) return;
      signalOutboundClientLegExpected();
      awaitingTwilioClientLegRef.current = true;
      setCallingLeadIds((prev) => ({ ...prev, [lead.id]: true }));
      setError("");
      setCallDurationSeconds(0);
      setActiveLeadCall({ name: lead.name, phone: lead.phone });
      try {
        const rotateRes = await fetch("/api/rotate-did", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadPhone: lead.phone, user_id: userId }),
        });
        const rotateData = await rotateRes.json();
        if (!rotateRes.ok) {
          clearOutboundClientLegExpected();
          awaitingTwilioClientLegRef.current = false;
          setActiveLeadCall(null);
          setError(rotateData.error ?? "Failed to rotate DID.");
          return;
        }
        const callRes = await fetch("/api/twilio/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: lead.phone,
            callerId: rotateData.did,
            agentIdentity: identity,
            leadId: lead.id,
            user_id: userId,
          }),
        });
        const callData = await callRes.json();
        if (!callRes.ok) {
          clearOutboundClientLegExpected();
          awaitingTwilioClientLegRef.current = false;
          setActiveLeadCall(null);
          setError(callData.error ?? "Call failed.");
          return;
        }
        await fetch("/api/leads", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: lead.id, user_id: userId, status: "dialed", assigned_did: rotateData.did }),
        });
        await load();
      } catch {
        clearOutboundClientLegExpected();
        awaitingTwilioClientLegRef.current = false;
        setActiveLeadCall(null);
        setError("Call setup failed. Check your connection and try again.");
      } finally {
        setCallingLeadIds((prev) => ({ ...prev, [lead.id]: false }));
      }
    },
    [callingLeadIds, clearOutboundClientLegExpected, identity, load, signalOutboundClientLegExpected, userId],
  );

  useEffect(() => {
    if (callStatus === "ringing" || callStatus === "in-progress") return;
    if (activeCall) return;
    if (awaitingTwilioClientLegRef.current) return;

    if (clearActiveLeadCallTimeoutRef.current) {
      clearTimeout(clearActiveLeadCallTimeoutRef.current);
    }
    clearActiveLeadCallTimeoutRef.current = setTimeout(() => {
      clearActiveLeadCallTimeoutRef.current = null;
      if (awaitingTwilioClientLegRef.current) return;
      setActiveLeadCall(null);
    }, 0);

    return () => {
      if (clearActiveLeadCallTimeoutRef.current) {
        clearTimeout(clearActiveLeadCallTimeoutRef.current);
        clearActiveLeadCallTimeoutRef.current = null;
      }
    };
  }, [activeCall, callStatus]);

  useEffect(() => {
    if (callStatus === "ringing" || callStatus === "in-progress") return;
    if (activeCall) return;
    if (awaitingTwilioClientLegRef.current) return;
    window.setTimeout(() => {
      setCallDurationSeconds(0);
      setIsMuted(false);
    }, 0);
  }, [activeCall, callStatus]);

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
      const updated = json as LeadRecord;
      setLeads((prev) => mergeLeadUpdate(prev, updated));
      const cached = workspaceCache.getCachedLeads(userId);
      workspaceCache.setCachedLeads(userId, mergeLeadUpdate(cached ?? leads, updated));
      if (todayOnly && updated.callback_at && !isSameLocalCalendarDay(updated.callback_at)) {
        showToast("warn", "Saved. Callback is on another day — turn off “Today only” to see it in the list.");
      } else {
        showToast("success", "Callback updated.");
      }
      setScheduleLead(null);
      void load({ silent: true });
    } finally {
      setScheduleSaving(false);
    }
  };

  const clearCallbackSchedule = async (lead?: LeadRecord) => {
    const target = lead ?? scheduleLead;
    if (!userId || !target) return;
    setScheduleSaving(true);
    setError("");
    try {
      const res = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: target.id,
          user_id: userId,
          callback_at: null,
          callback_notes: null,
        }),
      });
      const json = (await res.json()) as LeadRecord & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to remove from callback queue.");
        return;
      }
      const updated = json as LeadRecord;
      setLeads((prev) => mergeLeadUpdate(prev, updated));
      const cached = workspaceCache.getCachedLeads(userId);
      workspaceCache.setCachedLeads(userId, mergeLeadUpdate(cached ?? leads, updated));
      showToast("success", "Removed from callback queue.");
      setScheduleLead(null);
      void load({ silent: true });
    } finally {
      setScheduleSaving(false);
    }
  };

  return (
    <AppShell>
      <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Scheduled callbacks</h1>
            <p className="mt-1 text-sm text-slate-500">
              Leads with a callback time. Dial when you are ready — same as on the{" "}
              <Link href="/leads" className="font-medium text-indigo-600 underline-offset-2 hover:underline">
                Leads
              </Link>{" "}
              page.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={isLoading || !userId}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">{error}</div>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2.5 px-4 py-3.5 sm:px-5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                deviceReady
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${deviceReady ? "bg-emerald-500" : "bg-rose-500"}`} />
              {deviceReady ? "Dialer ready" : "Dialer not ready"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {callStatus}
            </span>
            {callStatus === "in-progress" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                {formatDuration(callDurationSeconds)}
              </span>
            ) : null}
          </div>
          <div className="border-t border-slate-100 px-4 py-2.5 sm:px-5">
            <TwilioMicSelector maxWidthClass="max-w-xl" />
          </div>
          {activeLeadCall ? (
            <div className="border-t border-indigo-100 bg-indigo-50/60 px-4 py-2 sm:px-5">
              <p className="text-xs font-medium text-slate-600">
                {activeLeadCallLabel}{" "}
                <span className="font-semibold text-slate-900">{activeLeadCall.name}</span> at{" "}
                <span className="tabular-nums font-semibold text-slate-900">{activeLeadCall.phone}</span>
              </p>
            </div>
          ) : null}
          {showCallControls ? (
            <div className="border-t border-slate-100 px-4 py-2 sm:px-5">
              {isInboundRinging ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-auto text-xs font-semibold text-slate-700">
                    Incoming call{incomingCaller ? ` from ${incomingCaller}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCallDurationSeconds(0);
                      answerIncomingCall();
                    }}
                    disabled={!activeCall}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Answer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      rejectIncomingCall();
                      setCallDurationSeconds(0);
                    }}
                    disabled={!activeCall}
                    className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isMuted;
                      mute(next);
                      setIsMuted(next);
                    }}
                    disabled={!activeCall}
                    className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isMuted ? "Unmute" : "Mute"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      hangup();
                      setCallDurationSeconds(0);
                      setIsMuted(false);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100"
                  >
                    Hang up
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="cb-search" className="text-xs font-medium text-slate-500">
              Search this queue
            </label>
            <input
              id="cb-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Name, phone, notes…"
              className="h-9 max-w-md rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={todayOnly}
              onChange={(e) => setTodayOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Today only
          </label>
          <p className="text-sm text-slate-600 sm:pb-0.5">
            <span className="font-semibold text-slate-900">{scheduledRows.length}</span> scheduled
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {["Name", "Phone", "Callback time", "Notes", "Status", "Actions"].map((col) => (
                  <th
                    key={col}
                    className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                      col === "Actions" ? "min-w-[280px] whitespace-nowrap text-right" : ""
                    }`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                      Loading…
                    </span>
                  </td>
                </tr>
              )}
              {!isLoading && scheduledRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">
                    {leads.length === 0
                      ? "No leads loaded yet."
                      : "No scheduled callbacks. On the Leads page, use Schedule on a row to add one."}
                  </td>
                </tr>
              )}
              {scheduledRows.map((lead) => (
                <tr key={lead.id} className="transition hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-medium text-slate-900">{lead.name}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{lead.phone}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-800">
                    {lead.callback_at
                      ? new Date(lead.callback_at).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}
                    {lead.callback_at && isSameLocalCalendarDay(lead.callback_at) ? (
                      <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                        Today
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-[220px] px-4 py-3 text-slate-600">
                    <span className="line-clamp-2 text-xs">{lead.callback_notes ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
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
                  <td className="min-w-[280px] whitespace-nowrap px-4 py-3">
                    <div className="flex flex-nowrap items-center justify-end gap-1.5">
                      <Link
                        href={`/messages?lead_id=${encodeURIComponent(lead.id)}`}
                        className="inline-flex h-7 w-16 shrink-0 items-center justify-center rounded-md bg-indigo-50 px-2.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100"
                      >
                        SMS
                      </Link>
                      <button
                        type="button"
                        disabled={Boolean(callingLeadIds[lead.id]) || !deviceReady || !identity}
                        onClick={() => void dialLead(lead)}
                        className="inline-flex h-7 min-w-18 shrink-0 items-center justify-center rounded-md bg-blue-50 px-2 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {callingLeadIds[lead.id] ? (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700" />
                        ) : (
                          "Dial"
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setScheduleLead(lead)}
                        className="inline-flex h-7 shrink-0 items-center justify-center rounded-md bg-violet-50 px-2 text-xs font-semibold text-violet-800 ring-1 ring-violet-200 transition hover:bg-violet-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={scheduleSaving}
                        onClick={() => void clearCallbackSchedule(lead)}
                        className="inline-flex h-7 shrink-0 items-center justify-center rounded-md bg-slate-100 px-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-200 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </section>

      {scheduleLead ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/45 px-4 pt-10 pb-12 sm:items-center sm:pt-8 sm:pb-8">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-7 shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">Edit callback</h2>
                <p className="mt-1 truncate text-sm font-medium text-slate-800">{scheduleLead.name}</p>
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
              <CallbackSchedulePicker idPrefix="callbacks-modal" value={scheduleAt} onChange={setScheduleAt} />
            </div>
            <div className="mt-5 flex flex-col gap-1.5">
              <label htmlFor="cb-notes" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Notes (optional)
              </label>
              <textarea
                id="cb-notes"
                value={scheduleNotes}
                onChange={(e) => setScheduleNotes(e.target.value)}
                rows={3}
                placeholder="Context for the next touch…"
                className="resize-y rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            {error ? (
              <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-5">
              <button
                type="button"
                onClick={() => void clearCallbackSchedule()}
                disabled={scheduleSaving}
                className="h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Remove from queue
              </button>
              <button type="button" onClick={() => setScheduleLead(null)} className="h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="button"
                disabled={scheduleSaving}
                onClick={() => void saveCallbackSchedule()}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {scheduleSaving ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-200 border-t-white" /> : null}
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
