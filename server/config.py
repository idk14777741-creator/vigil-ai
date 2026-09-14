# VIGIL AI server configuration.
# All values may be overridden via environment variables. No secrets required in demo mode.
import os

APP_NAME = "VIGIL AI"
APP_VERSION = "0.16.5 (Integration Phase — resilience + print)"
HOST = os.environ.get("VIGIL_HOST", "127.0.0.1")
# VIGIL_PORT wins; else the platform-provided PORT (Render/Heroku); else 8787.
# Guarded: PORT=0 (seen in some sandbox shells) or garbage falls back to 8787.
_port_raw = os.environ.get("VIGIL_PORT") or os.environ.get("PORT") or ""
PORT = int(_port_raw) if _port_raw.isdigit() and int(_port_raw) > 0 else 8787
SESSION_TTL_HOURS = int(os.environ.get("VIGIL_SESSION_TTL_HOURS", "72"))
DATA_DIR = os.environ.get("VIGIL_DATA_DIR", "data")
SEED_DEMO = os.environ.get("VIGIL_SEED_DEMO", "1") == "1"
DEMO_ACCOUNTS = os.environ.get("VIGIL_DEMO_ACCOUNTS", "1") == "1"  # demo login quick-fills
MAX_BODY_BYTES = int(os.environ.get("VIGIL_MAX_BODY_BYTES", str(1024 * 1024)))
AUTH_RATE_LIMIT = int(os.environ.get("VIGIL_AUTH_RATE_LIMIT", "60"))  # per IP per minute

# Modes: "demo" (no external services) or "live" (final integration phase).
MODE = os.environ.get("VIGIL_MODE", "demo")

# Live-mode integration registry — read from environment only, never hardcoded.
# Demo mode ignores every value. See integrations.py for the status report
# and .env.example for the full variable list.
INTEGRATIONS = {
    # Category 1 — Supabase (database, auth, storage).
    "supabase_url": os.environ.get("SUPABASE_URL", ""),
    "supabase_anon_key": os.environ.get("SUPABASE_ANON_KEY", ""),        # client-safe
    "supabase_service_key": os.environ.get("SUPABASE_SERVICE_KEY", ""),  # SERVER ONLY
    # Category 2 — LLM provider for the VIGIL AI Assistant.
    "ai_provider": os.environ.get("VIGIL_AI_PROVIDER", "mock"),
    "ai_api_key": os.environ.get("VIGIL_AI_API_KEY", ""),                # SERVER ONLY
    "ai_model": os.environ.get("VIGIL_AI_MODEL", "gpt-4o-mini"),
    # Category 3 — Wearable data provider.
    "wearable_provider": os.environ.get("VIGIL_WEARABLE_PROVIDER", "simulated"),
    "wearable_api_key": os.environ.get("VIGIL_WEARABLE_API_KEY", ""),    # SERVER ONLY
    # Category 4 — Media storage (De-stress Zone + Message From Home).
    "media_storage": os.environ.get("VIGIL_MEDIA_STORAGE", "local"),
    # Category 5 — Email (password resets).
    "smtp_host": os.environ.get("VIGIL_SMTP_HOST", ""),
    "smtp_port": int(os.environ.get("VIGIL_SMTP_PORT", "587")),
    "smtp_user": os.environ.get("VIGIL_SMTP_USER", ""),
    "smtp_password": os.environ.get("VIGIL_SMTP_PASSWORD", ""),          # SERVER ONLY
    "smtp_from": os.environ.get("VIGIL_SMTP_FROM", "VIGIL AI <noreply@vigil.local>"),
}

# Demo-mode environment-specific settings live in the modules that use them
# (e.g. demo_data.STALE_AFTER_HOURS). Nothing here is secret.
