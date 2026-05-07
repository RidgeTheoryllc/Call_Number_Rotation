import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
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
  const calledVia = body.get("CalledVia")?.toString() ?? "";
  const isInboundPstn = !toFromQuery && !callerIdFromQuery && calledVia.toLowerCase() === "pstn";

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
