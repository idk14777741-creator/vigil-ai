# VIGIL AI — Permanent Cloud Deployment

The app is a **single Python-stdlib process + static files**: no build step, no
dependencies, ~15 MB image. Any container platform runs it unchanged.

**Entrypoint:** `python3 server/deploy.py` — loads `.env` (optional), validates
configuration, starts the server on `0.0.0.0:$PORT`.

Demo mode needs **zero configuration** — deploy as-is and log in with the demo
accounts. Live mode is activated later by adding secrets (see bottom).

---

## Option A — Fly.io (recommended: fixed URL, scale-to-zero)

```bash
# 1. Install the CLI (once):  brew install flyctl   (or curl -L https://fly.io/install.sh | sh)
# 2. From the project root:
fly launch --no-deploy          # picks up fly.toml; accept the app name or change it
fly volumes create vigil_data --size 1 --region bom   # persistent demo state
# uncomment the [mounts] block in fly.toml, then:
fly deploy
```

You get **`https://<app-name>.fly.dev`** — permanent, HTTPS, auto-start on first
request after idle (no cost while idle on free allowance).

Health checks hit `/api/health` (already wired in `fly.toml`).

## Option B — Render (one-click from GitHub)

1. Push this repo to GitHub
2. Render → **New → Blueprint** → select the repo — it reads `render.yaml`
3. Done: **`https://vigil-ai.onrender.com`** (free tier; spins down after 15 min
   idle, ~30 s wake on next visit)

## Option C — Any Docker host

```bash
docker build -t vigil-ai .
docker run -p 8787:8787 -v vigil_data:/app/data vigil-ai
```

Works on Railway, Northflank, Cloud Run, a VPS, etc. On Cloud Run:

```bash
gcloud run deploy vigil-ai --source . --allow-unauthenticated --port 8787
```

## Option D — Heroku-style (Procfile)

`git push heroku main` — the `Procfile` (`web: python3 server/deploy.py`) does
the rest; the platform's `PORT` is honored automatically.

---

## Data persistence

Demo state (accounts, tasks, chats) is a JSON file at `/app/data`. Without a
volume, a container restart reseeds a fresh demo story — usually exactly what
you want for a demo. With a volume (Fly: `vigil_data`), state survives deploys.

**Admin reset between demos:** Admin → Overview → **↺ Reset demo data**
(also resets sessions). No redeploy needed.

## Switching to live mode (after credentials)

```bash
# Fly:
fly secrets set VIGIL_MODE=live \
  SUPABASE_URL=https://xxx.supabase.co \
  SUPABASE_ANON_KEY=eyJ... \
  SUPABASE_SERVICE_KEY=eyJ... \
  VIGIL_AI_PROVIDER=openai VIGIL_AI_API_KEY=sk-...
fly deploy
```

Render: add the same keys in Dashboard → Environment, then redeploy.

Verify before exposing: `python3 server/deploy.py --check` locally with the
same `.env` prints the readiness summary (`ready: supabase, ai …`).

Secrets live only in the platform's secret store — never in the image, never
in `public/`, never in git.
