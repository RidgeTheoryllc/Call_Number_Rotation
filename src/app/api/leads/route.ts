import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { extractAreaCode } from "@/lib/utils";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json({ error: "user_id query param is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const leads = Array.isArray(body) ? body : [body];

    const payload = leads.map((lead) => {
      const phone = lead.phone as string;
      const userId = lead.user_id as string | undefined;

      if (!userId) {
        throw new Error("user_id is required for each lead");
      }

      return {
        name: (lead.name as string) ?? "Unknown",
        phone,
        area_code: extractAreaCode(phone),
        status: "pending",
        user_id: userId,
      };
    });

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.from("leads").insert(payload).select();
    if (error) throw error;
    return NextResponse.json(data ?? []);
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
    const status = body?.status as string | undefined;
    const assignedDid = body?.assigned_did as string | undefined;
    const result = body?.result as string | undefined;

    if (!id || !userId) {
      return NextResponse.json({ error: "Lead id and user_id are required" }, { status: 400 });
    }

    const updatePayload: Record<string, string> = {};
    if (status) updatePayload.status = status;
    if (assignedDid) updatePayload.assigned_did = assignedDid;
    if (result) updatePayload.result = result;

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("leads")
      .update(updatePayload)
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
