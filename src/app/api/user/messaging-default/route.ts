import { NextRequest, NextResponse } from "next/server";
import { getValidatedDefaultMessagingDid } from "@/lib/messaging-default";
import { getSupabaseServerClient } from "@/lib/supabase";
import { normalizePhone } from "@/lib/utils";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("user_id")?.trim();
    if (!userId) {
      return NextResponse.json({ error: "user_id query param is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const default_messaging_did = await getValidatedDefaultMessagingDid(supabase, userId);
    return NextResponse.json({ default_messaging_did });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = body?.user_id as string | undefined;
    const didRaw = body?.default_messaging_did as string | null | undefined;

    if (!userId?.trim()) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const uid = userId.trim();

    if (didRaw === null || didRaw === "") {
      const { error } = await supabase.from("user_messaging_preferences").upsert(
        { user_id: uid, default_messaging_did: null, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      return NextResponse.json({ default_messaging_did: null });
    }

    const normalized = normalizePhone(String(didRaw).trim());
    if (!normalized) {
      return NextResponse.json({ error: "default_messaging_did must be a valid phone number" }, { status: 400 });
    }

    const { data: poolRow, error: poolError } = await supabase
      .from("did_pool")
      .select("did")
      .eq("user_id", uid)
      .eq("status", "active");
    if (poolError) throw poolError;

    const allowed = (poolRow ?? []).some((row) => normalizePhone(row.did) === normalized);
    if (!allowed) {
      return NextResponse.json(
        { error: "That number is not an active DID in your pool for this user." },
        { status: 400 },
      );
    }

    const { error: upsertError } = await supabase.from("user_messaging_preferences").upsert(
      {
        user_id: uid,
        default_messaging_did: normalized,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (upsertError) throw upsertError;

    return NextResponse.json({ default_messaging_did: normalized });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
