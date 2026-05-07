import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getSupabaseServerClient } from "@/lib/supabase";
import { updateDidAfterCall } from "@/lib/db";
import {
  assertDidRateLimit,
  assertLeadDialCooldown,
  fetchDidForPlaceCall,
  maybeQuarantineDidAfterBadStreak,
} from "@/lib/call-safeguards";
import type { CallResult } from "@/types";
import { normalizePhone } from "@/lib/utils";

function mockCallResult(): CallResult {
  const roll = Math.random();
  if (roll > 0.7) return "answered";
  if (roll > 0.5) return "no_answer";
  if (roll > 0.35) return "busy";
  if (roll > 0.2) return "failed";
  return "spam_flagged";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const leadPhone = body?.leadPhone as string | undefined;
    const selectedDid = body?.selectedDid as string | undefined;
    const leadId = body?.leadId as string | undefined;
    const didId = body?.didId as string | undefined;

    if (!leadPhone || !selectedDid) {
      return NextResponse.json({ error: "leadPhone and selectedDid are required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const didRow = await fetchDidForPlaceCall(supabase, { didId, selectedDid });
    if (!didRow) {
      return NextResponse.json({ error: "DID not found in pool" }, { status: 404 });
    }

    const leadCheck = await assertLeadDialCooldown(supabase, leadPhone);
    if (!leadCheck.ok) {
      return NextResponse.json({ error: leadCheck.message }, { status: 429 });
    }

    const didCheck = assertDidRateLimit(didRow);
    if (!didCheck.ok) {
      return NextResponse.json({ error: didCheck.message }, { status: 429 });
    }

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const twimlUrl = process.env.TWILIO_TWIML_URL ?? "http://demo.twilio.com/docs/voice.xml";

    let callSid: string | null = null;
    let result: CallResult;
    let duration: number | null = null;
    const normalizedLeadPhone = normalizePhone(leadPhone);
    const fromForTwilio = normalizePhone(didRow.did);
    const logDid = fromForTwilio;

    if (sid && token) {
      try {
        const client = twilio(sid, token);
        const call = await client.calls.create({
          to: normalizedLeadPhone,
          from: fromForTwilio,
          url: twimlUrl,
        });
        callSid = call.sid;
        result = "answered";
        duration = 120;
      } catch (twilioError) {
        const message =
          twilioError instanceof Error ? twilioError.message : "Twilio call failed unexpectedly";
        return NextResponse.json(
          {
            error: `Twilio call failed: ${message}`,
            hint: "Check E.164 number format (+1...), Twilio number ownership, and trial verified destination.",
          },
          { status: 502 },
        );
      }
    } else {
      result = mockCallResult();
      duration = result === "answered" ? Math.floor(Math.random() * 220) + 20 : null;
    }

    const timestamp = new Date().toISOString();

    const { error: logError } = await supabase.from("call_logs").insert({
      phone: normalizedLeadPhone,
      did: logDid,
      direction: "outbound",
      result,
      timestamp,
      duration,
    });
    if (logError) throw logError;

    if (leadId) {
      await supabase
        .from("leads")
        .update({
          status: "completed",
          assigned_did: logDid,
          result,
        })
        .eq("id", leadId);
    }

    await updateDidAfterCall(didRow.did, result);

    await maybeQuarantineDidAfterBadStreak(supabase, { didId: didRow.id, logDid });

    return NextResponse.json({
      success: true,
      callSid,
      result,
      duration,
      mode: sid && token ? "twilio" : "mock",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
