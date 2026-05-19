import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import {
  conferenceNameFromCallSid,
  createConferenceSession,
  getPublicBaseUrl,
  getTwilioClient,
  isConferenceCallsEnabled,
} from "@/lib/twilio-conference";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";

const HOLD_RETRY_LIMIT = 6;

function toInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolvePublicBaseUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  return configured && configured.length > 0 ? configured : req.nextUrl.origin;
}

async function resolveUserIdFromDid(didNumber: string): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  const normalizedDid = normalizePhone(didNumber);
  const normalizedDigits = normalizedDid.replace(/\D/g, "");
  const last10 = normalizedDigits.slice(-10);

  const { data: direct } = await supabase
    .from("did_pool")
    .select("user_id")
    .eq("did", didNumber)
    .maybeSingle();
  if (direct?.user_id) return direct.user_id;

  const { data: rows, error } = await supabase.from("did_pool").select("did, user_id");
  if (error) return null;
  const matched = (rows ?? []).find((row) => {
    const rowNormalized = normalizePhone(String(row.did));
    if (rowNormalized === normalizedDid) return true;

    const rowDigits = rowNormalized.replace(/\D/g, "");
    if (rowDigits === normalizedDigits) return true;

    // Fallback for numbers stored without country code formatting.
    if (last10.length === 10 && rowDigits.slice(-10) === last10) return true;
    return false;
  });
  return matched?.user_id ?? null;
}

export async function POST(req: NextRequest) {
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const query = req.nextUrl.searchParams;

  const leadPhoneRaw =
    query.get("leadPhone") ??
    form?.get("From")?.toString() ??
    form?.get("Caller")?.toString() ??
    "";
  const didRaw =
    query.get("did") ??
    form?.get("To")?.toString() ??
    form?.get("Called")?.toString() ??
    "";
  const retry = Math.max(0, toInt(query.get("retry"), 0));
  const userIdFromQuery = query.get("userId");

  const leadPhone = normalizePhone(leadPhoneRaw);
  const did = normalizePhone(didRaw);

  const response = new twilio.twiml.VoiceResponse();
  if (!leadPhone || !did) {
    console.warn("[twilio/inbound] missing phone fields", {
      leadPhoneRaw,
      didRaw,
      from: form?.get("From")?.toString() ?? null,
      to: form?.get("To")?.toString() ?? null,
      called: form?.get("Called")?.toString() ?? null,
      caller: form?.get("Caller")?.toString() ?? null,
    });
    response.say("We are unable to process your callback right now. Please try again later.");
    response.hangup();
    return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
  }

  const userId = userIdFromQuery ?? (await resolveUserIdFromDid(did));
  if (!userId) {
    console.warn("[twilio/inbound] could not resolve user from DID", { did, didRaw });
    response.say("The number you reached is not currently available.");
    response.hangup();
    return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
  }

  const parentCallSid = form?.get("CallSid")?.toString() ?? "";

  if (isConferenceCallsEnabled() && parentCallSid) {
    const baseUrl = getPublicBaseUrl(req.nextUrl.origin);
    const conferenceName = conferenceNameFromCallSid(parentCallSid);

    try {
      await createConferenceSession({
        userId,
        conferenceName,
        direction: "inbound",
        leadPhone,
        callerId: did,
        agentIdentity: `agent-${userId}`,
        parentCallSid,
      });

      if (retry > 0) {
        response.say("Please hold while we connect you to your agent.");
      }

      const waitUrl = new URL("/api/twilio/conference/wait", baseUrl);
      const conferenceStatusUrl = new URL("/api/twilio/conference/status", baseUrl);
      conferenceStatusUrl.searchParams.set("name", conferenceName);

      const dial = response.dial({ callerId: did });
      dial.conference(
        {
          startConferenceOnEnter: false,
          endConferenceOnExit: false,
          waitUrl: waitUrl.toString(),
          statusCallback: conferenceStatusUrl.toString(),
          statusCallbackEvent: ["end", "leave"],
          beep: "false",
        },
        conferenceName,
      );

      const agentStatusUrl = new URL("/api/twilio/conference/agent-status", baseUrl);
      agentStatusUrl.searchParams.set("userId", userId);
      agentStatusUrl.searchParams.set("leadPhone", leadPhone);
      agentStatusUrl.searchParams.set("did", did);
      agentStatusUrl.searchParams.set("conferenceName", conferenceName);
      agentStatusUrl.searchParams.set("retry", String(retry));
      agentStatusUrl.searchParams.set("maxRetry", String(HOLD_RETRY_LIMIT));

      const joinUrl = new URL("/api/twilio/conference/join", baseUrl);
      joinUrl.searchParams.set("name", conferenceName);
      joinUrl.searchParams.set("callerId", did);
      joinUrl.searchParams.set("moderator", "true");

      const client = getTwilioClient();
      void client.calls
        .create({
          to: `client:agent-${userId}`,
          from: did,
          url: joinUrl.toString(),
          method: "POST",
          statusCallback: agentStatusUrl.toString(),
          statusCallbackMethod: "POST",
          statusCallbackEvent: ["completed", "busy", "no-answer", "failed", "canceled"],
        })
        .catch((error) => {
          console.error("[twilio/inbound] failed to dial agent into conference", error);
        });

      return new NextResponse(response.toString(), {
        headers: { "Content-Type": "text/xml" },
      });
    } catch (error) {
      console.error("[twilio/inbound] conference setup failed, falling back to dial bridge", error);
    }
  }

  if (retry > 0) {
    response.say("Please hold while we connect you to your agent.");
  }

  const statusUrl = new URL("/api/twilio/inbound-status", resolvePublicBaseUrl(req));
  statusUrl.searchParams.set("userId", userId);
  statusUrl.searchParams.set("leadPhone", leadPhone);
  statusUrl.searchParams.set("did", did);
  statusUrl.searchParams.set("retry", String(retry));
  statusUrl.searchParams.set("maxRetry", String(HOLD_RETRY_LIMIT));

  const dial = response.dial({
    answerOnBridge: true,
    timeout: 20,
    action: statusUrl.toString(),
    method: "POST",
    callerId: did,
  });
  dial.client(`agent-${userId}`);

  return new NextResponse(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
