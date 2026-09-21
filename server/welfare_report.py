"""Authorized Welfare Report builder — offline-first welfare transfer.

Before ANY device-to-device transfer, VIGIL AI reduces the person's data to
exactly what the receiving role is authorized to see — nothing else.

  Entire database      ❌  unnecessary exposure
  Authorized report    ✅  minimum required information

The medic payload is the only rich one, and it mirrors the existing
medic-api wellness contract (7-day averages, no raw feeds, no chat
history, no AI conversations, nothing from home). Supervisors get
aggregate operational-wellness only. Admins are never a transfer
recipient — they audit transfers, they don't receive welfare data.

Every builder returns:
  payload       — the report (safe to send through any transport)
  shared        — human-readable list of what IS being shared
  not_shared    — human-readable list of what is NOT being shared
  payload_hash  — sha256 over the payload (transfer integrity + dedupe)

Non-diagnostic language everywhere. Simulated data is labelled in the
UI; these payloads carry `source: "simulated"` so it stays honest in
transit too.
"""
from __future__ import annotations

import hashlib
import json

import data_store

SIMULATED = "simulated"


def _digest(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def _shift_hours(uid: str, days: int = 7) -> float:
    """Hours from start/end timestamps for shifts starting in the last `days`."""
    from datetime import datetime, timedelta
    now = datetime.now()
    cutoff = now - timedelta(days=days)
    rows = data_store.find("shifts", lambda s: s["user_id"] == uid)
    out = 0.0
    for s in rows:
        try:
            start = datetime.fromisoformat(s.get("start_at", ""))
            if start < cutoff or start > now:  # elapsed shifts only — no future roster
                continue
            end = datetime.fromisoformat(s.get("end_at") or s.get("start_at", ""))
            hours = (end - start).total_seconds() / 3600.0
            if 0 < hours <= 24:
                out += hours
        except ValueError:
            continue
    return round(out, 1)


def _week_rows(table: str, uid: str, days: int = 7) -> list:
    """Most recent `days` rows for a user, oldest first (simulated data)."""
    rows = data_store.find(table, lambda r: r["user_id"] == uid)
    rows.sort(key=lambda r: r.get("date") or r.get("computed_at") or "")
    return rows[-days:]


def _latest_recovery(uid: str) -> dict | None:
    rows = _week_rows("recovery_scores", uid)
    return rows[-1] if rows else None


def _avg(values: list) -> float | None:
    vals = [v for v in values if isinstance(v, (int, float))]
    return round(sum(vals) / len(vals), 1) if vals else None


def build_for_medic(person: dict) -> dict:
    """Full authorized welfare report — medic recipients only."""
    uid = person["id"]
    recovery = _latest_recovery(uid)
    wellness = _week_rows("wellness_data", uid)
    sleep_min = _avg([w.get("sleep_minutes") for w in wellness])

    # HR/HRV trends are expressed as a direction over the week (trend, not
    # a raw clinical feed) — matching the medic-api wellness summary.
    def _trend(values: list) -> str:
        vals = [v for v in values if isinstance(v, (int, float))]
        if len(vals) < 3:
            return "insufficient data"
        first, last = sum(vals[: len(vals) // 2]) / (len(vals) // 2), sum(vals[len(vals) // 2 :]) / (len(vals) - len(vals) // 2)
        delta = (last - first) / first if first else 0
        if delta < -0.05:
            return "decreasing"
        if delta > 0.05:
            return "increasing"
        return "stable"

    hrs = [w.get("heart_rate") for w in wellness]
    hrvs = [w.get("hrv_ms") for w in wellness]
    week_hours = _shift_hours(uid)
    open_tasks = len(data_store.find("tasks", lambda t: t["assignee_id"] == uid and t.get("status") != "done"))

    payload = {
        "report_type": "authorized_welfare_report",
        "recipient_role": "medic",
        "personnel_id": person.get("employee_code") or uid,
        "personnel_name": person.get("full_name", ""),
        "recovery_score": recovery["score"] if recovery else None,
        "risk_level": _risk(recovery["score"]) if recovery else "unknown",
        "recovery_factors": (recovery or {}).get("factors", {}),
        "heart_rate_trend": _trend(hrs),
        "hrv_trend": _trend(hrvs),
        "sleep_summary": {"avg_hours": round(sleep_min / 60, 1) if sleep_min else None, "nights": len(wellness)},
        "duty_summary": {"week_hours": week_hours, "open_tasks": open_tasks},
        "contributing_factors": recovery.get("explanation", "") if recovery else "",
        "recommended_action": _recommend(recovery, sleep_min),
        "source": SIMULATED,
        "generated_at": data_store.now_iso(),
    }
    return {
        "payload": payload,
        "shared": [
            "Recovery Score + risk level",
            "Heart rate & HRV 7-day trends (direction only)",
            "Sleep summary (7-night average)",
            "Duty & workload summary",
            "Contributing factors",
            "Recommended next step",
        ],
        "not_shared": [
            "Raw biometric feeds",
            "Private conversations (AI assistant, buddy, medic threads)",
            "Incident reports",
            "Message From Home content",
            "Anything beyond the 7-day window",
        ],
        "payload_hash": _digest(payload),
    }


def build_for_supervisor(person: dict) -> dict:
    """Aggregate operational-wellness only — no raw biometrics."""
    uid = person["id"]
    recovery = _latest_recovery(uid)
    week_hours = _shift_hours(uid)
    open_tasks = len(data_store.find("tasks", lambda t: t["assignee_id"] == uid and t.get("status") != "done"))
    payload = {
        "report_type": "authorized_welfare_report",
        "recipient_role": "supervisor",
        "personnel_id": person.get("employee_code") or uid,
        "personnel_name": person.get("full_name", ""),
        "recovery_band": _band(recovery["score"] if recovery else None),
        "week_hours": week_hours,
        "open_tasks": open_tasks,
        "source": SIMULATED,
        "generated_at": data_store.now_iso(),
    }
    return {
        "payload": payload,
        "shared": ["Recovery band (not the exact score)", "Weekly duty hours", "Open task count"],
        "not_shared": ["Any biometric data", "Exact recovery score", "Sleep details", "Anything medical"],
        "payload_hash": _digest(payload),
    }


def build_allowed_roles() -> list:
    """Recipient roles a personnel user may choose from."""
    return ["medic", "supervisor"]


def builder_for_role(role: str):
    if role == "medic":
        return build_for_medic
    if role == "supervisor":
        return build_for_supervisor
    return None


def _band(score) -> str:
    if score is None:
        return "unknown"
    if score >= 75:
        return "steady"
    if score >= 55:
        return "attention"
    return "stressed"


def _risk(score) -> str:
    """Deterministic risk vocabulary for reports — derived from the score,
    never a clinical assessment."""
    return _band(score)


def _recommend(recovery, sleep_min) -> str:
    if not recovery:
        return "No recent wellness data — check in with them directly."
    score = recovery["score"]
    if score >= 75:
        return "No action needed — steady week."
    if sleep_min and sleep_min < 6 * 60:
        return "Encourage rest prioritization; sleep is below their baseline."
    if score < 55:
        return "Suggest a low-strain check-in this week."
    return "Gentle check-in; nothing urgent."
