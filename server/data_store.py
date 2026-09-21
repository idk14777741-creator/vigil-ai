"""Demo-mode data store — a single JSON document with indexed collections.

Mirrors the Supabase table names one-to-one so the live adapter can swap in.
"""
from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime, timezone

import config
import db_json

_lock = threading.RLock()
_PATH = None
_DB = None

_EMPTY = {
    "meta": {},
    "profiles": [],
    "units": [],
    "unit_members": [],
    "notifications": [],
    "audit_logs": [],
    "password_resets": [],
    "system_config": {},
    # Phase 2+ demo collections (mirror the Supabase schema 1:1)
    "shifts": [],
    "tasks": [],
    "wellness_data": [],
    "recovery_scores": [],
    "medic_requests": [],
    "supervisor_requests": [],
    "weekly_reports": [],
    "ai_conversations": [],
    "ai_messages": [],
    "music_tracks": [],
    "music_history": [],
    "destress_videos": [],
    "buddy_connections": [],
    "buddy_messages": [],
    "support_contacts": [],
    "support_videos": [],
    "medic_request_messages": [],
    "wellness_authorizations": [],
    "supervisor_request_messages": [],
    "incidents": [],
    "incident_updates": [],
    # Offline-first welfare transfer (SIH offline phases 4–8) — mirrors the
    # planned Supabase tables 1:1. Envelope payloads are ALWAYS ciphertext.
    "transfer_sessions": [],
    "transfer_envelopes": [],
    "offline_sync_log": [],
    # Intelligence & privacy phase — closed loop tables (Supabase names 1:1).
    # fatigue_forecasts are computed on demand (deterministic) so only
    # anomaly_events / interventions / wellbeing / roster scenarios persist.
    "anomaly_events": [],
    "intervention_events": [],
    "intervention_followups": [],
    "wellbeing_checkins": [],
    "roster_scenarios": [],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _path() -> str:
    global _PATH
    if _PATH is None:
        _PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), config.DATA_DIR, "vigil_demo.json")
    return _PATH


def init() -> None:
    global _DB
    with _lock:
        _DB = db_json.load(_path(), _EMPTY)
        for key, default in _EMPTY.items():
            _DB.setdefault(key, default)


def reset() -> None:
    """Wipe back to an empty store and re-seed (demo mode convenience)."""
    global _DB
    with _lock:
        _DB = {key: ({} if key in ("meta", "system_config") else []) for key in _EMPTY}
        save()


def save() -> None:
    with _lock:
        db_json.save(_path(), _DB)


def db() -> dict:
    return _DB


def insert(table: str, row: dict) -> dict:
    with _lock:
        _DB[table].append(row)
        save()
    try:
        import live_bridge
        live_bridge.insert_row(table, row)
    except Exception:
        pass
    return row


def find(table: str, predicate) -> list:
    with _lock:
        return [row for row in _DB.get(table, []) if predicate(row)]


def find_one(table: str, predicate):
    with _lock:
        for row in _DB.get(table, []):
            if predicate(row):
                return row
        return None


def update(table: str, predicate, patch: dict) -> int:
    with _lock:
        count = 0
        matched_id = None
        for row in _DB.get(table, []):
            if predicate(row):
                row.update(patch)
                if matched_id is None:
                    matched_id = row.get("id")
                count += 1
        if count:
            save()
    if count:
        try:
            import live_bridge
            live_bridge.update_rows(table, "id", matched_id, patch)
        except Exception:
            pass
    return count


def all_rows(table: str) -> list:
    with _lock:
        return list(_DB.get(table, []))


def audit(actor_id: str | None, action: str, target: str = "", detail: dict | None = None, ip: str = "") -> None:
    """Append-only audit trail. Never throws — audit must not break requests."""
    try:
        entry = {
            "id": new_id("aud"),
            "actor_id": actor_id,
            "action": action,
            "target": target,
            "detail": detail or {},
            "ip": ip,
            "created_at": now_iso(),
        }
        with _lock:
            _DB["audit_logs"].append(entry)
            if len(_DB["audit_logs"]) > 5000:
                _DB["audit_logs"] = _DB["audit_logs"][-5000:]
            save()
    except Exception:
        pass
