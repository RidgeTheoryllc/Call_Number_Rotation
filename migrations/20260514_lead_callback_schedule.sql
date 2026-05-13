-- Manual callback / demo schedule on leads (run in Supabase SQL editor).
-- Requires leads.user_id (already used by the app API).

alter table leads
  add column if not exists callback_at timestamptz,
  add column if not exists callback_notes text;

comment on column leads.callback_at is 'When the rep plans to call this lead back (local interpretation in UI; stored as timestamptz).';
comment on column leads.callback_notes is 'Optional note for the scheduled callback (e.g. demo time, context).';

create index if not exists leads_user_callback_at_idx
  on leads (user_id, callback_at)
  where callback_at is not null;
