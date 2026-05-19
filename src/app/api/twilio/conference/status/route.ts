import { NextRequest, NextResponse } from "next/server";
import { updateDidAfterCall } from "@/lib/db";
import { getSupabaseServerClient } from "@/lib/supabase";
import {
  disconnectAgentWhenLeadLeaves,
  endConferenceSession,
  getActiveConferenceSessionByName,
} from "@/lib/twilio-conference";
import type { CallResult } from "@/types";

/** Conference lifecycle: lead leave releases agent; conference end cleans up DB. */
export async function POST(req: NextRequest) {
  const query = req.nextUrl.searchParams;
  const conferenceName = query.get("name");
  const form = await req.formData();
  const event = String(form.get("StatusCallbackEvent") ?? form.get("Event") ?? "").toLowerCase();
  const leftCallSid = String(form.get("CallSid") ?? "").trim() || null;

  if (!conferenceName) {
    return new NextResponse("", { status: 204 });
  }

  if (event === "participant-leave" || event === "leave") {
    await disconnectAgentWhenLeadLeaves(conferenceName, leftCallSid);
    return new NextResponse("", { status: 204 });
  }

  if (event !== "conference-end" && event !== "end") {
    return new NextResponse("", { status: 204 });
  }

  const session = await getActiveConferenceSessionByName(conferenceName);
  await endConferenceSession(conferenceName);

  if (session?.direction === "inbound") {
    const durationRaw = String(form.get("ConferenceDuration") ?? "0");
    const duration = Number.parseInt(durationRaw, 10);
    const safeDuration = Number.isFinite(duration) ? duration : 0;
    const result: CallResult = safeDuration > 0 ? "answered" : "no_answer";

    const supabase = getSupabaseServerClient();
    await supabase.from("call_logs").insert({
      phone: session.lead_phone,
      did: session.caller_id,
      direction: "inbound",
      result,
      duration: safeDuration,
      timestamp: new Date().toISOString(),
      user_id: session.user_id,
    });
    await updateDidAfterCall(session.caller_id, result, session.user_id);
  }

  return new NextResponse("", { status: 204 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
