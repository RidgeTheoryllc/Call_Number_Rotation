import { NextRequest, NextResponse } from "next/server";
import { endConferenceSession, hangupCallBySid } from "@/lib/twilio-conference";

const TERMINAL = new Set(["completed", "canceled", "busy", "no-answer", "failed"]);

/** Outbound lead PSTN leg ended — release the agent's browser call. */
export async function POST(req: NextRequest) {
  const conferenceName = req.nextUrl.searchParams.get("conferenceName")?.trim();
  const agentCallSid = req.nextUrl.searchParams.get("agentCallSid")?.trim();

  if (!conferenceName || !agentCallSid) {
    return new NextResponse("", { status: 204 });
  }

  const form = await req.formData();
  const callStatus = String(form.get("CallStatus") ?? "").toLowerCase();
  if (!TERMINAL.has(callStatus)) {
    return new NextResponse("", { status: 204 });
  }

  await hangupCallBySid(agentCallSid);
  await endConferenceSession(conferenceName);

  return new NextResponse("", { status: 204 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
