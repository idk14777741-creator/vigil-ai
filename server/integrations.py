"""Integration status registry for VIGIL AI.

One place that knows which live services are configured. Never logs or
returns secret values — only "configured" / "not configured" plus the
public, client-safe values (Supabase URL + anon key).
"""
from __future__ import annotations

import urllib.request

import config


def _bool(value: str) -> bool:
    return bool(value and value.strip())


def status() -> dict:
    """Category-by-category readiness. Secrets are never included."""
    i = config.INTEGRATIONS
    supabase = _bool(i["supabase_url"]) and _bool(i["supabase_anon_key"])
    return {
        "mode": config.MODE,
        "categories": {
            "supabase": {
                "label": "Supabase (database, auth, storage)",
                "configured": supabase and _bool(i["supabase_service_key"]),
                "url": i["supabase_url"] or None,
                "anon_key_set": _bool(i["supabase_anon_key"]),
                "service_key_set": _bool(i["supabase_service_key"]),
                "env": ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"],
            },
            "ai": {
                "label": "LLM provider (VIGIL AI Assistant)",
                "configured": i["ai_provider"] != "mock" and _bool(i["ai_api_key"]),
                "provider": i["ai_provider"],
                "model": i["ai_model"],
                "env": ["VIGIL_AI_PROVIDER", "VIGIL_AI_API_KEY", "VIGIL_AI_MODEL"],
            },
            "wearables": {
                "label": "Wearable data provider",
                "configured": i["wearable_provider"] != "simulated" and _bool(i["wearable_api_key"]),
                "provider": i["wearable_provider"],
                "env": ["VIGIL_WEARABLE_PROVIDER", "VIGIL_WEARABLE_API_KEY"],
            },
            "media": {
                "label": "Media storage (De-stress Zone, Message From Home)",
                "configured": i["media_storage"] != "local",
                "storage": i["media_storage"],
                "env": ["VIGIL_MEDIA_STORAGE"],
            },
            "email": {
                "label": "Email (password resets)",
                "configured": _bool(i["smtp_host"]) and _bool(i["smtp_user"]),
                "host": i["smtp_host"] or None,
                "from": i["smtp_from"],
                "env": ["VIGIL_SMTP_HOST", "VIGIL_SMTP_PORT", "VIGIL_SMTP_USER", "VIGIL_SMTP_PASSWORD", "VIGIL_SMTP_FROM"],
            },
        },
    }


def client_safe_config() -> dict:
    """Values the browser may see. Everything secret stays server-side."""
    i = config.INTEGRATIONS
    return {
        "mode": config.MODE,
        "supabaseUrl": i["supabase_url"] if config.MODE == "live" else "",
        "supabaseAnonKey": i["supabase_anon_key"] if config.MODE == "live" else "",
    }


def ping_supabase() -> dict:
    """Cheap REST reachability probe. Returns {ok, detail} — no secrets."""
    i = config.INTEGRATIONS
    if not (_bool(i["supabase_url"]) and _bool(i["supabase_anon_key"])):
        return {"ok": False, "detail": "not configured"}
    try:
        req = urllib.request.Request(i["supabase_url"].rstrip("/") + "/auth/v1/health",
                                     headers={"apikey": i["supabase_anon_key"]})
        with urllib.request.urlopen(req, timeout=5) as res:
            return {"ok": res.status == 200, "detail": f"HTTP {res.status}"}
    except Exception as exc:
        return {"ok": False, "detail": type(exc).__name__}
