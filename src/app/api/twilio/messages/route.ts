import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { selectBestDid } from "@/lib/db";
import { getValidatedDefaultMessagingDid } from "@/lib/messaging-default";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";
import type { DidRecord, LeadRecord, MessageStatus } from "@/types";

interface SendMessageBody {
  user_id?: string;
  lead_id?: string;
  phone?: string;
  did?: string;
  body?: string;
}

function resolvePublicBaseUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  return configured && configured.length > 0 ? configured : req.nextUrl.origin;
}

function isMessageStatus(value: string): value is MessageStatus {
  return ["queued", "accepted", "sending", "sent", "delivered", "undelivered", "failed", "received"].includes(value);
}

async function getFallbackDid(userId: string): Promise<DidRecord | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("did_pool")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("spam_score", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as DidRecord | null) ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      return NextResponse.json(
        { error: "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as SendMessageBody;
    const userId = body.user_id?.trim();
    const leadId = body.lead_id?.trim();
    const messageBody = body.body?.trim();
    if (!userId || !messageBody) {
      return NextResponse.json({ error: "user_id and body are required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    let lead: LeadRecord | null = null;
    if (leadId) {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      lead = (data as LeadRecord | null) ?? null;
      if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const to = normalizePhone(lead?.phone ?? body.phone ?? "");
    if (!to) {
      return NextResponse.json({ error: "phone or lead_id is required" }, { status: 400 });
    }

    const explicitDid = normalizePhone(body.did?.trim() ?? "");
    let from = explicitDid;
    if (!from) {
      from = (await getValidatedDefaultMessagingDid(supabase, userId)) ?? "";
    }
    if (!from && lead?.assigned_did) {
      from = normalizePhone(lead.assigned_did);
    }
    if (!from) {
      const { bestDid } = await selectBestDid(to, userId);
      from = normalizePhone(bestDid?.did ?? "");
    }
    if (!from) {
      const fallbackDid = await getFallbackDid(userId);
      from = normalizePhone(fallbackDid?.did ?? "");
    }
    if (!from) {
      return NextResponse.json({ error: "No active DID is available for SMS" }, { status: 404 });
    }

    const { data: optOut } = await supabase
      .from("message_opt_outs")
      .select("id")
      .eq("user_id", userId)
      .eq("phone", to)
      .eq("did", from)
      .maybeSingle();
    if (optOut?.id) {
      return NextResponse.json({ error: "This lead has opted out of SMS for this DID." }, { status: 409 });
    }

    const statusCallbackUrl = new URL("/api/twilio/messages/status", resolvePublicBaseUrl(req)).toString();
    const client = twilio(accountSid, authToken);
    const sentMessage = await client.messages.create({
      to,
      from,
      body: messageBody,
      statusCallback: statusCallbackUrl,
    });

    const twilioStatus = String(sentMessage.status ?? "queued");
    const status: MessageStatus = isMessageStatus(twilioStatus) ? twilioStatus : "queued";
    const { data: inserted, error: insertError } = await supabase
      .from("message_logs")
      .insert({
        user_id: userId,
        lead_id: lead?.id ?? null,
        lead_name: lead?.name ?? null,
        phone: to,
        did: from,
        direction: "outbound",
        body: messageBody,
        status,
        twilio_message_sid: sentMessage.sid,
        error_message: sentMessage.errorMessage ?? null,
        timestamp: new Date().toISOString(),
      })
      .select()
      .single();
    if (insertError) throw insertError;

    return NextResponse.json(inserted);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
