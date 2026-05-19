alter table call_conference_sessions
  add column if not exists lead_call_sid text;
