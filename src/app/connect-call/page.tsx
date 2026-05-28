"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { TwilioMicSelector } from "@/components/twilio-mic-selector";
import { useTwilioDeviceContext } from "@/components/twilio-device-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { getAgentCallSid } from "@/lib/twilio-call";
import { normalizePhone } from "@/lib/utils";
import type { ConferenceParticipantRecord } from "@/types";

function isValidDialablePhone(phone: string): boolean {
  const digits = normalizePhone(phone).replace(/\D/g, "");
  return digits.length >= 10;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type ParticipantDialOutcome = "answered" | "not_answered" | "timeout";

async function waitForParticipantDialOutcome(
  callSid: string,
  options?: { pollMs?: number; maxAttempts?: number },
): Promise<ParticipantDialOutcome> {
  const pollMs = options?.pollMs ?? 2000;
  const maxAttempts = options?.maxAttempts ?? 35;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(pollMs);

    const res = await fetch(
      `/api/twilio/conference/participant-status?call_sid=${encodeURIComponent(callSid)}`,
    );
    const data = (await res.json()) as { outcome?: string; error?: string };
    if (!res.ok) continue;

    if (data.outcome === "answered") return "answered";
    if (data.outcome === "not_answered") return "not_answered";
  }

  return "timeout";
}

export default function ConnectCallPage() {
  const { deviceReady, callStatus, activeCall } = useTwilioDeviceContext();
  const supabase = getSupabaseBrowserClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ConferenceParticipantRecord[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const loadedUserIdRef = useRef<string | null>(null);
  const loadInFlightRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [connectingIds, setConnectingIds] = useState<Record<string, boolean>>({});
  const [connectedIds, setConnectedIds] = useState<Record<string, boolean>>({});
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [toast, setToast] = useState<{ tone: "success" | "warn"; message: string } | null>(null);
  const [conferenceReady, setConferenceReady] = useState<boolean | null>(null);
  const [conferenceHint, setConferenceHint] = useState("");
  const [serverConfig, setServerConfig] = useState<{
    conferenceCallsEnabled: boolean;
    webhookBaseUrl: string;
    webhookMatchesApp: boolean;
  } | null>(null);

  const canConnect = callStatus === "in-progress";
  const incomingCaller =
    callStatus === "ringing" ? (activeCall?.parameters.From ?? activeCall?.parameters.Caller) : null;

  const showToast = useCallback((tone: "success" | "warn", message: string) => {
    setToast({ tone, message });
  }, []);

  const loadParticipants = useCallback(async (resolvedUserId: string) => {
    if (loadInFlightRef.current) return;
    if (loadedUserIdRef.current === resolvedUserId) return;

    loadInFlightRef.current = true;
    const showLoadingUi = loadedUserIdRef.current !== resolvedUserId;
    if (showLoadingUi) setIsInitialLoading(true);
    setLoadError("");

    try {
      const res = await fetch(`/api/conference-participants?user_id=${encodeURIComponent(resolvedUserId)}`);
      const data = (await res.json()) as ConferenceParticipantRecord[] | { error?: string };
      if (!res.ok) {
        setLoadError((data as { error?: string }).error ?? "Failed to load saved contacts.");
        setParticipants([]);
        loadedUserIdRef.current = null;
        return;
      }
      setParticipants(data as ConferenceParticipantRecord[]);
      loadedUserIdRef.current = resolvedUserId;
    } catch {
      setLoadError("Failed to load saved contacts. Check your connection.");
      setParticipants([]);
      loadedUserIdRef.current = null;
    } finally {
      setIsInitialLoading(false);
      loadInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncUser = async (id: string | null) => {
      if (cancelled) return;
      setUserId(id);

      if (!id) {
        loadedUserIdRef.current = null;
        setLoadError("You must be signed in to manage connect contacts.");
        setParticipants([]);
        setIsInitialLoading(false);
        return;
      }

      if (loadedUserIdRef.current === id) return;

      setLoadError("");
      await loadParticipants(id);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncUser(session?.user?.id ?? null);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && loadedUserIdRef.current === null) {
        void syncUser(data.session?.user?.id ?? null);
      }
    });

    return () => {
      cancelled = true;
      loadInFlightRef.current = false;
      subscription.unsubscribe();
    };
  }, [loadParticipants, supabase]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/twilio/conference/config")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setServerConfig({
          conferenceCallsEnabled: Boolean(data.conferenceCallsEnabled),
          webhookBaseUrl: String(data.webhookBaseUrl ?? ""),
          webhookMatchesApp: Boolean(data.webhookMatchesApp),
        });
      })
      .catch(() => {
        if (!cancelled) setServerConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (callStatus !== "in-progress") return;

    const timer = window.setInterval(() => {
      setCallDurationSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(timer);
      setCallDurationSeconds(0);
      setConnectedIds({});
    };
  }, [callStatus]);

  useEffect(() => {
    if (callStatus !== "in-progress" || !userId) return;

    let cancelled = false;

    const checkConference = async () => {
      const agentCallSid = getAgentCallSid(activeCall);
      const params = new URLSearchParams({ user_id: userId });
      if (agentCallSid) params.set("agent_call_sid", agentCallSid);

      try {
        const res = await fetch(`/api/twilio/conference/active?${params.toString()}`);
        const data = (await res.json()) as { ready?: boolean; message?: string };
        if (cancelled) return;
        setConferenceReady(Boolean(data.ready));
        setConferenceHint(data.message ?? "");
      } catch {
        if (!cancelled) {
          setConferenceReady(null);
          setConferenceHint("");
        }
      }
    };

    void checkConference();
    const poll = window.setInterval(() => void checkConference(), 8000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [activeCall, callStatus, userId]);

  const displayCallDurationSeconds = callStatus === "in-progress" ? callDurationSeconds : 0;
  const connectedIdsForActiveCall = callStatus === "in-progress" ? connectedIds : {};

  const callStatusMeta = useMemo(() => {
    switch (callStatus) {
      case "in-progress":
        return {
          tone: "active" as const,
          title: "Call in progress",
          detail: "Connect adds this person to your live call with the lead (inbound or outbound).",
        };
      case "ringing":
        return {
          tone: "ringing" as const,
          title: "Incoming call ringing",
          detail: incomingCaller
            ? `Answer ${incomingCaller} on Leads or Callbacks, then return here to add someone.`
            : "Answer the call first, then use Connect on this page.",
        };
      case "ready":
        return {
          tone: "idle" as const,
          title: "No active call",
          detail: "Start or answer a call on Leads or Callbacks, then connect saved numbers here.",
        };
      case "registering":
        return {
          tone: "idle" as const,
          title: "Phone connecting…",
          detail: "Wait until the dialer is ready, then place or answer a call.",
        };
      default:
        return {
          tone: "idle" as const,
          title: deviceReady ? "No active call" : "Dialer unavailable",
          detail: "Sign in and ensure Twilio is configured, then start a call from Leads or Callbacks.",
        };
    }
  }, [callStatus, deviceReady, incomingCaller]);

  const handleAddParticipant = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!userId) {
      setFormError("Sign in to save contacts.");
      return;
    }

    const trimmedLabel = label.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedLabel) {
      setFormError("Add a label so you know who you are connecting (e.g. Manager, Billing).");
      return;
    }
    if (!trimmedPhone) {
      setFormError("Enter a phone number.");
      return;
    }
    if (!isValidDialablePhone(trimmedPhone)) {
      setFormError("Enter a valid phone number with at least 10 digits.");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/conference-participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, label: trimmedLabel, phone: trimmedPhone }),
      });
      const data = (await res.json()) as ConferenceParticipantRecord | { error?: string };
      if (!res.ok) {
        setFormError((data as { error?: string }).error ?? "Could not save contact.");
        return;
      }
      setParticipants((prev) => [...prev, data as ConferenceParticipantRecord]);
      setLabel("");
      setPhone("");
      showToast("success", "Contact saved to your account.");
    } catch {
      setFormError("Could not save contact. Check your connection.");
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (row: ConferenceParticipantRecord) => {
    setEditingId(row.id);
    setEditLabel(row.label);
    setEditPhone(row.phone);
    setFormError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditLabel("");
    setEditPhone("");
  };

  const saveEdit = async (id: string) => {
    if (!userId) return;

    const trimmedLabel = editLabel.trim();
    const trimmedPhone = editPhone.trim();

    if (!trimmedLabel || !trimmedPhone) {
      setFormError("Label and phone are required.");
      return;
    }
    if (!isValidDialablePhone(trimmedPhone)) {
      setFormError("Enter a valid phone number with at least 10 digits.");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/conference-participants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          user_id: userId,
          label: trimmedLabel,
          phone: trimmedPhone,
        }),
      });
      const data = (await res.json()) as ConferenceParticipantRecord | { error?: string };
      if (!res.ok) {
        setFormError((data as { error?: string }).error ?? "Could not update contact.");
        return;
      }
      setParticipants((prev) =>
        prev.map((p) => (p.id === id ? (data as ConferenceParticipantRecord) : p)),
      );
      cancelEdit();
      showToast("success", "Contact updated.");
    } catch {
      setFormError("Could not update contact. Check your connection.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeParticipant = async (id: string) => {
    if (!userId) return;

    setIsSaving(true);
    try {
      const res = await fetch("/api/conference-participants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, user_id: userId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        showToast("warn", data.error ?? "Could not remove contact.");
        return;
      }
      setParticipants((prev) => prev.filter((p) => p.id !== id));
      setConnectedIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (editingId === id) cancelEdit();
      showToast("success", "Contact removed.");
    } catch {
      showToast("warn", "Could not remove contact. Check your connection.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleConnect = async (row: ConferenceParticipantRecord) => {
    if (!canConnect || connectingIds[row.id] || connectedIdsForActiveCall[row.id]) return;
    if (!userId) {
      showToast("warn", "Sign in to connect calls.");
      return;
    }

    setConnectingIds((prev) => ({ ...prev, [row.id]: true }));

    try {
      const agentCallSid = getAgentCallSid(activeCall);

      const res = await fetch("/api/twilio/conference/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          participant_id: row.id,
          agent_call_sid: agentCallSid,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        label?: string;
        participantCallSid?: string;
      };
      if (!res.ok) {
        showToast("warn", data.error ?? "Could not connect this contact.");
        return;
      }

      const participantCallSid = data.participantCallSid;
      if (!participantCallSid) {
        showToast("warn", "Could not track this connection. Try Connect again.");
        return;
      }

      const dialOutcome = await waitForParticipantDialOutcome(participantCallSid);

      if (dialOutcome === "answered") {
        setConnectedIds((prev) => ({ ...prev, [row.id]: true }));
        showToast("success", `${row.label} joined the call.`);
        return;
      }

      const declineMessage =
        dialOutcome === "timeout"
          ? `${row.label} did not answer in time. You can try Connect call again.`
          : `${row.label} did not answer. You can try Connect call again.`;
      showToast("warn", declineMessage);
    } catch {
      showToast("warn", "Could not connect this contact. Check your connection.");
    } finally {
      setConnectingIds((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Connect Call</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              While you are on a call with a lead, connect a saved contact into the same conversation.
              Works for inbound and outbound once Twilio conference is wired up.
            </p>
          </div>
          <span className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
            3-way via Twilio Conference
          </span>
        </header>

        <section
          className={`rounded-2xl border p-5 shadow-sm ${
            callStatusMeta.tone === "active"
              ? "border-emerald-200 bg-emerald-50/60"
              : callStatusMeta.tone === "ringing"
                ? "border-amber-200 bg-amber-50/60"
                : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live call status</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{callStatusMeta.title}</p>
              <p className="mt-1 max-w-xl text-sm text-slate-600">{callStatusMeta.detail}</p>
              {callStatus === "in-progress" ? (
                <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                  On call · {formatDuration(displayCallDurationSeconds)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/leads"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Leads
              </Link>
              <Link
                href="/callbacks"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Callbacks
              </Link>
            </div>
          </div>
          <div className="mt-4 border-t border-slate-200/80 pt-4">
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
            <div className="mt-3">
              <TwilioMicSelector maxWidthClass="max-w-xl" />
            </div>
          </div>
        </section>

        {serverConfig && !serverConfig.conferenceCallsEnabled ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            <p className="font-semibold">Conference mode is off on this server</p>
            <p className="mt-1">
              Set <code className="rounded bg-rose-100 px-1">TWILIO_CONFERENCE_CALLS=true</code> on{" "}
              {serverConfig.webhookBaseUrl || "your deployed host"}, redeploy, then start a new call.
            </p>
          </div>
        ) : null}

        {callStatus === "in-progress" && conferenceReady === false && conferenceHint ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">Connect is not available on this call</p>
            <p className="mt-1">{conferenceHint}</p>
            <p className="mt-2 text-xs text-amber-800">
              Hang up and place a <strong>new</strong> call from Leads/Callbacks after deploying the latest code.
              Calls already connected stay on the old 1:1 line.
            </p>
          </div>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">How it works</h2>
          <ol className="mt-2 grid gap-2 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Talk to your lead",
                body: "Place or answer a call on Leads or Callbacks until you are connected.",
              },
              {
                step: "2",
                title: "Ask them to wait",
                body: "Let the lead know you are bringing someone else on the line.",
              },
              {
                step: "3",
                title: "Connect",
                body: "Return here and press Connect next to the person you need — everyone joins immediately.",
              },
            ].map((item) => (
              <li
                key={item.step}
                className="flex gap-2.5 rounded-lg border border-slate-100 bg-slate-50/80 p-2.5 sm:block"
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white sm:mb-1.5">
                  {item.step}
                </span>
                <div className="min-w-0 sm:block">
                  <p className="text-xs font-semibold leading-tight text-slate-900">{item.title}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
          <section className="flex min-h-80 flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:min-h-88">
            <h2 className="text-sm font-semibold text-slate-900">Add contact</h2>
            <p className="mt-1 text-xs text-slate-500">Saved to your account — shared across sessions.</p>
            <form onSubmit={(e) => void handleAddParticipant(e)} className="mt-5 flex flex-1 flex-col space-y-4">
              <div>
                <label
                  htmlFor="connect-label"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Label
                </label>
                <input
                  id="connect-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Sales manager"
                  className="h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label
                  htmlFor="connect-phone"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  Phone number
                </label>
                <input
                  id="connect-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 415 555 0199"
                  className="h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              {formError && !editingId ? (
                <p className="text-sm text-rose-600" role="alert">
                  {formError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={isSaving}
                className="mt-auto h-12 w-full rounded-lg bg-slate-900 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving…" : "Save contact"}
              </button>
              {!userId && !isInitialLoading ? (
                <p className="text-center text-xs text-amber-800">
                  Sign in to save contacts. If you are already signed in, refresh the page.
                </p>
              ) : null}
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Saved contacts</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                One Connect button per number — dials them into your current call when integration is live.
              </p>
            </div>

            {loadError ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-rose-600" role="alert">
                  {loadError}
                </p>
                {loadError.includes("conference_participants") || loadError.includes("schema cache") ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Run{" "}
                    <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">
                      app/migrations/20260518_conference_participants.sql
                    </code>{" "}
                    in the Supabase SQL editor.
                  </p>
                ) : null}
              </div>
            ) : isInitialLoading ? (
              <div className="px-5 py-12 text-center text-sm text-slate-500">Loading contacts…</div>
            ) : participants.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium text-slate-700">No contacts yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  Add managers, specialists, or other lines you connect often.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {participants.map((row) => {
                  const isEditing = editingId === row.id;
                  const isConnecting = Boolean(connectingIds[row.id]);
                  const isConnected = Boolean(connectedIdsForActiveCall[row.id]);
                  const connectDisabled = !canConnect || isConnecting || isConnected;

                  return (
                    <li key={row.id} className="px-5 py-4">
                      {isEditing ? (
                        <div className="space-y-3">
                          <input
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            aria-label="Edit label"
                            className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                          />
                          <input
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            aria-label="Edit phone"
                            className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                          />
                          {formError && editingId === row.id ? (
                            <p className="text-sm text-rose-600" role="alert">
                              {formError}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void saveEdit(row.id)}
                              disabled={isSaving}
                              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900">{row.label}</p>
                            <p className="truncate font-mono text-xs text-slate-500">{row.phone}</p>
                            {isConnected ? (
                              <span className="mt-1.5 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                                Connected this call
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleConnect(row)}
                              disabled={connectDisabled}
                              title={
                                !canConnect
                                  ? "Start or answer a call first"
                                  : isConnected
                                    ? "Already connected on this call"
                                    : `Connect ${row.label} to the live call`
                              }
                              className="inline-flex min-w-30 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                            >
                              {isConnecting ? (
                                <>
                                  <span
                                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                                    aria-hidden
                                  />
                                  Connecting…
                                </>
                              ) : isConnected ? (
                                "Connected"
                              ) : (
                                "Connect call"
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(row)}
                              className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeParticipant(row.id)}
                              disabled={isSaving}
                              className="rounded-lg border border-rose-100 px-2.5 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
            toast.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
          role="status"
        >
          {toast.message}
        </div>
      ) : null}
    </AppShell>
  );
}


