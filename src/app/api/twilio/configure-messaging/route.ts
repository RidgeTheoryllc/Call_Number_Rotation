import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";
import type { DidRecord } from "@/types";

interface ConfigureMessagingBody {
  user_id?: string;
}

interface PerNumberResult {
  did: string;
  status: "updated" | "not_found_in_twilio" | "error";
  twilioSid?: string;
  smsUrl?: string;
  statusCallback?: string;
  error?: string;
}

function resolvePublicBaseUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  return configured && configured.length > 0 ? configured : req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return NextResponse.json(
      { error: "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN" },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as ConfigureMessagingBody;
  const userId = body.user_id?.trim();
  if (!userId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: didRows, error: didsError } = await supabase
    .from("did_pool")
    .select("did")
    .eq("user_id", userId);
  if (didsError) {
    return NextResponse.json(
      { error: didsError.message ?? "Failed to load DID pool" },
      { status: 500 },
    );
  }

  const dids = ((didRows ?? []) as Pick<DidRecord, "did">[]).map((row) => row.did).filter(Boolean);
  if (dids.length === 0) {
    return NextResponse.json({ updated: [], message: "No DIDs in pool for this user." });
  }

  const baseUrl = resolvePublicBaseUrl(req);
  const smsUrl = new URL("/api/twilio/messages/inbound", baseUrl).toString();
  const statusCallbackUrl = new URL("/api/twilio/messages/status", baseUrl).toString();
  const client = twilio(accountSid, authToken);
  const results: PerNumberResult[] = [];

  for (const did of dids) {
    const normalized = normalizePhone(did);
    try {
      let matches = await client.incomingPhoneNumbers.list({ phoneNumber: normalized, limit: 5 });
      if (matches.length === 0) {
        const last10 = normalized.replace(/\D/g, "").slice(-10);
        if (last10.length === 10) {
          const allNumbers = await client.incomingPhoneNumbers.list({ limit: 1000 });
          matches = allNumbers.filter((number) => (number.phoneNumber ?? "").replace(/\D/g, "").endsWith(last10));
        }
      }

      if (matches.length === 0) {
        results.push({ did, status: "not_found_in_twilio" });
        continue;
      }

      const target = matches[0];
      const updated = await client.incomingPhoneNumbers(target.sid).update({
        smsUrl,
        smsMethod: "POST",
        smsFallbackUrl: smsUrl,
        smsFallbackMethod: "POST",
        statusCallback: statusCallbackUrl,
        statusCallbackMethod: "POST",
      });

      results.push({
        did,
        status: "updated",
        twilioSid: updated.sid,
        smsUrl: updated.smsUrl,
        statusCallback: updated.statusCallback,
      });
    } catch (error) {
      results.push({
        did,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown Twilio error",
      });
    }
  }

  return NextResponse.json({
    smsUrl,
    statusCallbackUrl,
    updated: results,
  });
}
