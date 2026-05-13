import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/utils";

export async function getValidatedDefaultMessagingDid(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: pref, error: prefError } = await supabase
    .from("user_messaging_preferences")
    .select("default_messaging_did")
    .eq("user_id", userId)
    .maybeSingle();
  if (prefError) throw prefError;
  const raw = pref?.default_messaging_did?.trim();
  if (!raw) return null;

  const { data: dids, error: didsError } = await supabase
    .from("did_pool")
    .select("did")
    .eq("user_id", userId)
    .eq("status", "active");
  if (didsError) throw didsError;

  const target = normalizePhone(raw);
  const match = (dids ?? []).find((row) => normalizePhone(row.did) === target);
  return match ? normalizePhone(match.did) : null;
}
