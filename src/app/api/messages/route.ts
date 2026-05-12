import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";
import type { MessageLogRecord } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json({ error: "user_id query param is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const [{ data: messages, error: messagesError }, { data: leads, error: leadsError }] = await Promise.all([
      supabase.from("message_logs").select("*").eq("user_id", userId).order("timestamp", { ascending: true }),
      supabase.from("leads").select("id, name, phone").eq("user_id", userId).order("created_at", { ascending: false }),
    ]);
    if (messagesError) throw messagesError;
    if (leadsError) throw leadsError;

    const leadByPhone = new Map<string, { id: string; name: string }>();
    for (const lead of leads ?? []) {
      const key = normalizePhone(String(lead.phone ?? ""));
      if (!key || leadByPhone.has(key)) continue;
      leadByPhone.set(key, { id: String(lead.id), name: String(lead.name ?? "Unknown") });
    }

    const enrichedMessages = ((messages ?? []) as MessageLogRecord[]).map((message) => {
      const matchedLead = leadByPhone.get(normalizePhone(message.phone));
      return {
        ...message,
        lead_id: message.lead_id ?? matchedLead?.id ?? null,
        lead_name: message.lead_name ?? matchedLead?.name ?? null,
      };
    });

    return NextResponse.json(enrichedMessages);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
