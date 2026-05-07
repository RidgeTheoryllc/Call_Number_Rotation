import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";

const HOLD_RETRY_LIMIT = 6;

function toInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function resolveUserIdFromDid(didNumber: string): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  const normalizedDid = normalizePhone(didNumber);

  const { data: direct } = await supabase
    .from("did_pool")
    .select("user_id")
    .eq("did", didNumber)
    .maybeSingle();
  if (direct?.user_id) return direct.user_id;

  const { data: rows, error } = await supabase.from("did_pool").select("did, user_id");
  if (error) return null;
  const matched = (rows ?? []).find((row) => normalizePhone(String(row.did)) === normalizedDid);
  return matched?.user_id ?? null;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const query = req.nextUrl.searchParams;

  const leadPhoneRaw = query.get("leadPhone") ?? form.get("From")?.toString() ?? "";
  const didRaw = query.get("did") ?? form.get("To")?.toString() ?? "";
  const retry = Math.max(0, toInt(query.get("retry"), 0));
  const userIdFromQuery = query.get("userId");

  const leadPhone = normalizePhone(leadPhoneRaw);
  const did = normalizePhone(didRaw);

  const response = new twilio.twiml.VoiceResponse();
  if (!leadPhone || !did) {
    response.say("We are unable to process your callback right now. Please try again later.");
    response.hangup();
    return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
  }

  const userId = userIdFromQuery ?? (await resolveUserIdFromDid(did));
  if (!userId) {
    response.say("The number you reached is not currently available.");
    response.hangup();
    return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
  }

  if (retry > 0) {
    response.say("Please hold while we connect you to your agent.");
  }

  const statusUrl = new URL("/api/twilio/inbound-status", req.nextUrl.origin);
  statusUrl.searchParams.set("userId", userId);
  statusUrl.searchParams.set("leadPhone", leadPhone);
  statusUrl.searchParams.set("did", did);
  statusUrl.searchParams.set("retry", String(retry));
  statusUrl.searchParams.set("maxRetry", String(HOLD_RETRY_LIMIT));

  const dial = response.dial({
    answerOnBridge: true,
    timeout: 20,
    action: statusUrl.toString(),
    method: "POST",
    callerId: did,
  });
  dial.client(`agent-${userId}`);

  return new NextResponse(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}
