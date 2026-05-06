import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { extractAreaCode, normalizePhone } from "@/lib/utils";

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

    const mapped = leads.map((lead) => {
      const phone = lead.phone as string;
      const userId = lead.user_id as string | undefined;

      if (!userId) {
        throw new Error("user_id is required for each lead");
      }
      if (!phone) {
        throw new Error("phone is required for each lead");
      }

      return {
        name: (lead.name as string) ?? "Unknown",
        phone,
        normalized_phone: normalizePhone(phone),
        area_code: extractAreaCode(phone),
        status: "pending",
        user_id: userId,
      };
    });

    const userId = mapped[0]?.user_id;
    if (!userId) {
      return NextResponse.json([], { status: 200 });
    }

    if (mapped.some((lead) => lead.user_id !== userId)) {
      return NextResponse.json({ error: "All leads in one request must have the same user_id" }, { status: 400 });
    }

    const uniqueByPhone = new Map<string, (typeof mapped)[number]>();
    for (const lead of mapped) {
      if (!uniqueByPhone.has(lead.normalized_phone)) {
        uniqueByPhone.set(lead.normalized_phone, lead);
      }
    }
    const dedupedWithinRequest = Array.from(uniqueByPhone.values());

    const supabase = getSupabaseServerClient();
    const { data: existingLeads, error: existingError } = await supabase
      .from("leads")
      .select("phone")
      .eq("user_id", userId);
    if (existingError) throw existingError;

    const existingPhoneSet = new Set((existingLeads ?? []).map((lead) => normalizePhone(String(lead.phone ?? ""))));
    const payload = dedupedWithinRequest
      .filter((lead) => !existingPhoneSet.has(lead.normalized_phone))
      .map(({ normalized_phone: _normalizedPhone, ...lead }) => lead);

    const skippedDuplicatesCount = dedupedWithinRequest.length - payload.length;

    if (payload.length === 0) {
      return NextResponse.json({
        inserted: [],
        inserted_count: 0,
        skipped_duplicates: skippedDuplicatesCount,
      });
    }

    const { data, error } = await supabase.from("leads").insert(payload).select();
    if (error) throw error;
    return NextResponse.json({
      inserted: data ?? [],
      inserted_count: (data ?? []).length,
      skipped_duplicates: skippedDuplicatesCount,
    });
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

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const id = body?.id as string | undefined;
    const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : undefined;
    const userId = body?.user_id as string | undefined;

    const targetIds = ids?.filter((value) => typeof value === "string" && value.trim()) ?? (id ? [id] : []);
    if (!targetIds.length || !userId) {
      return NextResponse.json({ error: "Lead id(s) and user_id are required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("leads").delete().in("id", targetIds).eq("user_id", userId);
    if (error) throw error;

    return NextResponse.json({ success: true, deleted_count: targetIds.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
