"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
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
  const [isMuted, setIsMuted] = useState(false);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const { identity, deviceReady, callStatus, activeCall, deviceError, hangup, mute } = useTwilioDevice();
  const LEADS_PER_PAGE = 10;
  const supabase = getSupabaseBrowserClient();

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

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
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) {
        setError("You must be signed in to view leads.");
        setLeads([]);
        setIsLoading(false);
        return;
      }

      setUserId(user.id);
    };

    void bootstrap();
  }, [supabase]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const addLead = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId) {
      setError("You must be signed in to add leads.");
      return;
    }

    await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, user_id: userId }),
    });
    setName("");
    setPhone("");
    load();
    setCurrentPage(1);
  };

  const onCsvUpload = async (file: File) => {
    if (!userId) {
      setError("You must be signed in to upload leads.");
      return;
    }

    const text = await file.text();
    const parsed = Papa.parse<{ name: string; phone: string }>(text, {
      header: true,
      skipEmptyLines: true,
    });
    const valid = parsed.data.filter((row) => row.phone).map((row) => ({ ...row, user_id: userId }));
    await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valid),
    });
    load();
    setCurrentPage(1);
  };

  const dialLead = async (lead: LeadRecord) => {
    if (callingLeadIds[lead.id]) return;

    setCallingLeadIds((prev) => ({ ...prev, [lead.id]: true }));
    setError("");
    setCallDurationSeconds(0);
    try {
      const rotateRes = await fetch("/api/rotate-did", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadPhone: lead.phone }),
      });
      const rotateData = await rotateRes.json();
      if (!rotateRes.ok) {
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
        }),
      });
      const callData = await callRes.json();
      if (!callRes.ok) {
        setError(callData.error ?? "Call failed.");
        return;
      }

      await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: lead.id,
          user_id: userId,
          status: "dialed",
          assigned_did: rotateData.did,
        }),
      });

      await load();
      setCurrentPage(1);
    } finally {
      setCallingLeadIds((prev) => ({ ...prev, [lead.id]: false }));
    }
  };

  return (
    <AppShell>
      <section className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Leads Management</h1>
          <p className="mt-1 text-sm text-slate-500">Import, route, and execute calls against pending leads.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium ${
                deviceReady ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${deviceReady ? "bg-emerald-500" : "bg-rose-500"}`} />
              {deviceReady ? "Device ready" : "Device not ready"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">Identity: {identity || "loading..."}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">Call status: {callStatus}</span>
            {callStatus === "in-progress" ? (
              <span className="rounded-full bg-indigo-50 px-3 py-1 font-medium text-indigo-700">
                Duration: {formatDuration(callDurationSeconds)}
              </span>
            ) : null}
          </div>
          {deviceError ? <p className="mt-3 text-sm font-medium text-rose-600">{deviceError}</p> : null}
          {activeCall ? (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => {
                  const nextMuted = !isMuted;
                  mute(nextMuted);
                  setIsMuted(nextMuted);
                }}
                className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-200"
              >
                {isMuted ? "Unmute" : "Mute"}
              </button>
              <button
                onClick={() => {
                  hangup();
                  setCallDurationSeconds(0);
                }}
                className="rounded-md bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-200"
              >
                Hang Up
              </button>
            </div>
          ) : null}
        </div>

        <form
          onSubmit={addLead}
          className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-4"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lead name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            required
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 415 555 0102"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            required
          />
          <label className="flex items-center rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700">
            CSV Upload
            <input
              type="file"
              accept=".csv"
              className="ml-2 w-full text-xs text-slate-500 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onCsvUpload(f);
              }}
            />
          </label>
          <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
            Add Lead
          </button>
        </form>
        {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Area Code</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Assigned DID</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLeads.map((lead) => (
                <tr key={lead.id} className="border-t border-slate-100 transition hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-900">{lead.name}</td>
                  <td className="px-3 py-2 text-slate-700">{lead.phone}</td>
                  <td className="px-3 py-2 text-slate-700">{lead.area_code}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
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
                  <td className="px-3 py-2 text-slate-700">{lead.assigned_did ?? "-"}</td>
                  <td className="px-3 py-2 text-slate-700">{lead.result ?? "-"}</td>
                  <td className="px-3 py-2">
                    <button
                      disabled={Boolean(callingLeadIds[lead.id]) || !deviceReady || !identity}
                      onClick={() => dialLead(lead)}
                      className="w-20 rounded-md bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {callingLeadIds[lead.id]
                        ? "Calling..."
                        : lead.status === "completed"
                          ? "Redial"
                          : "Dial Now"}
                    </button>
                  </td>
                </tr>
              ))}
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                    Loading leads...
                  </td>
                </tr>
              ) : null}
              {!isLoading && leads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                    No leads yet. Add a lead or upload a CSV to get started.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {leads.length > 0 ? (
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-sm text-slate-600">
              Showing <span className="font-semibold text-slate-800">{pageStart + 1}</span>-
              <span className="font-semibold text-slate-800">{Math.min(pageStart + LEADS_PER_PAGE, leads.length)}</span> of{" "}
              <span className="font-semibold text-slate-800">{leads.length}</span> leads
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={safeCurrentPage === 1}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                Page {safeCurrentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={safeCurrentPage === totalPages}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
