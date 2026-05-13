export type DidStatus = "active" | "cooldown" | "retired";
export type LeadStatus = "pending" | "dialed" | "completed";
export type CallResult =
  | "answered"
  | "no_answer"
  | "busy"
  | "failed"
  | "spam_flagged";
export type CallDirection = "inbound" | "outbound";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus =
  | "queued"
  | "accepted"
  | "sending"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | "received";

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
  /** When the rep plans to call back (ISO string from API). */
  callback_at?: string | null;
  callback_notes?: string | null;
  created_at?: string;
}

export interface CallLogRecord {
  id: string;
  phone: string;
  did: string;
  lead_name?: string | null;
  direction?: CallDirection;
  result: CallResult;
  duration: number | null;
  timestamp: string;
  call_notes?: string | null;
  created_at?: string;
}

export interface MessageLogRecord {
  id: string;
  user_id: string;
  lead_id: string | null;
  lead_name: string | null;
  phone: string;
  did: string;
  direction: MessageDirection;
  body: string;
  status: MessageStatus;
  twilio_message_sid: string | null;
  error_message: string | null;
  timestamp: string;
  created_at?: string;
}

export interface NoteRecord {
  id: string;
  user_id: string;
  content: string;
  updated_at: string;
  created_at?: string;
}
