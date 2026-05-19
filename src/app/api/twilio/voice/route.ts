import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import {
  buildJoinConferenceTwiml,
  conferenceNameFromCallSid,
  createConferenceSession,
  dialParticipantIntoConference,
  getPublicBaseUrl,
  isConferenceCallsEnabled,
  parseAgentUserIdFromClientIdentity,
} from "@/lib/twilio-conference";
import { normalizePhone } from "@/lib/utils";

function getCallerId(fallbackCallerId: string, callerIdFromBody: string | null) {
  const callerId = callerIdFromBody?.trim();
  return callerId || fallbackCallerId;
}

export async function POST(req: NextRequest) {
  const body = await req.formData();
  const toFromQuery = req.nextUrl.searchParams.get("to");
  const callerIdFromQuery = req.nextUrl.searchParams.get("callerId");
  const bodyTo = body.get("To")?.toString() ?? "";
  const to = toFromQuery ?? bodyTo;
  const callerIdFromBody = callerIdFromQuery ?? body.get("CallerId")?.toString() ?? null;
  const from = body.get("From")?.toString() ?? null;
  const defaultCallerId = process.env.TWILIO_DEFAULT_CALLER_ID ?? "";

  // Twilio sets Direction to "inbound" for any PSTN call entering a Twilio number,
  // regardless of whether the number's voice config points at a TwiML App or a direct
  // webhook. CalledVia is only populated when one Twilio number forwards to another,
  // so we can't rely on it to recognize a direct PSTN inbound call.
  const direction = body.get("Direction")?.toString().toLowerCase() ?? "";
  const isClientLeg = (from ?? "").startsWith("client:");
  const hasOutboundQueryParams = Boolean(toFromQuery || callerIdFromQuery);
  const isInboundPstn = !hasOutboundQueryParams && !isClientLeg && direction.startsWith("inbound");

  if (isInboundPstn) {
    const leadPhone = normalizePhone(from ?? "");
    const did = normalizePhone(bodyTo);
    const inboundUrl = new URL("/api/twilio/inbound", req.nextUrl.origin);
    inboundUrl.searchParams.set("leadPhone", leadPhone);
    inboundUrl.searchParams.set("did", did);

    const response = new twilio.twiml.VoiceResponse();
    response.redirect({ method: "POST" }, inboundUrl.toString());
    return new NextResponse(response.toString(), {
      headers: { "Content-Type": "text/xml" },
    });
  }

  const callerId = getCallerId(defaultCallerId, callerIdFromBody ?? from);
  if (!to || !callerId) {
    const response = new twilio.twiml.VoiceResponse();
    response.say("Call could not be completed due to missing destination or caller ID.");
    return new NextResponse(response.toString(), {
      status: 400,
      headers: { "Content-Type": "text/xml" },
    });
  }

  const leadId = req.nextUrl.searchParams.get("leadId");
  const callSid = body.get("CallSid")?.toString() ?? "";
  const agentUserId = parseAgentUserIdFromClientIdentity(from);

  if (isConferenceCallsEnabled() && !to.startsWith("client:") && callSid && agentUserId) {
    const baseUrl = getPublicBaseUrl(req.nextUrl.origin);
    const conferenceName = conferenceNameFromCallSid(callSid);

    try {
      await createConferenceSession({
        userId: agentUserId,
        conferenceName,
        direction: "outbound",
        leadPhone: to,
        callerId,
        agentIdentity: from?.replace(/^client:/, "") ?? `agent-${agentUserId}`,
        leadId,
        agentCallSid: callSid,
      });

      void dialParticipantIntoConference({
        baseUrl,
        to,
        from: callerId,
        conferenceName,
        startConferenceOnEnter: false,
      }).catch((error) => {
        console.error("[twilio/voice] failed to dial lead into conference", error);
      });

      const statusUrl = new URL("/api/twilio/conference/status", baseUrl);
      statusUrl.searchParams.set("name", conferenceName);

      const twiml = buildJoinConferenceTwiml({
        conferenceName,
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        record: true,
        statusCallback: statusUrl.toString(),
      });

      return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[twilio/voice] conference setup failed, falling back to dial bridge", message);
      if (message.includes("call_conference_sessions") || message.includes("schema cache")) {
        const response = new twilio.twiml.VoiceResponse();
        response.say(
          "Conference calling is not set up in the database. Ask your administrator to run the conference sessions migration, then try again.",
        );
        response.hangup();
        return new NextResponse(response.toString(), {
          headers: { "Content-Type": "text/xml" },
        });
      }
    }
  }

  const voiceActionUrl = new URL("/api/twilio/voice-status", req.nextUrl.origin);
  voiceActionUrl.searchParams.set("to", to);
  voiceActionUrl.searchParams.set("callerId", callerId);

  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    callerId,
    timeout: 30,
    record: "record-from-ringing",
    answerOnBridge: true,
    action: voiceActionUrl.toString(),
    method: "POST",
  });

  if (to.startsWith("client:")) {
    dial.client(to.replace("client:", ""));
  } else {
    dial.number(to);
  }

  return new NextResponse(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}
