# VIGIL AI

> **Someone is looking out for you.**
> A personnel wellness & operational support platform — workload, shifts, recovery, incidents, and human support, in one calm, secure place.

## Status

**All 15 development phases complete · SIH upgrade (v0.17.0) · Offline-first welfare transfer (v0.18.0) · Intelligence & privacy layer (v0.19.0).**
The app runs fully on demo data with zero credentials. Live services activate by environment variable — see *Demo vs Live mode* below.

### What's intelligent (v0.19.0)

- **Uncertainty-aware Fatigue Forecast** — 24h/48h *projected* recovery with ± uncertainty and a stated confidence, computed by a transparent deterministic engine (modular abstraction, ready to be replaced by a trained model later). "Why this forecast?" lists every contributor with its arithmetic; the UI never says *guaranteed*.
- **Closed-loop support tracking** — engaging support (De-Stress Zone, Buddy, Medic, supervisor load-talk…) records an intervention; the follow-up panel shows the *observed* recovery change afterwards in strictly observational language — never "the intervention caused this".
- **Intervention efficacy (admin)** — anonymized, aggregate-only insight per support type with a minimum-sample guard: below 5 follow-ups it reads **Insufficient data** instead of inventing a percentage. Negative observed changes are shown as-is.
- **Weekly Wellbeing Check-in** — a recurring self-reflection trend, deliberately separate from the device-derived Recovery Score, and never a diagnosis or psychological test.
- **On-device anomaly detection** — wellness signals are processed locally in the browser; only a minimal result (status + confidence + timestamp) is queued for upload. Raw biometrics stay on the device — the transparency panel on the Wellbeing page explains exactly what crosses the line.
- **Roster Fatigue Balancer (supervisor)** — what-if duty changes project the *aggregate* team recovery; members appear with operational facts only (week hours, consecutive days). The privacy boundary is enforced server-side in `server/roster.py` — individual health values have no code path to this view.

### What's offline-first (v0.18.0)

- **Offline shell + local data** — the service worker caches the whole app shell; wellness and recovery data is cached in **IndexedDB** (six structured stores: `personnel_data`, `wellness_data`, `welfare_reports`, `pending_transfers`, `sync_queue`, `kv`). No internet does not mean no support.
- **Authorized Welfare Report** — before any transfer, data is reduced to exactly what the recipient's role allows (medic: recovery/risk/HR & HRV trends/sleep/duty/factors; supervisor: recovery *band* + duty only). Shared vs not-shared is declared in the UI before confirming. Admins are never transfer recipients.
- **CommunicationService transports** — *Local Wi-Fi relay* (real HTTP store-and-forward on the local network — internet not required), *direct device link* (real WebRTC DataChannel with an honest out-of-band signaling step), and a clearly-labelled one-device *simulated* demo transport. New transports (Bluetooth/LoRa) register the same way.
- **Pairing + end-to-end sealing** — a 6-character code creates the session; the report is sealed with **AES-GCM-256** (PBKDF2 from the session code) so the relay stores ciphertext only; both screens show the verified recipient identity before anything moves.
- **Store-and-forward** — if no channel exists, reports wait in **Pending transfers** and are never deleted; retry anytime. **Sync queue** drains to the central store when internet returns, idempotently (`client_ref` dedupe — retries never duplicate).
- **Honest status UI** — ONLINE / OFFLINE — local mode / SYNCING / SYNCED / TRANSFER AVAILABLE / TRANSFER UNAVAILABLE chips; the demo "offline simulation" is explicitly labelled and never fakes a transfer.

### What's connected (v0.17.0)

- **VIGIL Insight (dashboard)** — a deterministic engine joins shifts, tasks, rest and recovery into explainable insights with evidence chips and band-ranked support options. No AI guessing: the same data always yields the same insight, and every insight links to the page that proves it.
- **Explainable Recovery** — "Why did my score change?" compares yesterday's and today's factor rows and reports each change with its inputs (e.g. *Weekly shift load: 52.5h → 60.5h, −5 pts*).
- **Grounded Assistant** — platform questions (week summary, score change, shifts, tasks, support) are answered from the user's own data; support requests route to one-tap links. Everything else still reaches the AI provider, with an outage fallback.
- **Consent-first sharing** — six share categories (presence, task count, shift info, recovery score, sleep, wellness trends), all off by default, confirm step, one-tap revoke. Shared reads are minimal by design (score without factor inputs, sleep as hours only).
- **Incident workflow** — Submitted → Assigned → Under Review → Escalated → Resolved, with a visual stepper, ownership, and notifications at each transition.
- **Personnel Timeline** — the user's own cross-module journey (shifts, tasks, recovery updates, support requests, incidents) in one linked view.
- **Demo Mode for judging** — three contrasted personnel personas (Priya: the connected story · Rohan: heavy load · Aarav: steady) plus a 12-step demo script in Admin → Demo guide.
- **Role boundaries verified by tests** — supervisors never receive wellness data (no code path exists); medic wellness views require explicit authorization; admins see operations, not private content.

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
| Dashboard | `#/dashboard` | personnel, supervisor | Next shift, tasks, wellness, Recovery Score ring, VIGIL Insight with evidence + support options, **Fatigue Forecast (24h/48h ± uncertainty, why-panel)** |
| Timeline | `#/timeline` | personnel | Own cross-module journey: shifts, tasks, recovery, support, incidents — linked |
| Shift Monitor | `#/shifts` | personnel (+ team view) | Extended-duty / short-rest / consecutive-day flags, weekly stats, history |
| Tasks | `#/tasks` | all | Progress updates, supervisor assignment + notifications, RBAC |
| Wellness Monitor | `#/wellness` | personnel | Simulated vitals vs own baseline, trends, non-diagnostic insights |
| Recovery Score | `#/recovery` | personnel | Transparent 5-factor formula, "what would help", 14-day history, **closed-loop support engagements + observed-change follow-ups** |
| Wellbeing Check-in | `#/wellbeing` | personnel | Weekly self-report trend (separate from Recovery), on-device anomaly transparency panel |
| Weekly Report | `#/report` | personnel | Workload/tasks/wellness/recovery + mock AI summary + private reflection |
| VIGIL AI Assistant | `#/assistant` | personnel | Persisted chat, server-side AI proxy, safety redirects, private |
| De-stress Zone | `#/destress` | personnel | 12 generative ambient tracks (Web Audio, no copyrighted files), wind-down timer, videos |
| Buddy Connect | `#/buddy` | personnel | Voluntary pairing, chat, explicit sharing toggles (off by default) |
| Message From Home | `#/home` | personnel | Invite-code video messages, hide/delete, private by design |
| Medic Connection | `#/medic` | personnel, medic | Requests + private threads + **authorization-gated** wellness summary |
| Supervisor Connection | `#/supervisor` | personnel, supervisor | Workload concerns + threads; **no wellness route exists at all**; **Team Overview (aggregate-only) + Roster Fatigue Balancer** |
| Incident Reporting | `#/incidents` | personnel, supervisor, admin | Severity triage, context notes, resolution enforcement, full audit |
| Notifications | `#/notifications` | all | Engine with weekly digests, gentle reminders, dedup, kind filters |
| Offline & Transfers | `#/offline` | all | Status strip, authorized welfare reports, relay/WebRTC/simulated transports, pending queue + history, medic/supervisor inbox & review |
| Admin Panel | `#/admin` | admin | Users, broadcast, audit log, integration status, **intervention efficacy aggregates (min-sample guarded)** |

**327 automated smoke tests** (`VIGIL_TEST_BASE=http://127.0.0.1:8788 python3 server/smoke_test.py`, override the target with `VIGIL_TEST_BASE`) cover auth, RBAC, privacy boundaries (wellness never leaks to supervisors/buddies), the connected-insight engine, recovery explainability, consent sharing, the incident workflow, the grounded assistant, the offline transfer flow (role-filtered reports, relay sessions, recipient walls, idempotent sync), **the intelligence layer (forecast determinism, uncertainty, intervention loop, efficacy guards, supervisor aggregate-only projection, on-device anomaly sync),** validation, and every module's flow.

## Architecture

```
server/                   Python-stdlib backend (demo adapter of the Supabase contract)
  vigil_server.py         entrypoint · router · static hosting · security headers · rate limits
  security.py             PBKDF2 hashing · sessions · rate limiting · validation
  data_store.py           JSON persistence + concurrent access
  auth_api.py             /api/auth/* + /api/me · audit logging
  api_routes.py           dashboard, notifications, admin, users lookup
  insights.py             SIU engine: operational load, insights, score-change
                          explainability, timeline (deterministic, no AI)
  ai_grounding.py         assistant answers computed from the user's own data
  welfare_report.py       Authorized Welfare Report builder (role-filtered,
                          minimum-data; shared/not-shared declarations)
  transfer_api.py         offline relay (pairing sessions, encrypted envelopes,
                          store-and-forward) + idempotent central sync
  *_api.py                shifts · tasks · wellness · recovery · report · ai · media ·
                          buddy · home · medic · supervisor · incidents
  ai_provider.py          mock (default) + OpenAI/Anthropic adapters (env-selected)
  supabase_client.py      PostgREST wrapper + ping (live DB cutover)
  mailer.py               SMTP reset emails (in-app fallback in demo)
  notification_engine.py  weekly digests · gentle reminders · dedup
  wearable_provider.py    simulated (default) · vendor interface
  seed_data.py demo_data.py  demo users + 3 weeks of re-anchored time-series
  smoke_test.py           327 end-to-end checks

public/                   Frontend SPA (vanilla HTML/CSS/JS)
  index.html              app shell · skip link · meta/OG · favicon
  css/                    tokens · base · components · layout · auth · pages
  js/
    app.js                bootstrap · router · RBAC guards · offline banner
    api.js                fetch wrapper (integrations map → live base)
    offline.js            IndexedDB stores · device crypto identity · sync
                          queue · store-and-forward · status engine
    transfer.js           CommunicationService: LocalWiFi · WebRTC ·
                          labelled demo transports + AES-GCM seal/open
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

Offline transfer adds: role-filtered report payloads (minimum data), AES-GCM-256 sealing with a human-verified pairing code (the relay stores ciphertext only), recipient-binding on every push, session expiry, transfer audit events (`transfer.session_created/joined/closed`, `transfer.report_sent/received/reviewed`, `offline.sync`), and admin-as-auditor (admins are never recipients).
