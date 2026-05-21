"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SuperadminShell } from "@/components/superadmin-shell";
import { datetimeLocalToIso, startOfTodayLocal, toDatetimeLocalValue } from "@/lib/shift-datetime";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { AgentDialStatsRow, AppUserRecord } from "@/types";

interface DialStatsResponse {
  from: string;
  to: string;
  agents: AgentDialStatsRow[];
  total_dials: number;
}

export default function SuperadminPage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AppUserRecord | null>(null);
  const [fromLocal, setFromLocal] = useState(startOfTodayLocal);
  const [toLocal, setToLocal] = useState(() => toDatetimeLocalValue(new Date()));
  const [agentFilter, setAgentFilter] = useState("");
  const [stats, setStats] = useState<DialStatsResponse | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const bootstrap = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in to access superadmin.");
        setIsLoading(false);
        return;
      }
      setUserId(user.id);

      const profileRes = await fetch(`/api/auth/me?user_id=${encodeURIComponent(user.id)}`);
      const profileJson = (await profileRes.json()) as AppUserRecord & { error?: string };
      if (!profileRes.ok) {
        setError(profileJson.error ?? "Could not load your profile.");
        setIsLoading(false);
        return;
      }
      setProfile(profileJson);
      if (profileJson.role !== "superadmin") {
        setError("Your account does not have superadmin access.");
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
    };

    void bootstrap();
  }, [supabase]);

  const loadStats = useCallback(async (overrideTo?: string) => {
    if (!userId || profile?.role !== "superadmin") return;

    const toValue = overrideTo ?? toLocal;
    const fromIso = datetimeLocalToIso(fromLocal);
    const toIso = datetimeLocalToIso(toValue);
    if (!fromIso || !toIso) {
      setError("Shift start and end must be valid date/time values.");
      return;
    }

    setIsLoading(true);
    setError("");

    const params = new URLSearchParams({
      user_id: userId,
      from: fromIso,
      to: toIso,
    });
    if (agentFilter) {
      params.set("agent_id", agentFilter);
    }

    try {
      const res = await fetch(`/api/superadmin/agent-dial-stats?${params.toString()}`);
      const json = (await res.json()) as DialStatsResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to load agent dial stats.");
        setStats(null);
        return;
      }
      setStats(json);
    } catch {
      setError("Failed to load agent dial stats. Check your connection.");
      setStats(null);
    } finally {
      setIsLoading(false);
    }
  }, [agentFilter, fromLocal, profile?.role, toLocal, userId]);

  const handleRefresh = useCallback(() => {
    const refreshedTo = toDatetimeLocalValue(new Date());
    setToLocal(refreshedTo);
    void loadStats(refreshedTo);
  }, [loadStats]);

  useEffect(() => {
    if (!userId || profile?.role !== "superadmin") return;
    const timerId = window.setTimeout(() => {
      void loadStats();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [loadStats, profile?.role, userId]);

  const applyPresetHours = (hours: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
    setFromLocal(toDatetimeLocalValue(start));
    setToLocal(toDatetimeLocalValue(end));
  };

  if (!profile && isLoading) {
    return (
      <SuperadminShell>
        <p className="text-sm text-slate-400">Loading superadmin console...</p>
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

  return (
    <SuperadminShell>
      <section className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Agent dial stats</h1>
          <p className="mt-1 text-sm text-slate-400">
            Outbound dials per agent for any shift window. Set start and end timestamps to match your team&apos;s schedule.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Shift window</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
            <label className="block md:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-slate-300">Agent (optional)</span>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
              >
                <option value="">All agents</option>
                {(stats?.agents ?? []).map((agent) => (
                  <option key={agent.user_id} value={agent.user_id}>
                    {agent.email}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => applyPresetHours(8)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Last 8 hours
            </button>
            <button
              type="button"
              onClick={() => applyPresetHours(12)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Last 12 hours
            </button>
            <button
              type="button"
              onClick={() => {
                setFromLocal(startOfTodayLocal());
                setToLocal(toDatetimeLocalValue(new Date()));
              }}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading}
              className="ml-auto rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => void loadStats()}
              disabled={isLoading}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Loading..." : "Apply filters"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <p className="text-sm text-slate-400">Total outbound dials</p>
            <p className="mt-2 text-3xl font-semibold text-white">{stats?.total_dials ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
            <p className="text-sm text-slate-400">Agents in view</p>
            <p className="mt-2 text-3xl font-semibold text-white">{stats?.agents.length ?? 0}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Agent</th>
                <th className="px-4 py-3 font-semibold">Dials</th>
                <th className="px-4 py-3 font-semibold">Answered</th>
                <th className="px-4 py-3 font-semibold">Answer rate</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.agents ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    {isLoading ? "Loading stats..." : "No agents or dials in this window."}
                  </td>
                </tr>
              ) : (
                (stats?.agents ?? []).map((agent) => {
                  const rate = agent.dial_count ? Math.round((agent.answered_count / agent.dial_count) * 100) : 0;
                  return (
                    <tr key={agent.user_id} className="border-t border-slate-800/80">
                      <td className="px-4 py-3 font-medium text-white">{agent.email}</td>
                      <td className="px-4 py-3 text-slate-200">{agent.dial_count}</td>
                      <td className="px-4 py-3 text-slate-200">{agent.answered_count}</td>
                      <td className="px-4 py-3 text-slate-200">{rate}%</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {stats ? (
          <p className="text-xs text-slate-500">
            Showing outbound calls from {new Date(stats.from).toLocaleString()} through{" "}
            {new Date(stats.to).toLocaleString()}.
          </p>
        ) : null}
      </section>
    </SuperadminShell>
  );
}
