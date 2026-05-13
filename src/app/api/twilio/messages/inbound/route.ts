import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getSupabaseServerClient } from "@/lib/supabase";
import { conversationLeadKey, normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "UNSTOP"]);

async function resolveUserIdFromDid(toNormalized: string, toRaw?: string): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  const normalizedDid = normalizePhone(toNormalized);
  const normalizedDigits = normalizedDid.replace(/\D/g, "");
  const last10 = normalizedDigits.slice(-10);

  const tryExact = async (value: string) => {
    const v = value.trim();
    if (!v) return null;
    const { data } = await supabase.from("did_pool").select("user_id").eq("did", v).maybeSingle();
    return data?.user_id ?? null;
  };

  const exactCandidates = [toRaw?.trim(), toNormalized, normalizedDid].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  for (const candidate of new Set(exactCandidates)) {
    const uid = await tryExact(candidate);
    if (uid) return uid;
  }

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
    const toRaw = String(form.get("To") ?? form.get("Called") ?? "").trim();
    const to = normalizePhone(toRaw);
    const bodyRaw = String(form.get("Body") ?? "").trim();
    const numMedia = Number.parseInt(String(form.get("NumMedia") ?? "0"), 10) || 0;
    const body =
      bodyRaw || (numMedia > 0 ? "[Media received]" : "(no message text)");
    const messageSid = String(form.get("MessageSid") ?? form.get("SmsSid") ?? "").trim();

    if (!from || !to) {
      response.message("We could not process your message. Please try again later.");
      return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
    }

    const userId = await resolveUserIdFromDid(to, toRaw);
    if (!userId) {
      console.warn("[twilio/messages/inbound] no did_pool match for To=", to);
      response.message("This number is not currently monitored.");
      return new NextResponse(response.toString(), { headers: { "Content-Type": "text/xml" } });
    }

    const supabase = getSupabaseServerClient();
    const leadPhoneKey = conversationLeadKey(from);
    const normalizedKeyword = bodyRaw.trim().toUpperCase();
    if (STOP_KEYWORDS.has(normalizedKeyword)) {
      await supabase.from("message_opt_outs").upsert(
        {
          user_id: userId,
          phone: leadPhoneKey,
          did: to,
          reason: normalizedKeyword,
        },
        { onConflict: "user_id,phone,did" },
      );
      response.message("You have been unsubscribed and will no longer receive SMS messages from this number.");
    } else if (START_KEYWORDS.has(normalizedKeyword)) {
      await supabase.from("message_opt_outs").delete().eq("user_id", userId).eq("phone", leadPhoneKey).eq("did", to);
      response.message("You have been resubscribed to SMS messages from this number.");
    }

    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, name, phone")
      .eq("user_id", userId);
    if (leadsError) {
      console.error("[twilio/messages/inbound] leads lookup failed (inbound still logged)", leadsError);
    }

    const matchedLead = (leads ?? []).find(
      (lead) => conversationLeadKey(String(lead.phone ?? "")) === leadPhoneKey,
    );
    const messagePayload = {
      user_id: userId,
      lead_id: matchedLead?.id ?? null,
      lead_name: matchedLead?.name ?? null,
      phone: leadPhoneKey,
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

    console.log("[twilio/messages/inbound] stored", { userId, messageSid, from, to });

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
