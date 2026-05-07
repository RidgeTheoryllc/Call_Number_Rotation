import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getSupabaseServerClient } from "@/lib/supabase";
import { updateDidAfterCall } from "@/lib/db";
import { normalizePhone } from "@/lib/utils";
import type { CallResult } from "@/types";

function toInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapDialStatusToResult(status: string, duration: number): CallResult {
  const normalized = status.toLowerCase();
  if (normalized === "busy") return "busy";
  if (normalized === "no-answer") return "no_answer";
  if (normalized === "completed") return duration > 0 ? "answered" : "no_answer";
  return "failed";
}

export async function POST(req: NextRequest) {
  const query = req.nextUrl.searchParams;
  const userId = query.get("userId");
  const leadPhoneRaw = query.get("leadPhone");
  const didRaw = query.get("did");
  const retry = Math.max(0, toInt(query.get("retry"), 0));
  const maxRetry = Math.max(1, toInt(query.get("maxRetry"), 6));

  const response = new twilio.twiml.VoiceResponse();
  if (!userId || !leadPhoneRaw || !didRaw) {
    response.say("Callback state was missing. Please try again.");
    response.hangup();
    return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
  }

  const form = await req.formData();
  const dialStatus = String(form.get("DialCallStatus") ?? "failed");
  const durationRaw = String(form.get("DialCallDuration") ?? "0");
  const duration = Number.parseInt(durationRaw, 10);
  const safeDuration = Number.isFinite(duration) ? duration : 0;
  const result = mapDialStatusToResult(dialStatus, safeDuration);

  // Agent busy/unavailable: keep caller on hold and retry.
  if (result !== "answered" && retry < maxRetry) {
    const retryUrl = new URL("/api/twilio/inbound", req.nextUrl.origin);
    retryUrl.searchParams.set("userId", userId);
    retryUrl.searchParams.set("leadPhone", normalizePhone(leadPhoneRaw));
    retryUrl.searchParams.set("did", normalizePhone(didRaw));
    retryUrl.searchParams.set("retry", String(retry + 1));

    response.say("Our agent is currently on another call. Please hold while we reconnect you.");
    response.pause({ length: 6 });
    response.redirect({ method: "POST" }, retryUrl.toString());
    return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
  }

  const supabase = getSupabaseServerClient();
  const leadPhone = normalizePhone(leadPhoneRaw);
  const did = normalizePhone(didRaw);

  await supabase.from("call_logs").insert({
    phone: leadPhone,
    did,
    direction: "inbound",
    result,
    duration: safeDuration,
    timestamp: new Date().toISOString(),
    user_id: userId,
  });

  await updateDidAfterCall(did, result, userId);

  if (result !== "answered") {
    response.say("Sorry, all agents remain unavailable. Please try your callback again shortly.");
  }
  response.hangup();
  return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
}
