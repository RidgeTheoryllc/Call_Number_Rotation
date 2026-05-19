import twilio from "twilio";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";

export function isConferenceCallsEnabled(): boolean {
  const flag = process.env.TWILIO_CONFERENCE_CALLS?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function conferenceNameFromCallSid(callSid: string): string {
  const safe = callSid.replace(/[^A-Za-z0-9]/g, "");
  return `cnf-${safe}`;
}

export function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  }
  return twilio(accountSid, authToken);
}

export function getPublicBaseUrl(fallbackOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  return configured && configured.length > 0 ? configured : fallbackOrigin;
}

export function parseAgentUserIdFromClientIdentity(identity: string | null | undefined): string | null {
  if (!identity) return null;
  const trimmed = identity.trim();
  if (trimmed.startsWith("client:")) {
    return parseAgentUserIdFromClientIdentity(trimmed.slice("client:".length));
  }
  if (trimmed.startsWith("agent-")) {
    return trimmed.slice("agent-".length) || null;
  }
  return null;
}

export async function createConferenceSession(input: {
  userId: string;
  conferenceName: string;
  direction: "inbound" | "outbound";
  leadPhone: string;
  callerId: string;
  agentIdentity?: string | null;
  leadId?: string | null;
  parentCallSid?: string | null;
  agentCallSid?: string | null;
}) {
  const supabase = getSupabaseServerClient();
  await supabase
    .from("call_conference_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("user_id", input.userId)
    .eq("status", "active");

  const { data, error } = await supabase
    .from("call_conference_sessions")
    .insert({
      user_id: input.userId,
      conference_name: input.conferenceName,
      direction: input.direction,
      lead_phone: normalizePhone(input.leadPhone),
      caller_id: normalizePhone(input.callerId),
      agent_identity: input.agentIdentity ?? null,
      lead_id: input.leadId ?? null,
      parent_call_sid: input.parentCallSid ?? null,
      agent_call_sid: input.agentCallSid ?? null,
      status: "active",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getActiveConferenceSessionForUser(userId: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("call_conference_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type ConferenceConnectFailureCode =
  | "not_enabled"
  | "missing_agent_call_sid"
  | "no_live_conference"
  | "no_db_session";

export async function resolveConferenceSessionForConnect(input: {
  userId: string;
  agentCallSid?: string | null;
}): Promise<
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getActiveConferenceSessionForUser>>> }
  | { ok: false; code: ConferenceConnectFailureCode; message: string }
> {
  if (!isConferenceCallsEnabled()) {
    return {
      ok: false,
      code: "not_enabled",
      message:
        "Conference calling is not enabled on the server. Set TWILIO_CONFERENCE_CALLS=true and redeploy, then place a new call.",
    };
  }

  const supabase = getSupabaseServerClient();

  let session = await getActiveConferenceSessionForUser(input.userId);

  if (!session && input.agentCallSid) {
    const { data: bySid } = await supabase
      .from("call_conference_sessions")
      .select("*")
      .eq("agent_call_sid", input.agentCallSid)
      .eq("status", "active")
      .maybeSingle();
    session = bySid;
  }

  if (session) {
    return { ok: true, session };
  }

  const agentCallSid = input.agentCallSid?.trim();
  if (!agentCallSid) {
    return {
      ok: false,
      code: "missing_agent_call_sid",
      message:
        "Could not read your live call ID. Stay on this page during the call, or hang up and dial again from Leads/Callbacks.",
    };
  }

  const conferenceName = conferenceNameFromCallSid(agentCallSid);
  const client = getTwilioClient();

  const conferences = await client.conferences.list({
    friendlyName: conferenceName,
    status: "in-progress",
    limit: 1,
  });
  const liveConference = conferences[0];

  if (!liveConference) {
    return {
      ok: false,
      code: "no_live_conference",
      message:
        "This call is not on a conference line (likely started before conference mode was enabled). Hang up, confirm TWILIO_CONFERENCE_CALLS=true on your deployed server, then start a new call from Leads or Callbacks.",
    };
  }

  let leadPhone = "";
  let callerId = "";
  let direction: "inbound" | "outbound" = "outbound";

  const agentCall = await client.calls(agentCallSid).fetch();
  const childCalls = await client.calls.list({ parentCallSid: agentCallSid, limit: 20 });
  for (const child of childCalls) {
    const to = child.to ?? "";
    if (!to.startsWith("client:")) {
      leadPhone = normalizePhone(to);
      callerId = normalizePhone(child.from ?? "");
      direction = (child.direction ?? "").toLowerCase().includes("inbound") ? "inbound" : "outbound";
      break;
    }
  }

  if (!leadPhone) {
    const participants = await client.conferences(liveConference.sid).participants.list();
    for (const participant of participants) {
      if (!participant.callSid || participant.callSid === agentCallSid) continue;
      try {
        const participantCall = await client.calls(participant.callSid).fetch();
        const to = participantCall.to ?? "";
        if (!to.startsWith("client:")) {
          leadPhone = normalizePhone(to);
          callerId = normalizePhone(participantCall.from ?? "");
          break;
        }
        const from = participantCall.from ?? "";
        if (!from.startsWith("client:")) {
          leadPhone = normalizePhone(from);
          callerId = normalizePhone(participantCall.to ?? "");
          direction = "inbound";
          break;
        }
      } catch {
        // skip unreadable participant legs
      }
    }
  }

  if (!callerId) {
    callerId = normalizePhone(agentCall.from ?? "");
  }
  if (!leadPhone) {
    leadPhone = normalizePhone(agentCall.to?.replace(/^client:/, "") ?? "") || "unknown";
  }

  const { data: reactivated, error: reactivateError } = await supabase
    .from("call_conference_sessions")
    .update({
      status: "active",
      ended_at: null,
      agent_call_sid: agentCallSid,
      lead_phone: leadPhone,
      caller_id: callerId || leadPhone,
      direction,
    })
    .eq("conference_name", conferenceName)
    .select("*")
    .maybeSingle();
  if (reactivateError) throw reactivateError;

  if (reactivated) {
    return { ok: true, session: reactivated };
  }

  try {
    const created = await createConferenceSession({
      userId: input.userId,
      conferenceName,
      direction,
      leadPhone,
      callerId: callerId || leadPhone,
      agentIdentity: `agent-${input.userId}`,
      agentCallSid,
    });
    return { ok: true, session: created };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("call_conference_sessions") || message.includes("schema cache")) {
      return {
        ok: false,
        code: "no_db_session",
        message:
          "Conference database table is missing. Run app/migrations/20260518_call_conference_sessions.sql in Supabase, then place a new call.",
      };
    }
    throw error;
  }
}

export async function getActiveConferenceSessionByName(conferenceName: string) {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("call_conference_sessions")
    .select("*")
    .eq("conference_name", conferenceName)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function endConferenceSession(conferenceName: string) {
  const supabase = getSupabaseServerClient();
  await supabase
    .from("call_conference_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("conference_name", conferenceName)
    .eq("status", "active");
}

export function buildJoinConferenceTwiml(options: {
  conferenceName: string;
  callerId?: string;
  startConferenceOnEnter: boolean;
  endConferenceOnExit: boolean;
  record?: boolean;
  waitUrl?: string;
  statusCallback?: string;
}) {
  const response = new twilio.twiml.VoiceResponse();
  const dialAttrs: Record<string, string | boolean> = {};
  if (options.callerId) dialAttrs.callerId = options.callerId;
  if (options.record) dialAttrs.record = "record-from-ringing";

  const conferenceAttrs: Record<string, string | boolean> = {
    startConferenceOnEnter: options.startConferenceOnEnter,
    endConferenceOnExit: options.endConferenceOnExit,
    beep: "false",
  };
  if (options.waitUrl) conferenceAttrs.waitUrl = options.waitUrl;
  if (options.statusCallback) {
    conferenceAttrs.statusCallback = options.statusCallback;
    conferenceAttrs.statusCallbackEvent = "end";
  }

  const dial = response.dial(dialAttrs);
  dial.conference(conferenceAttrs, options.conferenceName);
  return response.toString();
}

export async function dialParticipantIntoConference(input: {
  baseUrl: string;
  to: string;
  from: string;
  conferenceName: string;
  startConferenceOnEnter?: boolean;
}) {
  const client = getTwilioClient();
  const joinUrl = new URL("/api/twilio/conference/join", input.baseUrl);
  joinUrl.searchParams.set("name", input.conferenceName);
  joinUrl.searchParams.set("callerId", input.from);
  joinUrl.searchParams.set(
    "moderator",
    input.startConferenceOnEnter ? "true" : "false",
  );

  return client.calls.create({
    to: input.to,
    from: input.from,
    url: joinUrl.toString(),
    method: "POST",
  });
}
