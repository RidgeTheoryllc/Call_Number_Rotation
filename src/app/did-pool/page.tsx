"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useWorkspaceDataCache } from "@/components/workspace-data-cache";
import { Badge } from "@/components/ui";
import { getDidWarmupCap } from "@/lib/did-engine";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";
import type { DidRecord } from "@/types";

type ConfigureResult = {
  did: string;
  status: "updated" | "not_found_in_twilio" | "error";
  voiceUrl?: string;
  error?: string;
};

type ConfigureSummary = {
  inboundUrl: string;
  total: number;
  updated: number;
  missing: number;
  errors: number;
  results: ConfigureResult[];
};

type MessagingConfigureRow = {
  did: string;
  status: "updated" | "not_found_in_twilio" | "error";
  smsUrl?: string;
  statusCallback?: string;
  error?: string;
};

type MessagingConfigureSummary = {
  smsUrl: string;
  statusCallbackUrl: string;
  updated: MessagingConfigureRow[];
};

export default function DidPoolPage() {
  const [dids, setDids] = useState<DidRecord[]>([]);
  const [did, setDid] = useState("");
  const [areaCode, setAreaCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [defaultMessagingDid, setDefaultMessagingDid] = useState<string | null>(null);
  const [smsDefaultSavingId, setSmsDefaultSavingId] = useState<string | null>(null);
  const [deletingDidIds, setDeletingDidIds] = useState<Record<string, boolean>>({});
  const [didPendingDelete, setDidPendingDelete] = useState<DidRecord | null>(null);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [isConfiguringMessaging, setIsConfiguringMessaging] = useState(false);
  const [configureSummary, setConfigureSummary] = useState<ConfigureSummary | null>(null);
  const [messagingConfigureSummary, setMessagingConfigureSummary] = useState<MessagingConfigureSummary | null>(null);
  const supabase = getSupabaseBrowserClient();
  const workspaceCache = useWorkspaceDataCache();

  const load = useCallback(async () => {
    if (!userId) {
      setDids([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/did-pool?user_id=${encodeURIComponent(userId)}`);
      const json = await res.json();
      let nextDids: DidRecord[] = [];
      if (res.ok) {
        nextDids = json as DidRecord[];
        setDids(nextDids);
      }

      const prefRes = await fetch(`/api/user/messaging-default?user_id=${encodeURIComponent(userId)}`);
      const prefJson = await prefRes.json();
      let nextDefault: string | null = null;
      if (prefRes.ok) {
        nextDefault = prefJson.default_messaging_did ?? null;
        setDefaultMessagingDid(nextDefault);
      }

      if (res.ok) {
        workspaceCache.setCachedDidPool(userId, { dids: nextDids, defaultMessagingDid: nextDefault });
      }
    } finally {
      setIsLoading(false);
    }
  }, [userId, workspaceCache]);

  useEffect(() => {
    const bootstrap = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        setError("You must be signed in to view DID pool.");
        setDids([]);
        setIsLoading(false);
        return;
      }

      setUserId(user.id);
    };

    void bootstrap();
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    const cached = workspaceCache.getCachedDidPool(userId);
    if (cached !== null) {
      queueMicrotask(() => {
        setDids(cached.dids);
        setDefaultMessagingDid(cached.defaultMessagingDid);
        setIsLoading(false);
      });
      return;
    }
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [userId, workspaceCache, load]);

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!userId) {
      setError("You must be signed in to add a DID.");
      return;
    }

    const res = await fetch("/api/did-pool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ did, area_code: areaCode, user_id: userId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Failed to add DID");
      return;
    }
    setDid("");
    setAreaCode("");
    await load();
  };

  const updateStatus = async (id: string, status: "active" | "cooldown") => {
    if (!userId) {
      setError("You must be signed in to update DID status.");
      return;
    }

    await fetch("/api/did-pool", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, user_id: userId, status }),
    });
    load();
  };

  const configureInboundWebhooks = async () => {
    if (!userId) {
      setError("You must be signed in to configure inbound webhooks.");
      return;
    }
    setError("");
    setConfigureSummary(null);
    setMessagingConfigureSummary(null);
    setIsConfiguring(true);
    try {
      const res = await fetch("/api/twilio/configure-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to configure inbound webhooks.");
        return;
      }
      setConfigureSummary(json as ConfigureSummary);
    } finally {
      setIsConfiguring(false);
    }
  };

  const configureSmsWebhooks = async () => {
    if (!userId) {
      setError("You must be signed in to configure SMS webhooks.");
      return;
    }
    setError("");
    setMessagingConfigureSummary(null);
    setConfigureSummary(null);
    setIsConfiguringMessaging(true);
    try {
      const res = await fetch("/api/twilio/configure-messaging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to configure SMS webhooks.");
        return;
      }
      setMessagingConfigureSummary(json as MessagingConfigureSummary);
    } finally {
      setIsConfiguringMessaging(false);
    }
  };

  const setMessagingDefaultDid = async (didValue: string | null, busyKey: string) => {
    if (!userId) {
      setError("You must be signed in to set SMS default.");
      return;
    }
    setError("");
    setSmsDefaultSavingId(busyKey);
    try {
      const res = await fetch("/api/user/messaging-default", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          default_messaging_did: didValue,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to update SMS default.");
        return;
      }
      const next = json.default_messaging_did ?? null;
      setDefaultMessagingDid(next);
      workspaceCache.setCachedDidPool(userId, { dids, defaultMessagingDid: next });
    } finally {
      setSmsDefaultSavingId(null);
    }
  };

  const deleteDid = async (id: string) => {
    setError("");

    if (!userId) {
      setError("You must be signed in to delete DIDs.");
      return;
    }
    if (deletingDidIds[id]) return;
    setDeletingDidIds((prev) => ({ ...prev, [id]: true }));

    try {
      const res = await fetch("/api/did-pool", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, user_id: userId }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to delete DID");
        return;
      }

      await load();
    } finally {
      setDeletingDidIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  const rows = useMemo(
    () =>
      dids.map((row) => ({
        ...row,
        badPerformer: row.answer_rate < 20 || row.spam_score > 70,
        dailyCap: getDidWarmupCap(row),
      })),
    [dids],
  );

  return (
    <AppShell>
      <section className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">DID Pool Management</h1>
            <p className="mt-1 text-sm text-slate-500">
              Per-number rotation health and suppression controls. Pick one active DID as your default for SMS; calling still uses rotation. If Twilio uses
              &quot;Defer to sender&quot; on your Messaging Service, run <strong>Configure SMS webhooks</strong> so replies reach this app.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={configureInboundWebhooks}
            disabled={isConfiguring || isConfiguringMessaging || !userId || dids.length === 0}
            title="Point each DID's voice webhook at /api/twilio/inbound so callbacks ring the agent."
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isConfiguring ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
            ) : (
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M12 2v4" />
                <path d="M12 18v4" />
                <path d="M4.93 4.93l2.83 2.83" />
                <path d="M16.24 16.24l2.83 2.83" />
                <path d="M2 12h4" />
                <path d="M18 12h4" />
                <path d="M4.93 19.07l2.83-2.83" />
                <path d="M16.24 7.76l2.83-2.83" />
              </svg>
            )}
            Configure inbound webhooks
          </button>
          <button
            type="button"
            onClick={() => void configureSmsWebhooks()}
            disabled={isConfiguring || isConfiguringMessaging || !userId || dids.length === 0}
            title="Sets each pool DID's Twilio Messaging URL to /api/twilio/messages/inbound (required when Messaging Service uses Defer to sender)."
            className="inline-flex h-9 items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isConfiguringMessaging ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-800" />
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            )}
            Configure SMS webhooks
          </button>
          </div>
        </div>

        {configureSummary ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {configureSummary.updated} updated
              </span>
              {configureSummary.missing > 0 ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  {configureSummary.missing} not found in Twilio
                </span>
              ) : null}
              {configureSummary.errors > 0 ? (
                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
                  {configureSummary.errors} errors
                </span>
              ) : null}
              <span className="text-xs text-slate-500">
                Inbound URL: <code className="font-mono">{configureSummary.inboundUrl}</code>
              </span>
            </div>
            {configureSummary.errors > 0 || configureSummary.missing > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {configureSummary.results
                  .filter((r) => r.status !== "updated")
                  .map((r) => (
                    <li key={r.did} className="font-mono">
                      <span className="text-slate-900">{r.did}</span>{" "}
                      <span className="text-slate-500">
                        — {r.status === "not_found_in_twilio" ? "not in Twilio account" : r.error}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {messagingConfigureSummary ? (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 text-sm shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                {messagingConfigureSummary.updated.filter((r) => r.status === "updated").length} SMS webhooks updated
              </span>
              {messagingConfigureSummary.updated.filter((r) => r.status === "not_found_in_twilio").length > 0 ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  {messagingConfigureSummary.updated.filter((r) => r.status === "not_found_in_twilio").length} not found in Twilio
                </span>
              ) : null}
              {messagingConfigureSummary.updated.filter((r) => r.status === "error").length > 0 ? (
                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">
                  {messagingConfigureSummary.updated.filter((r) => r.status === "error").length} errors
                </span>
              ) : null}
              <span className="text-xs text-slate-600">
                Messaging URL: <code className="font-mono">{messagingConfigureSummary.smsUrl}</code>
              </span>
            </div>
            {messagingConfigureSummary.updated.some((r) => r.status !== "updated") ? (
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {messagingConfigureSummary.updated
                  .filter((r) => r.status !== "updated")
                  .map((r) => (
                    <li key={r.did} className="font-mono">
                      <span className="text-slate-900">{r.did}</span>{" "}
                      <span className="text-slate-500">
                        — {r.status === "not_found_in_twilio" ? "not in Twilio account" : r.error}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <form
          onSubmit={onAdd}
          className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-4"
        >
          <input
            value={did}
            onChange={(e) => setDid(e.target.value)}
            placeholder="+1 212 555 0100"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            required
          />
          <input
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value)}
            placeholder="Area code (optional)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
          <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
            Add DID
          </button>
        </form>
        {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Phone</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">SMS default</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Area</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Calls Today</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Total Calls</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Answer Rate</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Spam Score</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`transition hover:bg-slate-50/70 ${row.badPerformer ? "bg-rose-50/60" : ""}`}
                >
                  <td className="px-4 py-3 font-medium text-slate-900">{row.did}</td>
                  <td className="px-4 py-3">
                    {defaultMessagingDid && normalizePhone(row.did) === normalizePhone(defaultMessagingDid) ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-800">
                          Default
                        </span>
                        <button
                          type="button"
                          onClick={() => void setMessagingDefaultDid(null, "clear")}
                          disabled={smsDefaultSavingId !== null}
                          className="text-xs font-semibold text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {smsDefaultSavingId === "clear" ? "Clearing…" : "Clear"}
                        </button>
                      </div>
                    ) : row.status === "active" ? (
                      <button
                        type="button"
                        onClick={() => void setMessagingDefaultDid(row.did, row.id)}
                        disabled={smsDefaultSavingId !== null}
                        className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {smsDefaultSavingId === row.id ? "Saving…" : "Use for SMS"}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.area_code || "-"}</td>
                  <td className="px-4 py-3">
                    <Badge
                      value={row.status}
                      tone={row.status === "active" ? "good" : row.status === "cooldown" ? "warn" : "bad"}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <span className="font-semibold text-slate-900">{row.calls_today}</span>
                    <span className="text-slate-400"> / {row.dailyCap}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.total_calls}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        row.answer_rate >= 40 ? "bg-emerald-100 text-emerald-700" : row.answer_rate >= 20 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {row.answer_rate}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        row.spam_score > 70 ? "bg-rose-100 text-rose-700" : row.spam_score > 40 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {row.spam_score}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {row.status === "active" ? (
                        <button
                          onClick={() => updateStatus(row.id, "cooldown")}
                          className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-200"
                        >
                          Pause
                        </button>
                      ) : (
                        <button
                          onClick={() => updateStatus(row.id, "active")}
                          className="rounded-md bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-200"
                        >
                          Resume
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDidPendingDelete(row)}
                        disabled={Boolean(deletingDidIds[row.id])}
                        aria-label={`Delete ${row.did}`}
                        title="Delete DID"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-rose-50 text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingDidIds[row.id] ? (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-rose-300 border-t-rose-700" />
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                    Loading DID pool...
                  </td>
                </tr>
              ) : null}
              {!isLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                    No DIDs yet. Add a DID to begin rotation.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </div>
      </section>

      {didPendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-rose-100">
              <svg
                className="h-5 w-5 text-rose-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-slate-900">Delete this DID?</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              <span className="font-medium text-slate-800">{didPendingDelete.did}</span> will be permanently removed from your DID pool.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDidPendingDelete(null)}
                className="h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void deleteDid(didPendingDelete.id).then(() => {
                    setDidPendingDelete(null);
                  });
                }}
                disabled={Boolean(deletingDidIds[didPendingDelete.id])}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingDidIds[didPendingDelete.id] ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-rose-300 border-t-white" />
                ) : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
