"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SuperadminShell } from "@/components/superadmin-shell";
import { datetimeLocalToIso, startOfTodayLocal, toDatetimeLocalValue } from "@/lib/shift-datetime";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { AppUserRecord, SuperadminCallRecordingRow } from "@/types";

interface RecordingsResponse {
  from: string;
  to: string;
  recordings: SuperadminCallRecordingRow[];
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function resultLabel(result: SuperadminCallRecordingRow["result"]): string {
  return result.replace(/_/g, " ");
}

export default function SuperadminRecordingsPage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AppUserRecord | null>(null);
  const [fromLocal, setFromLocal] = useState(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return toDatetimeLocalValue(start);
  });
  const [toLocal, setToLocal] = useState(() => toDatetimeLocalValue(new Date()));
  const [agentFilter, setAgentFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [data, setData] = useState<RecordingsResponse | null>(null);
  const [error, setError] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in to access superadmin.");
        setIsBootstrapping(false);
        return;
      }
      setUserId(user.id);

      const profileRes = await fetch(`/api/auth/me?user_id=${encodeURIComponent(user.id)}`);
      const profileJson = (await profileRes.json()) as AppUserRecord & { error?: string };
      if (!profileRes.ok) {
        setError(profileJson.error ?? "Could not load your profile.");
        setIsBootstrapping(false);
        return;
      }
      setProfile(profileJson);
      if (profileJson.role !== "superadmin") {
        setError("Your account does not have superadmin access.");
        setIsBootstrapping(false);
        return;
      }
      setIsBootstrapping(false);
    };

    void bootstrap();
  }, [supabase]);

  const loadRecordings = useCallback(async () => {
    if (!userId || profile?.role !== "superadmin") return;

    const fromIso = datetimeLocalToIso(fromLocal);
    const toIso = datetimeLocalToIso(toLocal);
    if (!fromIso || !toIso) {
      setError("Start and end must be valid date/time values.");
      return;
    }

    setIsLoading(true);
    setError("");

    const params = new URLSearchParams({
      user_id: userId,
      from: fromIso,
      to: toIso,
      limit: "200",
    });
    if (agentFilter) params.set("agent_id", agentFilter);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());

    try {
      const res = await fetch(`/api/superadmin/recordings?${params.toString()}`);
      const json = (await res.json()) as RecordingsResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to load recordings.");
        setData(null);
        setSelectedId(null);
        return;
      }
      setData(json);
      setSelectedId((prev) => {
        if (prev && json.recordings.some((r) => r.id === prev)) return prev;
        return json.recordings[0]?.id ?? null;
      });
    } catch {
      setError("Failed to load recordings. Check your connection.");
      setData(null);
      setSelectedId(null);
    } finally {
      setIsLoading(false);
    }
  }, [agentFilter, fromLocal, profile?.role, searchQuery, toLocal, userId]);

  useEffect(() => {
    if (!userId || profile?.role !== "superadmin") return;
    const timerId = window.setTimeout(() => {
      void loadRecordings();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [loadRecordings, profile?.role, userId]);

  const agentOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of data?.recordings ?? []) {
      if (!seen.has(row.user_id)) seen.set(row.user_id, row.agent_email);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data?.recordings]);

  const selected = useMemo(
    () => data?.recordings.find((r) => r.id === selectedId) ?? null,
    [data?.recordings, selectedId],
  );

  const recordingSrc = (callLogId: string) =>
    userId
      ? `/api/superadmin/recording?user_id=${encodeURIComponent(userId)}&call_log_id=${encodeURIComponent(callLogId)}`
      : "";

  const applyPresetDays = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    setFromLocal(toDatetimeLocalValue(start));
    setToLocal(toDatetimeLocalValue(end));
  };

  if (!profile && isBootstrapping) {
    return (
      <SuperadminShell>
        <p className="text-sm text-slate-400">Loading recordings...</p>
      </SuperadminShell>
    );
  }

  if (profile?.role !== "superadmin") {
    return (
      <SuperadminShell>
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-4 text-sm text-rose-200">
          {error || "Superadmin access required."}
        </div>
      </SuperadminShell>
    );
  }

  const totalDuration = (data?.recordings ?? []).reduce((sum, r) => sum + (r.duration ?? 0), 0);

  return (
    <SuperadminShell>
      <section className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Call recordings</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Listen again to saved agent call audio. Only calls with a stored Twilio recording appear here—not
            every dial in call logs.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Find recordings</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <label className="block lg:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">Search</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Agent, lead name, or phone..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">From</span>
              <input
                type="datetime-local"
                value={fromLocal}
                onChange={(e) => setFromLocal(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">To</span>
              <input
                type="datetime-local"
                value={toLocal}
                onChange={(e) => setToLocal(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">Agent</span>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
              >
                <option value="">All agents</option>
                {agentOptions.map(([id, email]) => (
                  <option key={id} value={id}>
                    {email}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => applyPresetDays(1)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Last 24 hours
            </button>
            <button
              type="button"
              onClick={() => applyPresetDays(7)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Last 7 days
            </button>
            <button
              type="button"
              onClick={() => applyPresetDays(30)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Last 30 days
            </button>
            <button
              type="button"
              onClick={() => void loadRecordings()}
              disabled={isLoading}
              className="ml-auto rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60"
            >
              {isLoading ? "Loading..." : "Search recordings"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <p className="text-sm text-slate-400">Recordings found</p>
            <p className="mt-2 text-3xl font-semibold text-white">{data?.recordings.length ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <p className="text-sm text-slate-400">Total audio (approx.)</p>
            <p className="mt-2 text-3xl font-semibold text-white">{formatDuration(totalDuration)}</p>
          </div>
        </div>

        {(data?.recordings.length ?? 0) === 0 && !isLoading ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-12 text-center">
            <p className="text-lg font-medium text-slate-300">No recordings in this range</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Recordings are saved when conference calls end and Twilio sends the recording webhook. Try a wider
              date range, or place new calls after the recording migration is applied.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
            <div className="max-h-[70vh] space-y-2 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/80 p-2">
              <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recording list
              </p>
              {(data?.recordings ?? []).map((row) => {
                const isSelected = row.id === selectedId;
                const title = row.lead_name ?? formatPhone(row.phone);
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      isSelected
                        ? "border-violet-500/60 bg-violet-950/50"
                        : "border-transparent bg-slate-950/40 hover:border-slate-700 hover:bg-slate-800/80"
                    }`}
                  >
                    <p className="truncate text-sm font-semibold text-white">{title}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">{row.agent_email}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(row.timestamp).toLocaleString()} · {formatDuration(row.duration)}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
              {selected && userId ? (
                <div className="space-y-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-300/90">Now playing</p>
                    <h2 className="mt-1 text-2xl font-semibold text-white">
                      {selected.lead_name ?? formatPhone(selected.phone)}
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">
                      Agent {selected.agent_email} · {new Date(selected.timestamp).toLocaleString()}
                    </p>
                  </div>

                  <audio
                    key={selected.id}
                    controls
                    autoPlay
                    className="w-full"
                    src={recordingSrc(selected.id)}
                  >
                    Your browser does not support audio playback.
                  </audio>

                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Lead phone</dt>
                      <dd className="mt-0.5 text-slate-200">{formatPhone(selected.phone)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Caller ID (DID)</dt>
                      <dd className="mt-0.5 text-slate-200">{formatPhone(selected.did)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Direction</dt>
                      <dd className="mt-0.5 capitalize text-slate-200">{selected.direction ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Result</dt>
                      <dd className="mt-0.5 capitalize text-slate-200">{resultLabel(selected.result)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Duration</dt>
                      <dd className="mt-0.5 text-slate-200">{formatDuration(selected.duration)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Recording ID</dt>
                      <dd className="mt-0.5 truncate font-mono text-xs text-slate-400">
                        {selected.twilio_recording_sid}
                      </dd>
                    </div>
                  </dl>

                  {selected.call_notes ? (
                    <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Call notes</p>
                      <p className="mt-1 text-sm text-slate-300">{selected.call_notes}</p>
                    </div>
                  ) : null}

                  <a
                    href={recordingSrc(selected.id)}
                    download={`recording-${selected.twilio_recording_sid}.mp3`}
                    className="inline-flex rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                  >
                    Download MP3
                  </a>
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-slate-500">
                  {isLoading ? "Loading recordings..." : "Select a recording from the list."}
                </p>
              )}
            </div>
          </div>
        )}

        {data ? (
          <p className="text-xs text-slate-500">
            Showing up to 200 recordings from {new Date(data.from).toLocaleString()} through{" "}
            {new Date(data.to).toLocaleString()}.
          </p>
        ) : null}
      </section>
    </SuperadminShell>
  );
}
