# Call Number Rotation — System Documentation

**Product name:** Outbound Dialer Intelligence System  
**Repository:** `Call_Number_Rotation/app`  
**Stack:** Next.js 16 · React 19 · TypeScript · Supabase · Twilio Voice + SMS

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [User Roles and Authentication](#3-user-roles-and-authentication)
4. [Application Pages](#4-application-pages)
5. [Outbound Calling Flow](#5-outbound-calling-flow)
6. [Inbound Calling Flow](#6-inbound-calling-flow)
7. [Conference, Connect Call, and QA](#7-conference-connect-call-and-qa)
8. [DID Rotation Engine](#8-did-rotation-engine)
9. [SMS Messaging](#9-sms-messaging)
10. [Call Recordings](#10-call-recordings)
11. [Database Schema](#11-database-schema)
12. [Migrations](#12-migrations)
13. [API Reference](#13-api-reference)
14. [Environment Variables](#14-environment-variables)
15. [Deployment](#15-deployment)
16. [Key Source Files](#16-key-source-files)
17. [Known Limitations](#17-known-limitations)
18. [Platform Inventory](#18-platform-inventory)

---

## 1. Overview

Call Number Rotation is a web-based outbound dialer and campaign operations platform. Agents manage leads, place browser-based calls through Twilio, rotate caller IDs (DIDs) for local presence and reputation management, handle inbound callbacks, send SMS, schedule follow-ups, and use conference features for 3-way calling.

Superadmins get a separate console for agent performance analytics, live call monitoring, QA listen-in, and call recording playback.

### Core Capabilities

| Area | What it does |
|------|----------------|
| Lead management | CSV import, manual add, dial from list, auto-dial queue |
| DID rotation | Scores and selects the best caller ID per lead |
| Browser calling | Twilio Voice SDK in the agent's browser |
| Inbound calls | PSTN callers on pooled DIDs route to the owning agent |
| Conference / 3-way | Optional conference mode for Connect Call and superadmin QA |
| IVR keypad | DTMF tones to navigate voicemail/IVR on the PSTN lead leg |
| SMS | Per-DID outbound/inbound messaging with opt-out handling |
| Callbacks | Schedule `callback_at` / notes; reminder bar and due-today list |
| Analytics | Per-user dashboard with DID health and call outcomes |
| Superadmin | Cross-agent stats, live calls, recordings |

### Multi-Tenancy

Data is scoped by `user_id` on leads, DID pool, call logs, messages, and conference sessions. Each agent has their own workspace after Supabase login.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Agent / Superadmin Browser                   │
│  Next.js pages · Twilio Voice SDK · Supabase Auth (client)    │
└───────────────┬─────────────────────────────┬───────────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────────┐
│   Next.js API Routes      │   │         Supabase                 │
│   (app/src/app/api/*)     │   │  Auth · Postgres · users/leads  │
└───────────────┬───────────┘   └─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Twilio                                   │
│  REST API · TwiML webhooks · Voice SDK tokens · SMS · Recordings│
└─────────────────────────────────────────────────────────────────┘
```

### Global Providers (`src/app/layout.tsx`)

- **TwilioDeviceProvider** — Registers a Twilio Device for the logged-in user as `agent-{userId}` or `superadmin-{userId}` on superadmin routes.
- **WorkspaceProviders** — Callback reminder bar and client-side data cache on agent paths.

### Twilio Client Identities

| Identity | Used by |
|----------|---------|
| `agent-{supabaseUserId}` | Agent dialer (Leads, Callbacks, inbound) |
| `superadmin-{supabaseUserId}` | Superadmin QA listen-in (auto-accept, muted) |

Voice SDK edge: **Singapore** (`src/hooks/useTwilioDevice.ts`).

### Directory Structure

```
app/
├── docs/
│   └── SYSTEM.md                 # This file
├── migrations/                   # SQL migrations (run manually in Supabase)
├── supabase-schema.sql           # Baseline schema
├── package.json
└── src/
    ├── app/                      # Pages + API routes (App Router)
    ├── components/               # UI, Twilio provider, keypad, shells
    ├── hooks/                    # useTwilioDevice
    ├── lib/                      # db, did-engine, twilio-conference, etc.
    └── types/                    # Shared TypeScript types
```

---

## 3. User Roles and Authentication

### Roles (`users.role`)

| Role | Access |
|------|--------|
| `agent` | Default on signup; full agent workspace |
| `admin` | Defined in DB; no separate UI (treated like agent) |
| `superadmin` | Superadmin console + protected superadmin APIs |

### Auth Flow

1. Email/password via **Supabase Auth** (`/login`).
2. On login/signup → `POST /api/auth/sync-user` ensures a `users` row exists.
3. Role from `GET /api/auth/me?user_id=`.
4. Superadmin portal: `/login?portal=superadmin` (no signup; non-superadmin users are rejected).

**Promoting a superadmin:** Manually set `users.role = 'superadmin'` in Supabase. There is no in-app promotion UI.

### Routing

| Portal | Home path |
|--------|-----------|
| Agent | `/` |
| Superadmin | `/superadmin` |

### Security Note

Most API routes accept `user_id` from the client without verifying the Supabase session server-side. Superadmin routes use `assertSuperadmin()` against the database. For production hardening, consider server-side session validation on all routes.

---

## 4. Application Pages

### Agent Workspace

| Route | Purpose |
|-------|---------|
| `/` | Dashboard: calls today, active DIDs, answer rate, spam alerts, charts |
| `/did-pool` | Manage DIDs; configure Twilio voice/SMS webhooks; set default SMS DID |
| `/leads` | Lead list, CSV import, click-to-call, auto-dial, in-call controls, IVR keypad, mic selector |
| `/callbacks` | Scheduled callbacks; dial-back workflow |
| `/connect-call` | 3-way conference: save contacts, add third party to live call |
| `/messages` | SMS conversations per lead/phone |
| `/call-logs` | Call history with editable notes |
| `/login` | Sign in / sign up |

### Superadmin Console

| Route | Purpose |
|-------|---------|
| `/superadmin` | Agent dial stats by shift window |
| `/superadmin/live-calls` | Active conferences; QA listen-in |
| `/superadmin/recordings` | Browse/search recorded calls, audio playback |
| `/superadmin/call-history` | Redirects → `/superadmin/recordings` |
| `/superadmin/login` | Redirects → `/login?portal=superadmin` |

---

## 5. Outbound Calling Flow

Primary path used from **Leads** and **Callbacks**.

```
Agent clicks Dial
    │
    ├─► POST /api/rotate-did          → selectBestDid() scores DID pool
    │
    ├─► POST /api/twilio/call        → Twilio REST: dial client:agent-{userId}
    │                                  voice URL → /api/twilio/voice
    │
    ├─► Browser receives incoming client leg → auto-accepted
    │
    ├─► POST /api/twilio/voice        → TwiML (conference or legacy Dial)
    │
    ├─► Lead PSTN leg connected
    │
    └─► POST /api/twilio/call-status  → call_logs, lead update, DID scoring
```

### Conference Mode (`TWILIO_CONFERENCE_CALLS=true`)

1. `createConferenceSession` writes a row to `call_conference_sessions`.
2. Agent browser leg joins conference (recording enabled).
3. Lead is dialed into the same conference asynchronously.
4. `lead_call_sid` is stored when the lead leg is created.
5. Conference name format: `cnf-{sanitizedAgentCallSid}`.

### Legacy Mode (conference disabled)

TwiML uses `<Dial><Number>` bridge directly. Connect Call, IVR keypad via server, and recordings depend on conference mode.

---

## 6. Inbound Calling Flow

1. Caller dials a DID from the agent's pool.
2. Twilio voice webhook → `POST /api/twilio/inbound` (configured via DID Pool UI or `configure-numbers`).
3. System resolves `user_id` from `did_pool` by called number.
4. **Conference mode:** Lead placed in conference; agent dialed as `client:agent-{userId}` with retries (up to 6 via `agent-status`).
5. **Legacy mode:** Direct `<Dial><Client>` with `inbound-status` retry loop.

When the lead hangs up, `conference/status` disconnects the agent browser leg so the UI resets.

---

## 7. Conference, Connect Call, and QA

### Connect Call (`/connect-call`)

- Requires an active in-progress call with a resolved conference session.
- `GET /api/twilio/conference/active` polls readiness.
- `POST /api/twilio/conference/connect` dials a saved contact into the live conference.
- Saved contacts live in `conference_participants`.

### Superadmin QA Listen-In

- `POST /api/superadmin/listen` dials `superadmin-{userId}` into the conference **muted**.
- Superadmin Device auto-accepts and mutes on connect.

### IVR Keypad

**UI:** `CallKeypad` component on Leads/Callbacks during an active call.

**Flow:**

1. `POST /api/twilio/send-digits` with `user_id`, `agent_call_sid`, `digits`.
2. `sendDigitsToLeadLeg()` resolves the PSTN lead leg from `call_conference_sessions`.
3. Server redirects the lead leg to TwiML: `<Play digits="...">` then rejoins conference.
4. Falls back to `activeCall.sendDigits()` on the agent browser leg if conference mode is off or session/lead SID is missing.

**Production requirements for keypad:**

- `TWILIO_CONFERENCE_CALLS=true`
- `call_conference_sessions` table exists
- `lead_call_sid` populated after outbound lead dial
- Server uses Play + rejoin TwiML (not raw `SendDigits` REST on an existing call)

**Why client fallback fails in conference:** DTMF sent via `activeCall.sendDigits()` on the agent browser leg is consumed by the conference and never reaches the PSTN lead.

---

## 8. DID Rotation Engine

**File:** `src/lib/did-engine.ts`  
**Timezone:** `Asia/Manila` for "today" counters and dashboard date boundaries.

### Scoring (`scoreDid`)

```
score = localPresenceBoost (+50 if area code matches lead)
      + answer_rate × 0.5
      - spam_score × 0.3
      - calls_today × 0.2
```

### Warmup Caps (`getDidWarmupCap`)

| DID age | Base daily cap |
|---------|----------------|
| 0–1 days | 50 |
| 2 days | 70 |
| 3 days | 85 |
| 4+ days | 100 |

Adjustments: +5 if answer rate ≥ 25% and spam < 20; cap ≤ 10 if spam > 60.

### Post-Call Updates (`updateDidScoreAfterCall`)

| Result | Spam change |
|--------|-------------|
| Answered | −1 |
| No answer | +1 |
| Spam flagged | +18 |
| Other failures | +5 |

Status transitions: spam > 80 → `cooldown`; spam > 95 → `retired`.

---

## 9. SMS Messaging

| Direction | Endpoint | Notes |
|-----------|----------|-------|
| Outbound | `POST /api/twilio/messages` | From: explicit DID → user default → lead assigned → `selectBestDid` |
| Inbound | `POST /api/twilio/messages/inbound` | Resolves user from DID; handles STOP → `message_opt_outs` |
| Status | `POST /api/twilio/messages/status` | Delivery status updates |

**Provisioning:** DID Pool UI triggers `configure-messaging` and `configure-numbers` to point Twilio numbers at your `NEXT_PUBLIC_BASE_URL` webhooks.

---

## 10. Call Recordings

- Conference TwiML sets `record: record-from-start`.
- Twilio posts to `/api/twilio/recording-status`.
- Metadata saved on `call_logs` or buffered in `pending_call_recordings` if the log row does not exist yet.
- Superadmin replays via `/api/superadmin/recording` (proxies Twilio MP3 with Basic auth).

---

## 11. Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | App profile linked to `auth.users`; `role` |
| `did_pool` | Caller ID numbers, reputation metrics, status |
| `leads` | Lead records, callback schedule, dial results |
| `call_logs` | Call history, notes, recording metadata |
| `notes` | Per-user notepad (single row) |
| `message_logs` | SMS audit trail |
| `message_opt_outs` | STOP/opt-out per user/phone/DID |
| `user_messaging_preferences` | Default outbound SMS DID |
| `conference_participants` | Saved Connect Call contacts |
| `call_conference_sessions` | Active conference mapping for live calls |
| `pending_call_recordings` | Recording buffer before `call_logs` exists |

### Important Columns

**`leads`:** `name`, `business_name`, `phone`, `area_code`, `status`, `assigned_did`, `result`, `callback_at`, `callback_notes`

**`call_conference_sessions`:** `conference_name`, `direction`, `lead_phone`, `caller_id`, `agent_call_sid`, `lead_call_sid`, `parent_call_sid`, `status`

**`call_logs`:** `conference_name`, `twilio_recording_sid`, `recording_url`

### Schema Gap

The app queries `user_id` on `leads` and `did_pool`, but `supabase-schema.sql` does not define those columns. For a fresh install, run:

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);
ALTER TABLE did_pool ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS leads_user_id_idx ON leads (user_id);
CREATE INDEX IF NOT EXISTS did_pool_user_id_idx ON did_pool (user_id);
```

---

## 12. Migrations

Run in the **Supabase SQL editor** in this order:

| File | Adds |
|------|------|
| `supabase-schema.sql` | Baseline schema |
| `migrations/20260514_lead_callback_schedule.sql` | `callback_at`, `callback_notes` |
| `migrations/20260518_conference_participants.sql` | `conference_participants` |
| `migrations/20260518_call_conference_sessions.sql` | `call_conference_sessions` |
| `migrations/20260519_users_superadmin_role.sql` | `superadmin` role + stats index |
| `migrations/20260519_call_conference_lead_call_sid.sql` | `lead_call_sid` |
| `migrations/20260521_call_log_recordings.sql` | Recording columns + `pending_call_recordings` |
| `migrations/20260604_lead_business_name.sql` | `business_name` on leads |

Plus the `user_id` columns in [§11](#schema-gap) if not already present.

---

## 13. API Reference

### Auth

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/signup` | Create user + `users` row (`agent`) |
| POST | `/api/auth/sync-user` | Upsert profile on login |
| GET | `/api/auth/me` | Return role and profile |

### App Data

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard` | Per-user analytics |
| * | `/api/leads` | Lead CRUD |
| GET/PATCH | `/api/call-logs` | List + update notes |
| * | `/api/did-pool` | DID CRUD |
| POST | `/api/rotate-did` | Select best DID for a lead |
| GET/PUT | `/api/notes` | Agent notepad |
| GET | `/api/messages` | Message history |
| * | `/api/conference-participants` | Saved 3-way contacts |
| GET/PUT | `/api/user/messaging-default` | Default SMS DID |

### Twilio — Voice

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/twilio/token` | Voice SDK JWT |
| POST | `/api/twilio/call` | Initiate click-to-call |
| POST | `/api/twilio/voice` | TwiML App webhook |
| POST | `/api/twilio/call-status` | Outbound status callback |
| POST | `/api/twilio/voice-status` | Legacy dial action |
| POST | `/api/twilio/inbound` | Inbound PSTN TwiML |
| POST | `/api/twilio/inbound-status` | Inbound agent retry |
| POST | `/api/twilio/send-digits` | IVR keypad DTMF |
| GET | `/api/twilio/conference/active` | Connect Call readiness |
| POST | `/api/twilio/conference/connect` | Add 3rd party |
| POST/GET | `/api/twilio/conference/join` | TwiML: join conference |
| POST/GET | `/api/twilio/conference/status` | Conference lifecycle |
| POST/GET | `/api/twilio/conference/agent-status` | Inbound agent retry |
| POST/GET | `/api/twilio/conference/lead-leg-status` | Lead leg ended → hang up agent |
| POST/GET | `/api/twilio/recording-status` | Recording metadata |

### Twilio — SMS and Provisioning

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/twilio/messages` | Send SMS |
| POST | `/api/twilio/messages/inbound` | Inbound SMS |
| POST | `/api/twilio/messages/status` | Delivery status |
| POST | `/api/twilio/configure-numbers` | Set voice webhooks on DIDs |
| POST | `/api/twilio/configure-messaging` | Set SMS webhooks |
| GET | `/api/twilio/diagnose` | Compare pool vs Twilio config |
| GET | `/api/twilio/conference/config` | Conference enabled + base URL check |

### Superadmin

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/superadmin/agent-dial-stats` | Agent performance |
| GET | `/api/superadmin/active-calls` | Live conferences |
| POST | `/api/superadmin/listen` | QA listen-in |
| GET | `/api/superadmin/recordings` | Recording list |
| GET | `/api/superadmin/recording` | Stream recording audio |

### Legacy

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/place-call` | Server-initiated outbound (mock without Twilio creds) |

---

## 14. Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side Supabase |
| `TWILIO_ACCOUNT_SID` | Yes | Twilio REST |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio REST |
| `TWILIO_API_KEY` | Yes | Voice SDK token signing |
| `TWILIO_API_SECRET` | Yes | Voice SDK token signing |
| `TWILIO_TWIML_APP_SID` | Yes | Client incoming/outgoing |
| `NEXT_PUBLIC_BASE_URL` | Yes (prod) | Public webhook base URL |
| `TWILIO_CONFERENCE_CALLS` | Recommended | `true` / `1` / `yes` |
| `TWILIO_DEFAULT_CALLER_ID` | Optional | Fallback caller ID in voice webhook |
| `TWILIO_TWIML_URL` | Optional | Legacy `place-call` only |

**Local:** `app/.env.local`  
**Production:** Hosting provider environment settings (Vercel / Netlify)

Do not commit secrets to Git.

---

## 15. Deployment

### Prerequisites

1. Supabase project with Auth (email/password) enabled.
2. Twilio account with Voice + SMS-capable numbers.
3. Twilio TwiML App with Voice Request URL:  
   `{NEXT_PUBLIC_BASE_URL}/api/twilio/voice` (POST)
4. All migrations applied (see [§12](#12-migrations)).

### Build and Run

```powershell
cd app
npm install
npm run dev      # local development
npm run build    # production build
npm start        # production server
```

Deploy the **`app`** folder as the project root (not the parent `Call_Number_Rotation` folder).

### Post-Deploy Checklist

- [ ] Set all environment variables on the host.
- [ ] `NEXT_PUBLIC_BASE_URL` matches the live domain exactly.
- [ ] `TWILIO_CONFERENCE_CALLS=true` for conference, Connect Call, keypad, recordings.
- [ ] Run DID Pool → configure voice + SMS webhooks for each number.
- [ ] Assign at least one superadmin in Supabase (`users.role`).
- [ ] Place a test outbound call and verify `call_conference_sessions.lead_call_sid` is set.
- [ ] Test IVR keypad against a voicemail/IVR prompt.

### Git Remote

The Git repository lives in `app/`, not the parent folder:

```powershell
cd "...\Call_Number_Rotation\app"
git remote add origin https://github.com/RidgeTheoryllc/Call_Number_Rotation.git
git push -u origin main
```

### Twilio Webhook URLs (production)

Replace `{BASE}` with your `NEXT_PUBLIC_BASE_URL`:

| Webhook | URL |
|---------|-----|
| TwiML App (voice) | `{BASE}/api/twilio/voice` |
| Inbound voice (per DID) | `{BASE}/api/twilio/inbound` |
| Inbound SMS (per DID) | `{BASE}/api/twilio/messages/inbound` |
| Outbound call status | `{BASE}/api/twilio/call-status` |
| Recording status | `{BASE}/api/twilio/recording-status` |
| Conference status | `{BASE}/api/twilio/conference/status` |

---

## 16. Key Source Files

| File | Responsibility |
|------|----------------|
| `src/hooks/useTwilioDevice.ts` | Twilio Device lifecycle, call state, sendDigits |
| `src/lib/twilio-conference.ts` | Conference sessions, DTMF, QA monitor, connect resolution |
| `src/lib/did-engine.ts` | DID scoring, warmup caps, spam updates |
| `src/lib/db.ts` | Supabase queries for dashboard, DID updates |
| `src/lib/call-recording.ts` | Recording callbacks + pending merge |
| `src/components/call-keypad.tsx` | IVR keypad UI |
| `src/components/twilio-device-provider.tsx` | Identity routing agent vs superadmin |
| `src/app/api/twilio/voice/route.ts` | Outbound TwiML (conference vs legacy) |
| `src/app/api/twilio/inbound/route.ts` | Inbound PSTN TwiML |

---

## 17. Known Limitations

1. **Client-trusted `user_id`** — Most APIs do not verify the Supabase JWT server-side.
2. **`admin` role** — Exists in DB but has no distinct permissions.
3. **Legacy vs conference** — Calls started before enabling conference mode use the legacy 1:1 bridge; keypad and Connect Call need conference mode.
4. **Keypad fallback** — If server cannot resolve the lead leg, UI may show "Sent" while DTMF only hits the agent browser leg.
5. **Recording race** — `pending_call_recordings` buffers metadata when Twilio fires before `call_logs` is inserted.
6. **Timezone** — Dashboard and DID "today" counters use `Asia/Manila`; callback reminders use the device's local calendar day.
7. **DTMF redirect** — Playing digits temporarily removes the lead from the conference; `disconnectAgentWhenLeadLeaves` waits and checks call status before hanging up the agent.

---

## 18. Platform Inventory

| Platform | Role in this system | Credentials location |
|----------|---------------------|----------------------|
| Supabase | Auth + Postgres | `.env.local` / hosting env |
| Twilio | Voice, SMS, recordings | `.env.local` / hosting env |
| Vercel / Netlify | App hosting | Platform dashboard |
| GitHub | Source control | `RidgeTheoryllc/Call_Number_Rotation` |

Store production credentials in a shared password manager under company-owned emails — not in this document.

---

*Last updated: June 2026*
