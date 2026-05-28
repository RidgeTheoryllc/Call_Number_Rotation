import type { Call } from "@twilio/voice-sdk";

/** Twilio Voice SDK call SID for the agent's browser leg. */
export function getAgentCallSid(call: Call | null): string | undefined {
  if (!call) return undefined;
  const params = call.parameters ?? {};
  const fromParams = params.CallSid ?? params.callSid;
  if (typeof fromParams === "string" && fromParams.length > 0) return fromParams;
  const outboundId = (call as Call & { outboundConnectionId?: string }).outboundConnectionId;
  if (typeof outboundId === "string" && outboundId.length > 0) return outboundId;
  return undefined;
}

const DTMF_PATTERN = /^[0-9*#w]+$/i;

/** Validates and returns Twilio sendDigits string (w = ~500ms pause). */
export function normalizeSendDigits(digits: string): string | null {
  const trimmed = digits.trim();
  if (!trimmed || !DTMF_PATTERN.test(trimmed)) return null;
  return trimmed;
}
