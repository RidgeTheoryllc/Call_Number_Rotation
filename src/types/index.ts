export type DidStatus = "active" | "cooldown" | "retired";
export type LeadStatus = "pending" | "dialed" | "completed";
export type CallResult =
  | "answered"
  | "no_answer"
  | "busy"
  | "failed"
  | "spam_flagged";

export interface DidRecord {
  id: string;
  did: string;
  area_code: string;
  status: DidStatus;
  calls_today: number;
  total_calls: number;
  answer_rate: number;
  spam_score: number;
  last_used: string | null;
  created_at?: string;
}

export interface LeadRecord {
  id: string;
  name: string;
  phone: string;
  area_code: string;
  status: LeadStatus;
  assigned_did: string | null;
  result: CallResult | null;
  created_at?: string;
}

export interface CallLogRecord {
  id: string;
  phone: string;
  did: string;
  lead_name?: string | null;
  result: CallResult;
  duration: number | null;
  timestamp: string;
  call_notes?: string | null;
  created_at?: string;
}

export interface NoteRecord {
  id: string;
  user_id: string;
  content: string;
  updated_at: string;
  created_at?: string;
}
