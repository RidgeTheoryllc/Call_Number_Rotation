import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";
import {
  dialParticipantIntoConference,
  getPublicBaseUrl,
  isConferenceCallsEnabled,
  resolveConferenceSessionForConnect,
} from "@/lib/twilio-conference";

export async function POST(req: NextRequest) {
  if (!isConferenceCallsEnabled()) {
    return NextResponse.json(
      { error: "Conference calling is not enabled. Set TWILIO_CONFERENCE_CALLS=true." },
      { status: 503 },
    );
  }

  try {
    const body = await req.json();
    const userId = body?.user_id as string | undefined;
    const participantId = body?.participant_id as string | undefined;
    const agentCallSid = body?.agent_call_sid as string | undefined;

    if (!userId || !participantId) {
      return NextResponse.json({ error: "user_id and participant_id are required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data: participant, error: participantError } = await supabase
      .from("conference_participants")
      .select("id, label, phone")
      .eq("id", participantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (participantError) throw participantError;
    if (!participant) {
      return NextResponse.json({ error: "Saved contact not found" }, { status: 404 });
    }

    const resolved = await resolveConferenceSessionForConnect({
      userId,
      agentCallSid,
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.message, code: resolved.code }, { status: 409 });
    }
    const session = resolved.session;

    const baseUrl = getPublicBaseUrl(req.nextUrl.origin);
    const thirdPartyPhone = normalizePhone(participant.phone);
    const call = await dialParticipantIntoConference({
      baseUrl,
      to: thirdPartyPhone,
      from: session.caller_id,
      conferenceName: session.conference_name,
      startConferenceOnEnter: true,
    });

    return NextResponse.json({
      ok: true,
      label: participant.label,
      phone: participant.phone,
      conferenceName: session.conference_name,
      participantCallSid: call.sid,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to connect participant" },
      { status: 502 },
    );
  }
}
