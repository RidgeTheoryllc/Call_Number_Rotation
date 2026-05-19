import { NextRequest, NextResponse } from "next/server";
import {
  isConferenceCallsEnabled,
  resolveConferenceSessionForConnect,
} from "@/lib/twilio-conference";

/** Check whether Connect Call can attach to the agent's current live call. */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("user_id")?.trim();
    const agentCallSid = req.nextUrl.searchParams.get("agent_call_sid")?.trim() || null;

    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    if (!isConferenceCallsEnabled()) {
      return NextResponse.json({
        ready: false,
        code: "not_enabled",
        message:
          "Set TWILIO_CONFERENCE_CALLS=true on your deployed server (e.g. Netlify), redeploy, then start a new call.",
      });
    }

    const resolved = await resolveConferenceSessionForConnect({ userId, agentCallSid });
    if (!resolved.ok) {
      return NextResponse.json({
        ready: false,
        code: resolved.code,
        message: resolved.message,
      });
    }

    return NextResponse.json({
      ready: true,
      conferenceName: resolved.session.conference_name,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
