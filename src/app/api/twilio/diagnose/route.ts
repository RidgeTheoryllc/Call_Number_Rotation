import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";
import type { DidRecord } from "@/types";

interface NumberInfo {
  sid: string;
  phoneNumber: string | null;
  voiceUrl: string | null;
  voiceMethod: string | null;
  voiceApplicationSid: string | null;
}

interface DidDiagnostic {
  did: string;
  user_id: string | null;
  found_in_twilio: boolean;
  twilio: NumberInfo | null;
  expected_voice_url: string;
  voice_url_matches_expected: boolean;
  uses_twiml_app: boolean;
  notes: string[];
}

type DidPoolDiagnosticRow = Pick<DidRecord, "did"> & { user_id: string | null };

function resolvePublicBaseUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  return configured && configured.length > 0 ? configured : req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return NextResponse.json(
      { error: "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN" },
      { status: 500 },
    );
  }

  const userId = req.nextUrl.searchParams.get("user_id");
  const singleDid = req.nextUrl.searchParams.get("did");

  const supabase = getSupabaseServerClient();
  let query = supabase.from("did_pool").select("did, user_id");
  if (userId) query = query.eq("user_id", userId);
  if (singleDid) query = query.eq("did", singleDid);
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as DidPoolDiagnosticRow[];
  const baseUrl = resolvePublicBaseUrl(req);
  const expectedInboundUrl = new URL("/api/twilio/inbound", baseUrl).toString();
  const client = twilio(accountSid, authToken);
  const allTwilioNumbers = await client.incomingPhoneNumbers.list({ limit: 1000 });

  const diagnostics: DidDiagnostic[] = rows.map((row) => {
    const did = String(row.did);
    const normalized = normalizePhone(did);
    const last10 = normalized.replace(/\D/g, "").slice(-10);
    const match = allTwilioNumbers.find(
      (n) =>
        n.phoneNumber === did ||
        n.phoneNumber === normalized ||
        (last10.length === 10 && (n.phoneNumber ?? "").replace(/\D/g, "").endsWith(last10)),
    );

    const notes: string[] = [];
    let voiceUrlMatches = false;
    let usesTwimlApp = false;

    if (!match) {
      notes.push(
        "No Twilio IncomingPhoneNumber matches this DID. The number may belong to another account or have been released.",
      );
    } else {
      const voiceUrl = match.voiceUrl ?? "";
      voiceUrlMatches = voiceUrl === expectedInboundUrl;
      usesTwimlApp = Boolean(match.voiceApplicationSid);

      if (!voiceUrl && !usesTwimlApp) {
        notes.push("Number has no Voice webhook and no TwiML App. Inbound calls will not reach this app.");
      }
      if (usesTwimlApp) {
        notes.push(
          "Number is bound to a TwiML App. The app's voice URL is what runs on inbound, not the number's voiceUrl. POST /api/twilio/configure-numbers to switch this DID to the direct inbound webhook.",
        );
      }
      if (!voiceUrlMatches && !usesTwimlApp) {
        notes.push(
          `voiceUrl is "${voiceUrl}" but should be "${expectedInboundUrl}". POST /api/twilio/configure-numbers to fix.`,
        );
      }
    }

    return {
      did,
      user_id: row.user_id ?? null,
      found_in_twilio: Boolean(match),
      twilio: match
        ? {
            sid: match.sid,
            phoneNumber: match.phoneNumber ?? null,
            voiceUrl: match.voiceUrl ?? null,
            voiceMethod: match.voiceMethod ?? null,
            voiceApplicationSid: match.voiceApplicationSid ?? null,
          }
        : null,
      expected_voice_url: expectedInboundUrl,
      voice_url_matches_expected: voiceUrlMatches,
      uses_twiml_app: usesTwimlApp,
      notes,
    };
  });

  return NextResponse.json({
    base_url: baseUrl,
    expected_inbound_url: expectedInboundUrl,
    twiml_app_sid: process.env.TWILIO_TWIML_APP_SID ?? null,
    count: diagnostics.length,
    diagnostics,
  });
}
