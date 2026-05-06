import type { CallResult, DidRecord } from "@/types";
import { toFixedNum } from "./utils";

export function getDidWarmupCap(did: DidRecord): number {
  const createdAt = did.created_at ? new Date(did.created_at) : null;
  const now = new Date();

  let ageDays = 0;
  if (createdAt && !Number.isNaN(createdAt.getTime())) {
    const diffMs = now.getTime() - createdAt.getTime();
    ageDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  let cap = 50;
  if (ageDays <= 1) cap = 50;
  else if (ageDays === 2) cap = 70;
  else if (ageDays === 3) cap = 85;
  else cap = 100;

  // Performance-based dynamic adjustment on top of age cap.
  if (did.answer_rate >= 25 && did.spam_score < 20) {
    cap += 5;
  }
  if (did.spam_score > 60) {
    cap = Math.min(cap, 10);
  }

  return Math.max(5, Math.min(100, cap));
}

export function scoreDid(did: DidRecord, leadAreaCode: string): number {
  const localPresenceBoost = did.area_code === leadAreaCode ? 50 : 0;

  return (
    localPresenceBoost +
    did.answer_rate * 0.5 -
    did.spam_score * 0.3 -
    did.calls_today * 0.2
  );
}

export function getClosestAreaCodeMatch(candidates: DidRecord[], leadAreaCode: string) {
  if (!candidates.length) {
    return null;
  }

  const leadAreaNum = Number(leadAreaCode);
  if (Number.isNaN(leadAreaNum)) {
    return candidates[0];
  }

  const sorted = [...candidates].sort((a, b) => {
    const diffA = Math.abs(Number(a.area_code) - leadAreaNum);
    const diffB = Math.abs(Number(b.area_code) - leadAreaNum);
    return diffA - diffB;
  });

  return sorted[0];
}

export function updateDidScoreAfterCall(did: DidRecord, callResult: CallResult) {
  let spamScore = did.spam_score;

  if (callResult === "answered") {
    spamScore = Math.max(0, spamScore - 1);
  } else if (callResult === "no_answer") {
    spamScore = Math.min(100, spamScore + 1);
  } else if (callResult === "spam_flagged") {
    spamScore = Math.min(100, spamScore + 18);
  } else {
    spamScore = Math.min(100, spamScore + 5);
  }

  let status = did.status;
  if (spamScore > 95) {
    status = "retired";
  } else if (spamScore > 80) {
    status = "cooldown";
  }

  return {
    spam_score: toFixedNum(spamScore),
    status,
  };
}
