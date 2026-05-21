"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SuperadminShell } from "@/components/superadmin-shell";
import { useTwilioDeviceContext } from "@/components/twilio-device-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { ActiveConferenceSessionRow, AppUserRecord } from "@/types";

interface ActiveCallsResponse {
  conference_calls_enabled: boolean;
  calls: ActiveConferenceSessionRow[];
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

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function InCallBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-950/50 px-2.5 py-1 text-xs font-semibold text-red-200 ${className}`.trim()}
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      In a call
    </span>
  );
}

export default function SuperadminLiveCallsPage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const {
    deviceReady,
    deviceError,
    callStatus,
    hangup,
    signalOutboundClientLegExpected,
  } = useTwilioDeviceContext();

  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<AppUserRecord | null>(null);
  const [calls, setCalls] = useState<ActiveConferenceSessionRow[]>([]);
  const [conferenceEnabled, setConferenceEnabled] = useState(true);
  const [error, setError] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoadingCalls, setIsLoadingCalls] = useState(false);
  const [listeningConference, setListeningConference] = useState<string | null>(null);
  const [connectingConference, setConnectingConference] = useState<string | null>(null);
  const [listenStartedAt, setListenStartedAt] = useState<number | null>(null);
  const [listenSeconds, setListenSeconds] = useState(0);

  const isListening = callStatus === "in-progress" && listeningConference !== null;
  const isConnecting =
    connectingConference !== null || (callStatus === "ringing" && listeningConference !== null);

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

  const loadActiveCalls = useCallback(async () => {
    if (!userId || profile?.role !== "superadmin") return;

    setIsLoadingCalls(true);
    setError("");

    try {
      const res = await fetch(`/api/superadmin/active-calls?user_id=${encodeURIComponent(userId)}`);
      const json = (await res.json()) as ActiveCallsResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to load active calls.");
        setCalls([]);
        return;
      }
      setConferenceEnabled(json.conference_calls_enabled);
      setCalls(json.calls ?? []);
    } catch {
      setError("Failed to load active calls. Check your connection.");
      setCalls([]);
    } finally {
      setIsLoadingCalls(false);
    }
  }, [profile?.role, userId]);

  useEffect(() => {
    if (!userId || profile?.role !== "superadmin") return;
    void loadActiveCalls();
    const intervalId = window.setInterval(() => void loadActiveCalls(), 5000);
    return () => window.clearInterval(intervalId);
  }, [loadActiveCalls, profile?.role, userId]);

  useEffect(() => {
    if (!isListening || !listenStartedAt) {
      setListenSeconds(0);
      return;
    }
    const tick = () => {
      setListenSeconds(Math.floor((Date.now() - listenStartedAt) / 1000));
    };
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [isListening, listenStartedAt]);

  useEffect(() => {
    if (
      listeningConference &&
      (callStatus === "ready" || callStatus === "completed" || callStatus === "idle")
    ) {
      setListeningConference(null);
      setConnectingConference(null);
      setListenStartedAt(null);
    }
    if (callStatus === "in-progress" && listeningConference) {
      setConnectingConference(null);
      setListenStartedAt((prev) => prev ?? Date.now());
    }
  }, [callStatus, listeningConference]);

  const handleStopListen = useCallback(() => {
    hangup();
    setListeningConference(null);
    setConnectingConference(null);
    setListenStartedAt(null);
  }, [hangup]);

  const handleListen = useCallback(
    async (row: ActiveConferenceSessionRow) => {
      if (!userId || !deviceReady) return;
      if (isListening || isConnecting) return;

      if (listeningConference && listeningConference !== row.conference_name) {
        handleStopListen();
      }

      setConnectingConference(row.conference_name);
      setListeningConference(row.conference_name);
      setError("");
      signalOutboundClientLegExpected();

      try {
        const res = await fetch("/api/superadmin/listen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            conference_name: row.conference_name,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setListeningConference(null);
          setConnectingConference(null);
          setError(data.error ?? "Could not join this call for QA listen.");
          return;
        }
      } catch {
        setListeningConference(null);
        setConnectingConference(null);
        setError("Could not join this call. Check your connection.");
      }
    },
    [
      deviceReady,
      handleStopListen,
      isConnecting,
      isListening,
      listeningConference,
      signalOutboundClientLegExpected,
      userId,
    ],
  );

  if (!profile && isBootstrapping) {
    return (
      <SuperadminShell>
        <p className="text-sm text-slate-400">Loading live QA console...</p>
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
          <h1 className="text-3xl font-semibold tracking-tight text-white">Live QA listen</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Join active agent calls from your browser as a muted listener. Agent and lead are not notified when
            you connect. Use a headset and ensure microphone access is allowed.
          </p>
        </div>

        <div
          className={`rounded-2xl border p-5 ${
            isListening
              ? "border-emerald-500/40 bg-emerald-950/30"
              : deviceReady
                ? "border-slate-800 bg-slate-900/80"
                : "border-amber-500/40 bg-amber-950/30"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">QA audio line</p>
          <p className="mt-1 text-lg font-semibold text-white">
            {isListening
              ? "Listening (muted)"
              : isConnecting
                ? "Connecting to call..."
                : deviceReady
                  ? "Ready to listen"
                  : "Initializing browser audio..."}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {deviceError
              ? deviceError
              : isListening
                ? `Monitor leg active · ${formatDuration(listenSeconds)} · You are muted on both sides.`
                : "When you click Listen, this browser answers automatically and joins the conference silently."}
          </p>
          {isListening ? (
            <button
              type="button"
              onClick={handleStopListen}
              className="mt-4 rounded-lg border border-rose-500/50 bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
            >
              Stop listening
            </button>
          ) : null}
        </div>

        {!conferenceEnabled ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-4 text-sm text-amber-100">
            Conference calling is disabled on the server. Set{" "}
            <code className="rounded bg-amber-900/60 px-1">TWILIO_CONFERENCE_CALLS=true</code> and redeploy.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void loadActiveCalls()}
            disabled={isLoadingCalls}
            className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-60"
          >
            {isLoadingCalls ? "Refreshing..." : "Refresh now"}
          </button>
          {calls.length > 0 ? (
            <InCallBadge />
          ) : (
            <span className="text-xs font-medium text-slate-500">No agents in a call right now</span>
          )}
          <p className="text-xs text-slate-500">Auto-refreshes every 5 seconds.</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Agent</th>
                <th className="px-4 py-3 font-semibold">Lead</th>
                <th className="px-4 py-3 font-semibold">Direction</th>
                <th className="px-4 py-3 font-semibold">Started</th>
                <th className="px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {calls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    {isLoadingCalls && calls.length === 0
                      ? "Loading active calls..."
                      : "No agents on a conference call right now."}
                  </td>
                </tr>
              ) : (
                calls.map((row) => {
                  const isRowListening = listeningConference === row.conference_name && isListening;
                  const isRowConnecting = connectingConference === row.conference_name && isConnecting;
                  const listenDisabled = !deviceReady || !conferenceEnabled || (isConnecting && !isRowConnecting);

                  return (
                    <tr key={row.id} className="border-t border-slate-800/80">
                      <td className="px-4 py-3">
                        <InCallBadge />
                      </td>
                      <td className="px-4 py-3 font-medium text-white">{row.agent_email}</td>
                      <td className="px-4 py-3 text-slate-200">{formatPhone(row.lead_phone)}</td>
                      <td className="px-4 py-3 capitalize text-slate-200">{row.direction}</td>
                      <td className="px-4 py-3 text-slate-400">
                        {new Date(row.created_at).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-3">
                        {isRowListening ? (
                          <button
                            type="button"
                            onClick={handleStopListen}
                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleListen(row)}
                            disabled={listenDisabled || isListening}
                            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isRowConnecting ? "Connecting..." : "Listen"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-500">
          Only calls routed through Twilio Conference appear here. Legacy one-to-one calls cannot be monitored
          until the agent starts a new conference-based call.
        </p>
      </section>
    </SuperadminShell>
  );
}
