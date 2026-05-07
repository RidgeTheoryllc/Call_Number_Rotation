import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getDidCallsToday } from "@/lib/did-engine";
import { extractAreaCode } from "@/lib/utils";
import { normalizePhone, toFixedNum } from "@/lib/utils";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json({ error: "user_id query param is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("did_pool")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const didRows = data ?? [];
    const { data: callLogs, error: logsError } = await supabase.from("call_logs").select("did, result").eq("user_id", userId);
    if (logsError) throw logsError;

    const stats = new Map<string, { total: number; answered: number }>();
    for (const log of callLogs ?? []) {
      const key = normalizePhone(log.did);
      const current = stats.get(key) ?? { total: 0, answered: 0 };
      current.total += 1;
      if (log.result === "answered") {
        current.answered += 1;
      }
      stats.set(key, current);
    }

    const withLiveAnswerRate = didRows.map((row) => {
      const key = normalizePhone(row.did);
      const didStats = stats.get(key) ?? { total: 0, answered: 0 };
      const answerRate = didStats.total > 0 ? toFixedNum((didStats.answered / didStats.total) * 100) : 0;
      return {
        ...row,
        calls_today: getDidCallsToday(row),
        answer_rate: answerRate,
        total_calls: didStats.total || row.total_calls || 0,
      };
    });

    return NextResponse.json(withLiveAnswerRate);
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
    const didRaw = body?.did as string | undefined;
    const areaCodeRaw = body?.area_code as string | undefined;
    const userId = body?.user_id as string | undefined;
    const did = didRaw?.trim();
    const areaCode = areaCodeRaw?.trim() || (did ? extractAreaCode(did) : "");

    if (!did || !areaCode || !userId) {
      return NextResponse.json({ error: "did, area_code, and user_id are required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("did_pool")
      .insert({
        did,
        area_code: areaCode,
        status: "active",
        calls_today: 0,
        total_calls: 0,
        answer_rate: 0,
        spam_score: 0,
        user_id: userId,
      })
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

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = body?.id as string | undefined;
    const userId = body?.user_id as string | undefined;
    const status = body?.status as string | undefined;

    if (!id || !status || !userId) {
      return NextResponse.json({ error: "id, user_id, and status are required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("did_pool")
      .update({ status })
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
    const userId = body?.user_id as string | undefined;

    if (!id || !userId) {
      return NextResponse.json({ error: "id and user_id are required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const { data: didRecord, error: didError } = await supabase
      .from("did_pool")
      .select("id, did")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (didError) throw didError;

    const { count: usageCount, error: usageError } = await supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .eq("did", didRecord.did)
      .eq("user_id", userId);
    if (usageError) throw usageError;

    if ((usageCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "This DID has call history and cannot be deleted. Set it to cooldown or retired instead." },
        { status: 409 },
      );
    }

    const { error } = await supabase.from("did_pool").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
