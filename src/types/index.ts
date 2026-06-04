export type UserRole = "agent" | "admin" | "superadmin";

export interface AppUserRecord {
  id: string;
  email: string;
  role: UserRole;
  created_at?: string;
}

export interface AgentDialStatsRow {
  user_id: string;
  email: string;
  dial_count: number;
  answered_count: number;
}

export interface ActiveConferenceSessionRow {
  id: string;
  user_id: string;
  agent_email: string;
  conference_name: string;
  direction: CallDirection;
  lead_phone: string;
  caller_id: string;
  created_at: string;
}

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
  business_name?: string | null;
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
  /** Matching lead for this user (newest lead with same normalized phone), when any. */
  lead_id?: string | null;
  lead_name?: string | null;
  direction?: CallDirection;
  result: CallResult;
  duration: number | null;
  timestamp: string;
  call_notes?: string | null;
  conference_name?: string | null;
  twilio_recording_sid?: string | null;
  recording_url?: string | null;
  created_at?: string;
}

/** Superadmin call log row (includes calls without recordings). */
export interface SuperadminCallHistoryRow extends CallLogRecord {
  user_id: string;
  agent_email: string;
  has_recording: boolean;
}

/** Saved Twilio recording linked to a call_logs row — for replay in superadmin. */
export interface SuperadminCallRecordingRow {
  id: string;
  user_id: string;
  agent_email: string;
  lead_name: string | null;
  phone: string;
  did: string;
  direction?: CallDirection;
  result: CallResult;
  duration: number | null;
  timestamp: string;
  call_notes?: string | null;
  twilio_recording_sid: string;
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

/** Saved third-party line to dial into an active conference (DB-backed in a later phase). */
export interface ConferenceParticipantRecord {
  id: string;
  user_id: string;
  label: string;
  phone: string;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}
