create extension if not exists "uuid-ossp";

create table if not exists users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'agent' check (role in ('agent', 'admin', 'superadmin')),
  created_at timestamptz not null default now()
);

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
  business_name text,
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
  user_id uuid references users (id) on delete set null,
  phone text not null,
  did text not null,
  direction text check (direction in ('inbound', 'outbound')),
  result text not null,
  timestamp timestamptz not null default now(),
  duration integer,
  call_notes text,
  created_at timestamptz not null default now()
);

create index if not exists call_logs_user_outbound_timestamp_idx
  on call_logs (user_id, timestamp desc)
  where direction = 'outbound' and user_id is not null;

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

-- Saved numbers for Connect Call (3-way / conference add participant).
create table if not exists conference_participants (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  label text not null,
  phone text not null,
  normalized_phone text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, normalized_phone)
);

create index if not exists conference_participants_user_sort_idx
  on conference_participants (user_id, sort_order asc, created_at asc);

create table if not exists call_conference_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  conference_name text not null unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  lead_phone text not null,
  caller_id text not null,
  agent_identity text,
  lead_id uuid references leads(id) on delete set null,
  parent_call_sid text,
  agent_call_sid text,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists call_conference_sessions_user_active_idx
  on call_conference_sessions (user_id, status, created_at desc);
