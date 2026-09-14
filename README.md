# VIGIL AI

> **Someone is looking out for you.**
> A personnel wellness & operational support platform — workload, shifts, recovery, incidents, and human support, in one calm, secure place.

## Status

**All 15 development phases complete · integration adapters wired (v0.16.0).**
The app runs fully on demo data with zero credentials. Live services activate by environment variable — see *Demo vs Live mode* below.

## Quick start (zero dependencies)

```bash
python3 server/vigil_server.py          # http://127.0.0.1:8787
DEMO_ACCOUNTS=0 python3 server/vigil_server.py   # hide the demo-account quick-fill buttons
```

Requirements: **Python 3.9+** (stdlib only). No pip installs, no API keys.

## Demo accounts (seeded automatically)

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@vigil.demo` | `Vigil#2024` |
| Supervisor | `supervisor@vigil.demo` | `Vigil#2024` |
| Medic Officer | `medic@vigil.demo` | `Vigil#2024` |
| Personnel | `priya@vigil.demo` (steady week) | `Vigil#2024` |
| Personnel | `rohan@vigil.demo` (extended-duty story) | `Vigil#2024` |
| Personnel | `leila@vigil.demo` (short-rest story) | `Vigil#2024` |

**One-minute tour (as Priya):** Dashboard → Shift Monitor → Tasks (open one, drag progress) → Wellness → Recovery Score → Weekly Report → VIGIL AI Assistant → De-stress Zone (play a track) → Buddy Connect → Message From Home → Notifications. Sign in as the supervisor/medic/admin to see their queues.

## Feature map

| Module | Route | Roles | Highlights |
|---|---|---|---|
| Dashboard | `#/dashboard` | personnel, supervisor | Next shift, tasks, wellness, Recovery Score ring with factor breakdown |
| Shift Monitor | `#/shifts` | personnel (+ team view) | Extended-duty / short-rest / consecutive-day flags, weekly stats, history |
| Tasks | `#/tasks` | all | Progress updates, supervisor assignment + notifications, RBAC |
| Wellness Monitor | `#/wellness` | personnel | Simulated vitals vs own baseline, trends, non-diagnostic insights |
| Recovery Score | `#/recovery` | personnel | Transparent 5-factor formula, "what would help", 14-day history |
| Weekly Report | `#/report` | personnel | Workload/tasks/wellness/recovery + mock AI summary + private reflection |
| VIGIL AI Assistant | `#/assistant` | personnel | Persisted chat, server-side AI proxy, safety redirects, private |
| De-stress Zone | `#/destress` | personnel | 12 generative ambient tracks (Web Audio, no copyrighted files), wind-down timer, videos |
| Buddy Connect | `#/buddy` | personnel | Voluntary pairing, chat, explicit sharing toggles (off by default) |
| Message From Home | `#/home` | personnel | Invite-code video messages, hide/delete, private by design |
| Medic Connection | `#/medic` | personnel, medic | Requests + private threads + **authorization-gated** wellness summary |
| Supervisor Connection | `#/supervisor` | personnel, supervisor | Workload concerns + threads; **no wellness route exists at all** |
| Incident Reporting | `#/incidents` | personnel, supervisor, admin | Severity triage, context notes, resolution enforcement, full audit |
| Notifications | `#/notifications` | all | Engine with weekly digests, gentle reminders, dedup, kind filters |
| Admin Panel | `#/admin` | admin | Users, broadcast, audit log, integration status |

**246 automated smoke tests** (`python3 server/smoke_test.py`) cover auth, RBAC, privacy boundaries (wellness never leaks to supervisors/buddies), validation, and every module's flow.

## Architecture

```
server/                   Python-stdlib backend (demo adapter of the Supabase contract)
  vigil_server.py         entrypoint · router · static hosting · security headers · rate limits
  security.py             PBKDF2 hashing · sessions · rate limiting · validation
  data_store.py           JSON persistence + concurrent access
  auth_api.py             /api/auth/* + /api/me · audit logging
  api_routes.py           dashboard, notifications, admin, users lookup
  *_api.py                shifts · tasks · wellness · recovery · report · ai · media ·
                          buddy · home · medic · supervisor · incidents
  ai_provider.py          mock (default) + OpenAI/Anthropic adapters (env-selected)
  supabase_client.py      PostgREST wrapper + ping (live DB cutover)
  mailer.py               SMTP reset emails (in-app fallback in demo)
  notification_engine.py  weekly digests · gentle reminders · dedup
  wearable_provider.py    simulated (default) · vendor interface
  seed_data.py demo_data.py  demo users + 3 weeks of re-anchored time-series
  smoke_test.py           246 end-to-end checks

public/                   Frontend SPA (vanilla HTML/CSS/JS)
  index.html              app shell · skip link · meta/OG · favicon
  css/                    tokens · base · components · layout · auth · pages
  js/
    app.js                bootstrap · router · RBAC guards · offline banner
    api.js                fetch wrapper (integrations map → live base)
    store.js theme.js ui.js audio_engine.js
    pages/                one module per screen

supabase/                 Production schema for the live phase
  schema.sql              27 tables · indexes · constraints · triggers
  policies.sql            RLS · storage buckets/policies
  seed_demo.sql           demo data matching the seeded demo accounts

.env.example              every live credential, documented — none required for demo
docs/INTEGRATION.md       live-mode adapter guide (no secrets in the client)
docs/DEPLOY.md            permanent cloud deployment (Fly/Render/Docker)
.freebuff/run.md          how to run the server
```

## Deployment

The whole app is one stdlib-Python process + static files — no build step. Permanent hosted URLs (Fly.io / Render / any Docker host) are a 3-command deploy; see **`docs/DEPLOY.md`**. Locally, a Cloudflare quick tunnel serves the same app publicly (see the run doc).

## Design system

Calm, human-centered, mission-oriented. Tokens in `public/css/tokens.css` — light/dark themes, professional + serif display type, WCAG-AA contrast, reduced-motion support, skip link and focus management for keyboard users.

## Demo vs Live mode

Demo mode is the default and needs nothing external. Live mode swaps adapters documented in `docs/INTEGRATION.md`: Supabase (auth/db/storage), an LLM provider (server-side only), wearables, media, and SMTP — **by environment variable alone** (`VIGIL_MODE=live` + keys from `.env.example`). Check readiness in **Admin → Overview → Integrations**: it shows which categories are configured, never the values.

## Security foundations

PBKDF2-SHA256 password hashing · opaque server-side sessions (HttpOnly, SameSite cookies) · login rate limiting (env-tunable) · role-based route guards (client **and** server) · privacy enforced by missing code paths (supervisors have *no* wellness route; medics gated by explicit authorization; buddies get nothing by default) · audit logging on every sensitive action · strict response headers (`nosniff`, `DENY`, no-referrer) · input validation everywhere · no secrets in the client — environment/config only.
