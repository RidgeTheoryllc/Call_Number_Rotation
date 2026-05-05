import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

export async function POST(_req: NextRequest) {
  const response = new twilio.twiml.VoiceResponse();

  // Always end the client leg after the dial leg resolves (answered, busy, rejected, no-answer, etc.).
  response.hangup();

  return new NextResponse(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}
