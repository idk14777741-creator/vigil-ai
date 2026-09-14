"""Live-data bridge for VIGIL AI.

When Supabase is fully configured (URL + anon + service keys), this module
mirrors the demo store's write paths to Postgres and can serve reads from
it. Every live call is wrapped: on any error the demo store continues to
answer, so a misconfigured cloud never takes the app down.

This is the seam the final cutover tightens — same interface, no UI change.
"""
from __future__ import annotations

import json

import config


def live_enabled() -> bool:
    """True only when VIGIL_MODE=live and Supabase is fully configured."""
    if config.MODE != "live":
        return False
    try:
        import supabase_client
        return supabase_client.configured()
    except Exception:
        return False


def insert_row(table: str, row: dict) -> dict:
    """Best-effort mirror of an insert into Postgres. Never raises."""
    if not live_enabled():
        return row
    try:
        import supabase_client
        c = supabase_client.client()
        url = f"{c.base}/rest/v1/{table}"
        body = json.dumps(_strip_local(row)).encode()
        import urllib.request
        req = urllib.request.Request(url, data=body, method="POST", headers={
            **c._headers(service=True),
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        })
        urllib.request.urlopen(req, timeout=8)
    except Exception as exc:
        print(f"[live-bridge] insert {table} failed: {type(exc).__name__}")
    return row


def update_rows(table: str, match_column: str, match_value, patch: dict) -> None:
    """Best-effort mirror of an update. Never raises."""
    if not live_enabled():
        return
    try:
        import urllib.parse
        import urllib.request
        import supabase_client
        c = supabase_client.client()
        url = f"{c.base}/rest/v1/{table}?{match_column}=eq.{urllib.parse.quote(str(match_value), safe='')}"
        req = urllib.request.Request(url, data=json.dumps(_strip_local(patch)).encode(), method="PATCH", headers={
            **c._headers(service=True),
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        })
        urllib.request.urlopen(req, timeout=8)
    except Exception as exc:
        print(f"[live-bridge] update {table} failed: {type(exc).__name__}")


def fetch_rows(table: str, match_column: str | None = None, match_value=None, limit: int = 200) -> list | None:
    """Read rows from Postgres; None means 'fall back to the demo store'."""
    if not live_enabled():
        return None
    try:
        import supabase_client
        c = supabase_client.client()
        q = c.from_(table, service=True).limit(limit)
        if match_column is not None:
            q = q.eq(match_column, match_value)
        result = q.execute()
        if result.get("error"):
            return None
        return result.get("data") or []
    except Exception as exc:
        print(f"[live-bridge] fetch {table} failed: {type(exc).__name__}")
        return None


def _strip_local(row: dict) -> dict:
    """Remove demo-store-only fields before sending to Postgres."""
    return {k: v for k, v in row.items() if k not in ("password_hash",) and v is not None}
