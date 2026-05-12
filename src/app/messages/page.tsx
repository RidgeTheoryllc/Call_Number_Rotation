"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";
import type { LeadRecord, MessageLogRecord, MessageStatus } from "@/types";

interface MessageConversation {
  id: string;
  leadId: string | null;
  leadName: string;
  phone: string;
  did: string;
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  messages: MessageLogRecord[];
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusTone(status: MessageStatus): string {
  if (status === "delivered" || status === "received") return "text-emerald-600";
  if (status === "failed" || status === "undelivered") return "text-rose-600";
  return "text-slate-400";
}

function buildConversations(messages: MessageLogRecord[]): MessageConversation[] {
  const conversationsByKey = new Map<string, MessageConversation>();

  for (const message of messages) {
    const key = `${message.phone}|${message.did}`;
    const existing = conversationsByKey.get(key);
    const leadName = message.lead_name?.trim() || "Unknown Lead";

    if (!existing) {
      conversationsByKey.set(key, {
        id: key,
        leadId: message.lead_id,
        leadName,
        phone: message.phone,
        did: message.did,
        lastMessage: message.body,
        lastTimestamp: message.timestamp,
        unreadCount: message.direction === "inbound" && message.status === "received" ? 1 : 0,
        messages: [message],
      });
      continue;
    }

    existing.messages.push(message);
    existing.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const latest = existing.messages[existing.messages.length - 1];
    existing.lastMessage = latest.body;
    existing.lastTimestamp = latest.timestamp;
    existing.leadId = existing.leadId ?? message.lead_id;
    existing.leadName = existing.leadName === "Unknown Lead" ? leadName : existing.leadName;
    if (message.direction === "inbound" && message.status === "received") existing.unreadCount += 1;
  }

  return [...conversationsByKey.values()].sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime(),
  );
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<MessageLogRecord[]>([]);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [isLeadPickerOpen, setIsLeadPickerOpen] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const hasLoadedMessagesRef = useRef(false);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const conversations = useMemo(() => buildConversations(messages), [messages]);
  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations;

    return conversations.filter((conversation) =>
      [conversation.leadName, conversation.phone, conversation.did, conversation.lastMessage]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [conversations, searchQuery]);

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;
  const matchingLeadConversation = selectedLead
    ? conversations.find(
        (conversation) =>
          normalizePhone(conversation.phone) === normalizePhone(selectedLead.phone) || conversation.leadId === selectedLead.id,
      ) ?? null
    : null;
  const selectedConversation = selectedLead
    ? matchingLeadConversation
    : filteredConversations.find((conversation) => conversation.id === selectedConversationId) ??
      filteredConversations[0] ??
      null;
  const activeConversationLeadId = selectedConversation?.leadId ?? null;
  const activeLead = selectedConversation
    ? leads.find((lead) => lead.id === activeConversationLeadId) ?? null
    : selectedLead;
  const canSendMessage = Boolean(userId && draftMessage.trim() && (selectedConversation || selectedLead));

  const loadMessages = useCallback(
    async (resolvedUserId?: string | null) => {
      let activeUserId = resolvedUserId ?? userId;
      if (!activeUserId) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        activeUserId = user?.id ?? null;
      }

      if (!activeUserId) {
        setError("You must be signed in to view messages.");
        setMessages([]);
        setLeads([]);
        setIsLoading(false);
        return;
      }

      setUserId(activeUserId);
      if (!hasLoadedMessagesRef.current) setIsLoading(true);
      try {
        const [messagesRes, leadsRes] = await Promise.all([
          fetch(`/api/messages?user_id=${encodeURIComponent(activeUserId)}`),
          fetch(`/api/leads?user_id=${encodeURIComponent(activeUserId)}`),
        ]);
        const [messagesJson, leadsJson] = await Promise.all([messagesRes.json(), leadsRes.json()]);

        if (!messagesRes.ok) {
          setError(messagesJson.error ?? "Failed to load messages.");
          return;
        }
        if (!leadsRes.ok) {
          setError(leadsJson.error ?? "Failed to load leads.");
          return;
        }

        setMessages(messagesJson as MessageLogRecord[]);
        setLeads(leadsJson as LeadRecord[]);
        setError("");
      } finally {
        hasLoadedMessagesRef.current = true;
        setIsLoading(false);
      }
    },
    [supabase, userId],
  );

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => {
      void loadMessages();
    }, 0);
    const intervalId = window.setInterval(() => {
      void loadMessages();
    }, 10000);
    return () => {
      window.clearTimeout(initialLoadTimer);
      window.clearInterval(intervalId);
    };
  }, [loadMessages]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const leadIdFromQuery = new URLSearchParams(window.location.search).get("lead_id");
      if (leadIdFromQuery) setSelectedLeadId(leadIdFromQuery);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!userId || !canSendMessage || isSending) return;

    setIsSending(true);
    setError("");
    try {
      const res = await fetch("/api/twilio/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          lead_id: selectedConversation?.leadId ?? selectedLead?.id ?? undefined,
          phone: selectedConversation?.phone ?? selectedLead?.phone ?? undefined,
          did: selectedConversation?.did ?? selectedLead?.assigned_did ?? undefined,
          body: draftMessage,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to send message.");
        return;
      }

      const inserted = json as MessageLogRecord;
      setMessages((prev) => [...prev, inserted]);
      setSelectedConversationId(`${inserted.phone}|${inserted.did}`);
      setSelectedLeadId("");
      setDraftMessage("");
      void loadMessages(userId);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <AppShell>
      <section className="mx-auto flex h-[calc(100vh-4rem)] max-h-[820px] min-h-[640px] max-w-7xl flex-col gap-4 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Messages</h1>
            <p className="mt-1 text-sm text-slate-500">Send and receive SMS conversations with leads.</p>
          </div>
          <span className="inline-flex rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
            {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
          </span>
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[420px_1fr]">
          <aside className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-3 border-b border-slate-100 p-4">
              <label htmlFor="message-search" className="sr-only">Search messages</label>
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  id="message-search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search conversations"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-200 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div className="relative">
                <span className="mb-1 block text-xs font-medium text-slate-500">
                  Start a text
                </span>
                <button
                  type="button"
                  onClick={() => setIsLeadPickerOpen((prev) => !prev)}
                  disabled={leads.length === 0}
                  className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm text-slate-900 outline-none transition hover:border-indigo-200 hover:bg-slate-50 focus:border-indigo-200 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0">
                    {selectedLead ? (
                      <>
                        <span className="block truncate font-semibold">{selectedLead.name}</span>
                        <span className="block truncate text-xs text-slate-500">{selectedLead.phone}</span>
                      </>
                    ) : (
                      <span className="text-slate-500">Choose a lead</span>
                    )}
                  </span>
                  <svg
                    className={`h-4 w-4 shrink-0 text-slate-400 transition ${isLeadPickerOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>

                {isLeadPickerOpen ? (
                  <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLeadId("");
                        setSelectedConversationId(null);
                        setDraftMessage("");
                        setIsLeadPickerOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-slate-50"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                        -
                      </span>
                      <span>Choose a lead</span>
                    </button>
                    {leads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => {
                          setSelectedLeadId(lead.id);
                          setSelectedConversationId(null);
                          setDraftMessage("");
                          setIsLeadPickerOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                          selectedLeadId === lead.id ? "bg-indigo-50 text-indigo-900" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                          {lead.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{lead.name}</span>
                          <span className="block truncate text-xs text-slate-500">{lead.phone}</span>
                        </span>
                        {selectedLeadId === lead.id ? (
                          <svg className="h-4 w-4 shrink-0 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="m20 6-11 11-5-5" />
                          </svg>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {isLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                  Loading messages...
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                    </svg>
                  </div>
                  <h2 className="mt-3 text-sm font-semibold text-slate-900">No conversations yet</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Choose a lead above or use Send SMS from the Leads page to start a thread.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredConversations.map((conversation) => {
                    const isSelected = selectedConversation?.id === conversation.id;

                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => {
                          setSelectedConversationId(conversation.id);
                          setSelectedLeadId("");
                        }}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          isSelected
                            ? "border-indigo-200 bg-indigo-50 shadow-sm"
                            : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                            {conversation.leadName.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-semibold text-slate-900">{conversation.leadName}</p>
                              <span className="shrink-0 text-[11px] text-slate-400">
                                {formatConversationTime(conversation.lastTimestamp)}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-500">{conversation.phone}</p>
                            <p className="mt-1 truncate text-xs text-slate-500">{conversation.lastMessage}</p>
                          </div>
                          {conversation.unreadCount > 0 ? (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[11px] font-semibold text-white">
                              {conversation.unreadCount}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {selectedConversation || selectedLead ? (
              <>
                <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                      {(selectedConversation?.leadName ?? selectedLead?.name ?? "L").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-slate-900">
                        {selectedConversation?.leadName ?? selectedLead?.name ?? "New message"}
                      </h2>
                      <p className="truncate text-xs text-slate-500">
                        {selectedConversation
                          ? `${selectedConversation.phone} via ${selectedConversation.did}`
                          : `${selectedLead?.phone ?? ""}${selectedLead?.assigned_did ? ` via ${selectedLead.assigned_did}` : ""}`}
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    SMS
                  </span>
                </header>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 px-5 py-5">
                  {selectedConversation ? (
                    selectedConversation.messages.map((message) => {
                      const isOutbound = message.direction === "outbound";

                      return (
                        <div key={message.id} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[78%] ${isOutbound ? "text-right" : "text-left"}`}>
                            <div
                              className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                                isOutbound
                                  ? "rounded-br-md bg-indigo-600 text-white"
                                  : "rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200"
                              }`}
                            >
                              {message.body}
                            </div>
                            <div className={`mt-1 flex items-center gap-2 text-[11px] ${isOutbound ? "justify-end" : "justify-start"}`}>
                              <span className="text-slate-400">{formatMessageTime(message.timestamp)}</span>
                              {isOutbound ? (
                                <span className={getStatusTone(message.status)}>{message.status}</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <div className="rounded-full bg-white p-3 text-indigo-500 shadow-sm">
                        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                        </svg>
                      </div>
                      <h2 className="mt-3 text-sm font-semibold text-slate-900">New conversation</h2>
                      <p className="mt-1 text-sm text-slate-500">Write the first SMS to {selectedLead?.name}.</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-slate-50 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-indigo-500 shadow-sm">
                  <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                  </svg>
                </div>
                <h2 className="mt-4 text-base font-semibold text-slate-900">Select a conversation</h2>
                <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
                  Choose an existing thread or start a new text from the lead picker.
                </p>
              </div>
            )}

            <footer className="border-t border-slate-100 bg-white p-4">
              <form onSubmit={sendMessage} className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
                <textarea
                  value={draftMessage}
                  onChange={(event) => setDraftMessage(event.target.value)}
                  disabled={!selectedConversation && !selectedLead}
                  placeholder={selectedConversation || selectedLead ? "Type your message here..." : "Choose a lead to start messaging"}
                  rows={1}
                  className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={!canSendMessage || isSending}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isSending ? "Sending..." : "Send"}
                </button>
              </form>
              {activeLead ? (
                <p className="mt-2 text-xs text-slate-400">
                  Replies will stay in this thread using the same DID when available.
                </p>
              ) : null}
            </footer>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
