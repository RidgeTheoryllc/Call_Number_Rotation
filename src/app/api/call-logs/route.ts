import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json({ error: "user_id query param is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const [{ data: logs, error: logsError }, { data: leads, error: leadsError }] = await Promise.all([
      supabase.from("call_logs").select("*").eq("user_id", userId).order("timestamp", { ascending: false }),
      supabase.from("leads").select("name, phone").eq("user_id", userId).order("created_at", { ascending: false }),
    ]);
    if (logsError) throw logsError;
    if (leadsError) throw leadsError;

    const nameByPhone = new Map<string, string>();
    for (const lead of leads ?? []) {
      const key = normalizePhone(lead.phone);
      if (!key || nameByPhone.has(key)) continue;
      nameByPhone.set(key, lead.name);
    }

    const logsWithLeadName = (logs ?? []).map((log) => ({
      ...log,
      lead_name: nameByPhone.get(normalizePhone(log.phone)) ?? null,
    }));

    return NextResponse.json(logsWithLeadName);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = body?.id as string | undefined;
    const userId = body?.user_id as string | undefined;
    const callNotes = body?.call_notes as string | undefined;

    if (!id || !userId) {
      return NextResponse.json({ error: "Call log id and user_id are required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("call_logs")
      .update({ call_notes: callNotes ?? "" })
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
