"""Recovery Score service for VIGIL AI — Phase 6.

The scoring formula lives in demo_data.recovery_from (shared with the
dashboard so every surface agrees). This module adds the page-level view:
history, trend framing, factor drill-down for a chosen day, and
"what would help" suggestions.

Transparency rules:
  - The formula and weights are shown to the user verbatim.
  - Every factor displays its points out of its maximum and the raw inputs.
  - Suggestions are supportive and concrete, never judgmental.
  - This is a wellness indicator, never a medical assessment.
"""
from __future__ import annotations

import data_store

FORMULA = {
    "sleep": {"max": 30, "desc": "7h target — closer is better"},
    "rest": {"max": 25, "desc": "12h since your last shift ended"},
    "shift_load": {"max": 25, "desc": "up to 40h a week scores full"},
    "activity": {"max": 10, "desc": "8k steps a day scores full"},
    "stress": {"max": 10, "desc": "lower self-reported stress scores higher"},
}

FACTOR_LABELS = {
    "sleep": "Sleep",
    "rest": "Rest since last shift",
    "shift_load": "Weekly shift load",
    "activity": "Activity",
    "stress": "Self-reported stress",
}


def compute(uid: str) -> dict:
    rows = sorted(data_store.find("recovery_scores", lambda r: r["user_id"] == uid),
                  key=lambda r: r["computed_at"])
    if not rows:
        return {"has_data": False,
                "message": "Your first Recovery Score arrives after a day of shifts and rest.",
                "demo": True}

    latest = rows[-1]
    prev = rows[-2] if len(rows) > 1 else None
    week = rows[-8:-1]
    week_avg = round(sum(r["score"] for r in week) / len(week)) if week else None

    history = [{
        "date": r["computed_at"][:10],
        "score": r["score"],
    } for r in rows[-14:]]

    return {
        "has_data": True,
        "latest": _row_view(latest),
        "previous_score": prev["score"] if prev else None,
        "week_avg": week_avg,
        "history": history,
        "trend_message": _trend_message(latest["score"], prev["score"] if prev else None, week_avg),
        "suggestions": _suggestions(latest),
        "formula": FORMULA,
        "demo": True,
    }


def _row_view(r) -> dict:
    factors = []
    inputs = (r.get("factors") or {}).get("inputs", {})
    for key in ("sleep", "rest", "shift_load", "activity", "stress"):
        factors.append({
            "key": key,
            "label": FACTOR_LABELS[key],
            "points": (r.get("factors") or {}).get(key, 0),
            "max": FORMULA[key]["max"],
            "desc": FORMULA[key]["desc"],
            "input": _input_label(key, inputs),
        })
    return {
        "score": r["score"],
        "computed_at": r["computed_at"],
        "explanation": r.get("explanation", ""),
        "factors": factors,
    }


def _input_label(key, inputs):
    if key == "sleep":
        mins = inputs.get("sleep_minutes") or 0
        return f"{int(mins // 60)}h {int(mins % 60)}m slept"
    if key == "rest":
        h = inputs.get("rest_hours")
        return f"{h}h since last shift ended" if h is not None else "—"
    if key == "shift_load":
        h = inputs.get("week_hours")
        return f"{h}h this week" if h is not None else "—"
    if key == "activity":
        return f"{(inputs.get('steps') or 0):,} steps"
    if key == "stress":
        v = inputs.get("stress")
        return f"rated {v} of 5" if v is not None else "—"
    return "—"


def _trend_message(score, prev, week_avg):
    base = f"Your recovery is {score} out of 100."
    parts = [base]
    if prev is not None:
        diff = score - prev
        if diff >= 3:
            parts.append(f"That's up {diff} from yesterday — nice.")
        elif diff <= -3:
            parts.append(f"That's down {abs(diff)} from yesterday. A quieter day helps when you can take one.")
        else:
            parts.append("Steady compared to yesterday.")
    if week_avg is not None:
        parts.append(f"Your weekly average is around {week_avg}.")
    return " ".join(parts)


def _suggestions(latest_row) -> list:
    """Up to 3 concrete, kind suggestions based on the weakest factors."""
    factors = (latest_row.get("factors") or {})
    inputs = factors.get("inputs", {})
    out = []
    if factors.get("sleep", 30) < 21:
        out.append({
            "icon": "☾", "title": "Protect one full night of sleep",
            "message": "Even one earlier night lifts the sleep factor — usually the biggest lever in your score.",
        })
    if factors.get("rest", 25) < 17:
        out.append({
            "icon": "◐", "title": "Take a proper break after your next shift",
            "message": "Short turnarounds between shifts drag rest down. A longer gap restores it quickly.",
        })
    if factors.get("shift_load", 25) < 18:
        out.append({
            "icon": "⚑", "title": "Talk to your supervisor about load",
            "message": "This week ran heavier than the full-score mark. A conversation about next week's rota can rebalance things.",
        })
    if factors.get("activity", 10) < 6:
        out.append({
            "icon": "◎", "title": "Add a gentle walk",
            "message": "Light movement supports recovery — no need for anything intense.",
        })
    if factors.get("stress", 10) < 6:
        out.append({
            "icon": "✦", "title": "Try a short de-stress session",
            "message": "Ten minutes in the De-stress Zone helps many people reset. Your Medic Officer can also help.",
        })
    if not out:
        out.append({
            "icon": "✓", "title": "Keep your rhythm going",
            "message": "Your factors look balanced this week. Consistency is what keeps recovery high.",
        })
    return out[:3]
