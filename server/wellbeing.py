"""Weekly Wellbeing Check-in + on-device anomaly events — intelligence phase 4/6 server side.

Two distinct concepts that must never blur:

1. WEEKLY WELLBEING CHECK-IN — a recurring self-reflection the person chooses
   to give (1–5 sliders). It answers "How is my wellbeing changing over time?"
   It is NOT a diagnosis, NOT a psychological instrument, NOT the Recovery
   Score. One entry per calendar week (upsert).

2. ANOMALY EVENTS — the minimal result of ON-DEVICE detection. The browser
   computes the anomaly from its local wellness cache; the server accepts
   ONLY a whitelisted minimal payload (status, confidence, timestamp, model).
   Raw biometrics sent to "do detection" are refused — that is the whole
   point of the privacy architecture (§5–6 of the intelligence spec).
"""
from __future__ import annotations

from datetime import datetime, timedelta

import data_store

# Check-in questions — plain self-reflection language, deliberately not a
# validated questionnaire. If a validated instrument is adopted later, its
# scoring and wording must replace this verbatim.
QUESTIONS = [
    {"key": "mood", "label": "How has your mood been this week?"},
    {"key": "energy", "label": "How is your energy overall?"},
    {"key": "sleep_quality", "label": "How well have you been sleeping?"},
    {"key": "coping", "label": "How well are you managing the demands right now?"},
    {"key": "connection", "label": "How connected do you feel to people around you?"},
]

ANOMALY_STATUSES = {
    "steady_pattern": "Steady pattern",
    "elevated_fatigue_pattern": "Elevated fatigue pattern",
    "reduced_recovery_pattern": "Reduced recovery pattern",
}
ANOMALY_MODELS = {"on_device_heuristic_v1"}  # only this client model is accepted


def _week_start(dt: datetime) -> str:
    monday = (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return monday.date().isoformat()


def _score(answers: dict) -> float:
    vals = [answers[q["key"]] for q in QUESTIONS if q["key"] in answers]
    avg = sum(vals) / len(vals)          # 1..5
    return round((avg - 1) / 4 * 100)    # 0..100


def submit_checkin(profile: dict, body: dict) -> tuple:
    answers = body.get("answers") or {}
    cleaned = {}
    for q in QUESTIONS:
        try:
            v = int(answers.get(q["key"]))
        except (TypeError, ValueError):
            return 400, {"error": "Every question needs a 1–5 answer."}
        if not 1 <= v <= 5:
            return 400, {"error": "Answers are 1 (low) to 5 (high)."}
        cleaned[q["key"]] = v
    if len(cleaned) != len(QUESTIONS):
        return 400, {"error": "Every question needs a 1–5 answer."}

    week = _week_start(datetime.now())
    existing = data_store.find_one("wellbeing_checkins",
                                   lambda c: c["user_id"] == profile["id"] and c["week_start"] == week)
    row = {
        "id": existing["id"] if existing else data_store.new_id("wbc"),
        "user_id": profile["id"],
        "week_start": week,
        "answers": cleaned,
        "score": _score(cleaned),
        "created_at": existing["created_at"] if existing else data_store.now_iso(),
        "updated_at": data_store.now_iso(),
    }
    if existing:
        data_store.update("wellbeing_checkins", lambda c: c["id"] == existing["id"], row)
    else:
        data_store.insert("wellbeing_checkins", row)
    data_store.audit(profile["id"], "wellbeing.checkin", detail={"week": week, "updated": bool(existing)})
    return 200, {"checkin": row, "trend": weekly_trend(profile["id"]),
                 "note": ("Self-reflection, not a diagnosis or psychological test. "
                          "Kept separate from your Recovery Score."),
                 "demo": True}


def weekly_trend(uid: str) -> dict:
    rows = sorted(data_store.find("wellbeing_checkins", lambda c: c["user_id"] == uid),
                  key=lambda c: c["week_start"])
    weeks = [{"week_start": c["week_start"], "score": c["score"],
              "answers": c.get("answers") or {}} for c in rows[-8:]]
    trend, message = "insufficient", "One more weekly check-in starts your trend."
    if len(rows) >= 3:
        # Trend = recent fortnight vs the opening fortnight — fairer than a
        # single week-over-week delta, which flips on one busy week.
        d = (sum(r["score"] for r in rows[-2:]) / 2.0
             - sum(r["score"] for r in rows[:2]) / 2.0)
        if d >= 5:
            trend, message = "improving", "Your weekly wellbeing has been trending up."
        elif d <= -5:
            trend, message = "declining", "Your weekly wellbeing has been trending down — support options are always available."
        else:
            trend, message = "steady", "Your weekly wellbeing has been steady."
    elif len(rows) == 2:
        trend, message = "building", "One more weekly check-in sharpens your trend."
    return {"weeks": weeks, "trend": trend, "message": message,
            "distinct_from_recovery": ("This is your own weekly self-reflection. Your Recovery Score is a "
                                       "separate daily measure built from sleep, rest, load and stress."),
            "demo": True}


def record_anomaly(profile: dict, body: dict) -> tuple:
    """Accept ONLY the minimal on-device result. Nothing else is stored."""
    status = body.get("status")
    if status not in ANOMALY_STATUSES:
        return 400, {"error": "Unknown anomaly status.",
                     "accepted": sorted(ANOMALY_STATUSES)}
    model = body.get("model")
    if model not in ANOMALY_MODELS:
        return 400, {"error": "Unknown on-device model."}
    try:
        confidence = round(float(body.get("confidence")), 2)
    except (TypeError, ValueError):
        return 400, {"error": "Confidence must be a number between 0 and 1."}
    if not 0 <= confidence <= 1:
        return 400, {"error": "Confidence must be a number between 0 and 1."}

    # Data minimization enforced server-side: only the fields below exist.
    row = {
        "id": data_store.new_id("ano"),
        "user_id": profile["id"],
        "status": status,
        "confidence": confidence,
        "model": model,
        "detected_at": data_store.now_iso(),
        "demo": True,
    }
    data_store.insert("anomaly_events", row)
    data_store.audit(profile["id"], "anomaly.recorded", detail={"status": status})
    return 200, {"event": row,
                 "note": ("Only the detection result was uploaded — your raw wellness "
                          "readings stay on this device."),
                 "demo": True}


def my_anomalies(uid: str) -> dict:
    rows = sorted(data_store.find("anomaly_events", lambda e: e["user_id"] == uid),
                  key=lambda e: e["detected_at"], reverse=True)[:10]
    return {"events": rows, "statuses": ANOMALY_STATUSES,
            "note": ("Detections are computed on your device from locally cached readings; "
                     "only the minimal result above is ever stored."),
            "demo": True}
