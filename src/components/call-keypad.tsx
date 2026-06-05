"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call } from "@twilio/voice-sdk";
import { getAgentCallSid } from "@/lib/twilio-call";

const KEYPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;

type CallKeypadProps = {
  userId: string | null;
  activeCall: Call | null;
  sendClientDigits: (digits: string) => void;
  disabled?: boolean;
};

export function CallKeypad({ userId, activeCall, sendClientDigits, disabled }: CallKeypadProps) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  const queuedDigitsRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFlushingRef = useRef(false);

  const sendDigitsPayload = useCallback(
    async (payload: string) => {
      setSending(true);

      try {
        const agentCallSid = getAgentCallSid(activeCall);

        if (userId) {
          const res = await fetch("/api/twilio/send-digits", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: userId,
              agent_call_sid: agentCallSid,
              digits: payload,
            }),
          });
          const data = (await res.json()) as {
            success?: boolean;
            fallback?: string;
            error?: string;
            message?: string;
          };

          if (res.ok && data.success) {
            setFeedback(`Sent ${payload.toUpperCase()}`);
            return;
          }

          if (data.fallback === "client" && activeCall) {
            sendClientDigits(payload);
            setFeedback(`Sent ${payload.toUpperCase()}`);
            return;
          }

          if (data.error) {
            setFeedback(data.error);
            return;
          }
        }

        if (activeCall) {
          sendClientDigits(payload);
          setFeedback(`Sent ${payload.toUpperCase()}`);
        } else {
          setFeedback("No active call");
        }
      } catch {
        if (activeCall) {
          sendClientDigits(payload);
          setFeedback(`Sent ${payload.toUpperCase()}`);
        } else {
          setFeedback("Could not send tone");
        }
      } finally {
        setSending(false);
        setTimeout(() => setFeedback(""), 2000);
      }
    },
    [activeCall, sendClientDigits, userId],
  );

  const flushQueuedDigits = useCallback(async () => {
    if (isFlushingRef.current || !queuedDigitsRef.current) return;
    isFlushingRef.current = true;
    const payload = queuedDigitsRef.current;
    queuedDigitsRef.current = "";

    try {
      await sendDigitsPayload(payload);
    } finally {
      isFlushingRef.current = false;
      if (queuedDigitsRef.current) {
        flushTimerRef.current = setTimeout(() => {
          void flushQueuedDigits();
        }, 0);
      }
    }
  }, [sendDigitsPayload]);

  const sendDigit = useCallback(
    (digit: string) => {
      if (disabled) return;

      const payload = digit === "Pause" ? "w" : digit;
      queuedDigitsRef.current += payload;
      setFeedback(`Queued ${queuedDigitsRef.current.toUpperCase()}`);

      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
      flushTimerRef.current = setTimeout(() => {
        void flushQueuedDigits();
      }, 200);
    },
    [disabled, flushQueuedDigits],
  );

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="4" y="4" width="6" height="6" rx="1" />
          <rect x="14" y="4" width="6" height="6" rx="1" />
          <rect x="4" y="14" width="6" height="6" rx="1" />
          <rect x="14" y="14" width="6" height="6" rx="1" />
        </svg>
        {open ? "Hide keypad" : "IVR keypad"}
      </button>

      {open ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Voicemail / press 1–9 — wait for the prompt, then tap
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {KEYPAD_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => void sendDigit(key)}
                className="flex h-9 items-center justify-center rounded-md bg-white text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:bg-indigo-50 hover:text-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {key}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void sendDigit("Pause")}
            className="mt-1.5 w-full rounded-md bg-white py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending..." : "Pause (1/2s)"}
          </button>
          {feedback ? (
            <p className="mt-1.5 text-center text-[10px] font-medium text-indigo-600">{feedback}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
