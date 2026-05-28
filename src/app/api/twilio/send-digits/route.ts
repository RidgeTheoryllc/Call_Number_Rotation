import { NextRequest, NextResponse } from "next/server";
import { sendDigitsToLeadLeg } from "@/lib/twilio-conference";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      user_id?: string;
      agent_call_sid?: string;
      digits?: string;
    };

    const userId = body.user_id?.trim();
    const agentCallSid = body.agent_call_sid?.trim() || null;
    const digits = body.digits?.trim();

    if (!userId || !digits) {
      return NextResponse.json({ error: "user_id and digits are required" }, { status: 400 });
    }

    const result = await sendDigitsToLeadLeg({ userId, agentCallSid, digits });

    if (result.ok) {
      return NextResponse.json({ success: true, mode: result.mode });
    }

    return NextResponse.json({
      success: false,
      fallback: result.fallback,
      message: result.message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send digits";
    if (message.includes("Invalid DTMF")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
