create extension if not exists "uuid-ossp";

create table if not exists did_pool (
  id uuid primary key default uuid_generate_v4(),
  did text not null unique,
  area_code text not null,
  status text not null default 'active' check (status in ('active', 'cooldown', 'retired')),
  calls_today integer not null default 0,
  total_calls integer not null default 0,
  answer_rate numeric(5,2) not null default 0,
  spam_score numeric(5,2) not null default 0,
  last_used timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text not null,
  area_code text not null,
  status text not null default 'pending' check (status in ('pending', 'dialed', 'completed')),
  assigned_did text,
  result text,
  callback_at timestamptz,
  callback_notes text,
  created_at timestamptz not null default now()
);

create table if not exists call_logs (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  did text not null,
  result text not null,
  timestamp timestamptz not null default now(),
  duration integer,
  created_at timestamptz not null default now()
);

create table if not exists notes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique,
  content text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists message_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  lead_id uuid references leads(id) on delete set null,
  lead_name text,
  phone text not null,
  did text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  status text not null default 'queued' check (
    status in (
      'queued',
      'accepted',
      'sending',
      'sent',
      'delivered',
      'undelivered',
      'failed',
      'received'
    )
  ),
  twilio_message_sid text unique,
  error_message text,
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists message_logs_user_timestamp_idx
  on message_logs (user_id, timestamp desc);

create index if not exists message_logs_conversation_idx
  on message_logs (user_id, phone, did, timestamp desc);

create index if not exists message_logs_lead_id_idx
  on message_logs (lead_id);

create table if not exists message_opt_outs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  phone text not null,
  did text,
  reason text not null default 'STOP',
  created_at timestamptz not null default now(),
  unique (user_id, phone, did)
);

create index if not exists message_opt_outs_user_phone_idx
  on message_opt_outs (user_id, phone);

-- One row per app user: which DID to prefer for outbound SMS (voice/calls unchanged).
create table if not exists user_messaging_preferences (
  user_id uuid primary key,
  default_messaging_did text,
  updated_at timestamptz not null default now()
);
