import { NextRequest, NextResponse } from "next/server";
import type { MessageStatus } from "@/types";
import { getSupabaseServerClient } from "@/lib/supabase";

function normalizeMessageStatus(value: string): MessageStatus {
  const normalized = value.toLowerCase();
  if (
    normalized === "queued" ||
    normalized === "accepted" ||
    normalized === "sending" ||
    normalized === "sent" ||
    normalized === "delivered" ||
    normalized === "undelivered" ||
    normalized === "failed" ||
    normalized === "received"
  ) {
    return normalized;
  }
  return "queued";
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const messageSid = String(form.get("MessageSid") ?? form.get("SmsSid") ?? "").trim();
    const rawStatus = String(form.get("MessageStatus") ?? form.get("SmsStatus") ?? "queued");
    const errorMessage =
      String(form.get("ErrorMessage") ?? "").trim() ||
      String(form.get("ErrorCode") ?? "").trim() ||
      null;

    if (!messageSid) {
      return NextResponse.json({ error: "MessageSid is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("message_logs")
      .update({
        status: normalizeMessageStatus(rawStatus),
        error_message: errorMessage,
      })
      .eq("twilio_message_sid", messageSid);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
