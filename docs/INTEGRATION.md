# VIGIL AI — Live-mode integration guide (final phase)

**Do not put secrets in `public/`.** Everything in that folder ships to the browser.

## Adapter map

| Concern | Demo adapter (now) | Live adapter (final phase) |
|---|---|---|
| Auth | `server/auth_api.py` (cookie sessions) | Supabase Auth (email OTP + sessions) |
| Database | `server/data_store.py` (JSON store) | PostgreSQL via `supabase/schema.sql` + RLS `policies.sql` |
| AI | Mock provider (Phase 8) | LLM via server-side proxy (Edge Function / API route) |
| Wearables | Simulated generator (Phase 5) | Vendor SDK/API via `wellness_source` interface |
| Media | Local sample files | Supabase Storage private buckets |
| Notifications | In-app polling (Phase 15) | Supabase Realtime (or web push) |

## Rules

1. The client calls only relative `/api/*` endpoints. Point them at live bases via `window.VIGIL_INTEGRATIONS` — no other client change.
2. Secret keys live in environment variables on the server (`.env` never committed). Public anon keys are clearly distinguished and safe for the client.
3. Every live adapter must keep the demo adapter importable for fallback (`VIGIL_MODE=demo`).

## Credential checklist (final phase — do NOT add before then)

| Service | Purpose | Features | SIH demo needed? | Storage | Server-side? |
|---|---|---|---|---|---|
| Supabase URL + anon key | DB/auth/storage | All live features | Optional (demo works without) | Client-safe env | Anon key: no · service key: **yes** |
| Supabase service key | Admin ops | Live RLS operations | No | `.env` | **Yes** |
| LLM provider key | AI assistant | Phase 8 | No (mock provider) | `.env` | **Yes** |
| Wearable provider | Wellness data | Phase 5 | No (simulated) | `.env` | **Yes** |
| Music/media provider | De-stress Zone | Phase 9 | No (sample audio) | `.env` | **Yes** |
| Email service | Password reset mail | Auth flows | No (demo returns link in-app) | `.env` | **Yes** |

## Adapter status (v0.16.2) — cutover seam in place

All five categories now have server-side adapters. Adding a key is an env
change, not a code change. Check readiness at **Admin → Overview →
Integrations** (shows status, never values):

| Category | Adapter | Selected by | Status |
|---|---|---|---|
| Supabase | `server/supabase_client.py` (PostgREST wrapper + ping) | `SUPABASE_URL` + keys | Ready for keys |
| LLM | `server/ai_provider.py` — `OpenAIProvider`, `AnthropicProvider` | `VIGIL_AI_PROVIDER` + `VIGIL_AI_API_KEY` | Ready for keys (mock default) |
| Wearables | `server/wearable_provider.py` interface | `VIGIL_WEARABLE_*` | Vendor adapter pending |
| Media | storage switch in config | `VIGIL_MEDIA_STORAGE` | local default |
| Email | `server/mailer.py` (SMTP via stdlib) | `VIGIL_SMTP_*` | Ready for keys (in-app fallback) |

Copy `.env.example` → `.env` and fill in the categories you have. Restart
the server; the admin panel flips each category to **Ready** as its env
vars appear. Nothing changes in demo mode until `VIGIL_MODE=live`.

## The cutover seam (v0.16.2)

Three modules complete the live path — all inert until `VIGIL_MODE=live`:

| Module | Role |
|---|---|
| `server/live_auth.py` | Sign-in verifies against Supabase GoTrue, bridges to the local opaque session; profiles auto-provision on first login (`auth_user_id`) |
| `server/live_bridge.py` | Mirrors every `data_store.insert/update` to Postgres (service key); any live error falls back to the demo store — the cloud can never take the app down |
| `server/deploy.py` | Deployment launcher: loads `.env`, prints a readiness summary (`--check`), starts the server |

Cutting over becomes: set env vars → `python3 server/deploy.py --check`
→ start. Reads still come from the mirrored store, so RLS rollout can
happen gradually (table by table via `supabase_client`) without a flag day.
