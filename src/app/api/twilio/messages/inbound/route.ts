import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "UNSTOP"]);

async function resolveUserIdFromDid(didNumber: string): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  const normalizedDid = normalizePhone(didNumber);
  const normalizedDigits = normalizedDid.replace(/\D/g, "");
  const last10 = normalizedDigits.slice(-10);

  const { data: direct } = await supabase
    .from("did_pool")
    .select("user_id")
    .eq("did", didNumber)
    .maybeSingle();
  if (direct?.user_id) return direct.user_id;

  const { data: rows, error } = await supabase.from("did_pool").select("did, user_id");
  if (error) return null;
  const matched = (rows ?? []).find((row) => {
    const rowNormalized = normalizePhone(String(row.did));
    if (rowNormalized === normalizedDid) return true;

    const rowDigits = rowNormalized.replace(/\D/g, "");
    if (rowDigits === normalizedDigits) return true;

    return last10.length === 10 && rowDigits.slice(-10) === last10;
  });
  return matched?.user_id ?? null;
}

export async function POST(req: NextRequest) {
  const response = new twilio.twiml.MessagingResponse();

  try {
    const form = await req.formData();
    const from = normalizePhone(String(form.get("From") ?? ""));
    const to = normalizePhone(String(form.get("To") ?? ""));
    const body = String(form.get("Body") ?? "").trim();
    const messageSid = String(form.get("MessageSid") ?? form.get("SmsSid") ?? "").trim();

    if (!from || !to || !body) {
      response.message("We could not process your message. Please try again later.");
      return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
    }

    const userId = await resolveUserIdFromDid(to);
    if (!userId) {
      response.message("This number is not currently monitored.");
      return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
    }

    const supabase = getSupabaseServerClient();
    const normalizedKeyword = body.trim().toUpperCase();
    if (STOP_KEYWORDS.has(normalizedKeyword)) {
      await supabase.from("message_opt_outs").upsert(
        {
          user_id: userId,
          phone: from,
          did: to,
          reason: normalizedKeyword,
        },
        { onConflict: "user_id,phone,did" },
      );
      response.message("You have been unsubscribed and will no longer receive SMS messages from this number.");
    } else if (START_KEYWORDS.has(normalizedKeyword)) {
      await supabase.from("message_opt_outs").delete().eq("user_id", userId).eq("phone", from).eq("did", to);
      response.message("You have been resubscribed to SMS messages from this number.");
    }

    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, name, phone")
      .eq("user_id", userId);
    if (leadsError) throw leadsError;

    const matchedLead = (leads ?? []).find((lead) => normalizePhone(String(lead.phone ?? "")) === from);
    const messagePayload = {
      user_id: userId,
      lead_id: matchedLead?.id ?? null,
      lead_name: matchedLead?.name ?? null,
      phone: from,
      did: to,
      direction: "inbound",
      body,
      status: "received",
      twilio_message_sid: messageSid || null,
      timestamp: new Date().toISOString(),
    };
    const { error: insertError } = messageSid
      ? await supabase.from("message_logs").upsert(messagePayload, { onConflict: "twilio_message_sid" })
      : await supabase.from("message_logs").insert(messagePayload);
    if (insertError) throw insertError;

    return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
  } catch (error) {
    console.error("[twilio/messages/inbound]", error);
    response.message("We could not process your message. Please try again later.");
    return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
