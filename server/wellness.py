"""Wellness monitoring for VIGIL AI — Phase 5.

Turns raw simulated readings into a calm, supportive picture: latest vitals,
7-day trends, sleep pattern, activity, and gentle non-diagnostic insights.

Hard rules:
  - No diagnosis, no medical claims, no thresholds that sound clinical.
  - Trends are described vs the person's own recent baseline, not vs
    population norms.
  - Anything unusual is framed as "worth noticing" with a supportive
    suggestion — and data is always labelled as simulated in demo mode.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import wearable_provider


def _parse(iso):
    return datetime.fromisoformat(iso)


def _avg(values):
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals)) if vals else None


def compute(uid: str, days: int = 14) -> dict:
    provider = wearable_provider.get_provider()
    rows = provider.daily(uid, days)

    if not rows:
        return {"has_data": False, "message": "No readings yet — your wellness view appears after your first day of data.", "demo": True}

    latest = rows[-1]
    prev_week = rows[:-1][-7:] if len(rows) > 1 else []
    baseline = {
        "hr": _avg([r.get("heart_rate") for r in prev_week]),
        "spo2": _avg([r.get("spo2") for r in prev_week]),
        "sleep": _avg([r.get("sleep_minutes") for r in prev_week]),
        "steps": _avg([r.get("steps") for r in prev_week]),
    }

    series = {
        "dates": [r["recorded_at"][:10] for r in rows],
        "heart_rate": [r.get("heart_rate") for r in rows],
        "hrv_ms": [r.get("hrv_ms") for r in rows],
        "spo2": [r.get("spo2") for r in rows],
        "sleep_hours": [round(r["sleep_minutes"] / 60.0, 1) if r.get("sleep_minutes") is not None else None for r in rows],
        "sleep_quality": [r.get("sleep_quality") for r in rows],
        "steps": [r.get("steps") for r in rows],
        "stress": [r.get("stress_self_report") for r in rows],
    }

    return {
        "has_data": True,
        "provider": provider.name,
        "source": latest.get("source", "simulated"),
        "latest": {
            "recorded_at": latest["recorded_at"],
            "heart_rate": latest.get("heart_rate"),
            "spo2": latest.get("spo2"),
            "sleep_minutes": latest.get("sleep_minutes"),
            "sleep_quality": latest.get("sleep_quality"),
            "steps": latest.get("steps"),
            "stress_self_report": latest.get("stress_self_report"),
        },
        "baseline_7d": baseline,
        "series": series,
        "sleep_pattern": _sleep_pattern(rows),
        "activity": _activity(rows),
        "insights": _insights(rows, baseline),
        "demo": True,
    }


# ---------- derived views ----------

def _sleep_pattern(rows):
    """Week-vs-previous comparison of sleep duration and quality."""
    recent = rows[-7:]
    prior = rows[-14:-7]
    def avg_min(rs):
        return _avg([r.get("sleep_minutes") for r in rs])
    def avg_q(rs):
        vals = [r.get("sleep_quality") for r in rs if r.get("sleep_quality") is not None]
        return round(sum(vals) / len(vals), 1) if vals else None
    cur_min, prior_min = avg_min(recent), avg_min(prior)
    diff = round((cur_min - prior_min) / 60.0, 1) if cur_min is not None and prior_min is not None else None
    return {
        "avg_minutes": cur_min,
        "avg_quality": avg_q(recent),
        "diff_hours_vs_prior_week": diff,
        "short_nights": len([r for r in recent if (r.get("sleep_minutes") or 0) < 360]),
        "message": _sleep_message(cur_min, diff),
    }


def _sleep_message(cur_min, diff):
    if cur_min is None:
        return "No sleep data yet."
    hours = int(cur_min // 60)
    mins = int(cur_min % 60)
    base = f"You're averaging about {hours}h {mins}m of sleep a night."
    if diff is None:
        return base
    if diff >= 0.5:
        return base + f" That's {abs(diff)}h more than the week before — good."
    if diff <= -0.5:
        return base + f" That's {abs(diff)}h less than the week before — an earlier night or two could help."
    return base + " Steady compared to last week."


def _activity(rows):
    recent = rows[-7:]
    steps = [r.get("steps") for r in recent if r.get("steps") is not None]
    avg_steps = round(sum(steps) / len(steps)) if steps else None
    return {
        "avg_steps": avg_steps,
        "active_days": len([s for s in steps if s >= 6000]),
        "message": (f"About {avg_steps:,} steps a day on average, with {len([s for s in steps if s >= 6000])} of the last 7 days above 6k."
                    if avg_steps is not None else "No activity data yet."),
    }


# ---------- insights ----------

def _insights(rows, baseline) -> list:
    """Supportive observations. Max 3. No medical claims, ever."""
    insights = []
    latest = rows[-1]
    recent = rows[-7:]

    # Sleep trend
    sleep_now = _avg([r.get("sleep_minutes") for r in recent])
    sleep_prior = _avg([r.get("sleep_minutes") for r in rows[-14:-7]])
    if sleep_now and sleep_prior:
        delta = sleep_now - sleep_prior
        if delta <= -40:
            insights.append({
                "tone": "info", "icon": "☾",
                "title": "Sleep trending down",
                "message": "You've been sleeping a bit less this week than last. Even one earlier night helps your recovery score.",
            })
        elif delta >= 40:
            insights.append({
                "tone": "positive", "icon": "✓",
                "title": "Sleep improving",
                "message": "You've been getting more rest than last week. Whatever you're doing — keep it up.",
            })

    # Short nights count
    short = [r for r in recent if (r.get("sleep_minutes") or 0) < 360]
    if len(short) >= 3:
        insights.append({
            "tone": "info", "icon": "☾",
            "title": "Several short nights",
            "message": f"{len(short)} of the last 7 nights were under 6 hours. Consider protecting one full night of rest when shifts allow.",
        })

    # Resting heart rate drift vs own baseline (supportive, non-clinical)
    hr_now = _avg([r.get("heart_rate") for r in recent])
    if hr_now and baseline["hr"]:
        drift = hr_now - baseline["hr"]
        if drift >= 5:
            insights.append({
                "tone": "info", "icon": "♡",
                "title": "Resting heart rate a little higher",
                "message": "Your recent readings sit a bit above your usual. Extra rest and hydration can help — and your Medic Officer can talk it through any time.",
            })
        elif drift <= -4:
            insights.append({
                "tone": "positive", "icon": "✓",
                "title": "Resting heart rate trending down",
                "message": "Your readings are a little below your recent usual — often a sign of good recovery.",
            })

    # Stress self-report
    stress = [r.get("stress_self_report") for r in recent if r.get("stress_self_report") is not None]
    if stress and _avg(stress) >= 3.5:
        insights.append({
            "tone": "info", "icon": "✦",
            "title": "Stress running higher",
            "message": "You've rated your stress above midpoint most days. The De-stress Zone and your support network are there when you want them.",
        })

    # Activity dip
    steps = [r.get("steps") for r in recent if r.get("steps") is not None]
    if len(steps) >= 5 and _avg(steps) < 4000:
        insights.append({
            "tone": "info", "icon": "◎",
            "title": "Movement is low this week",
            "message": "A short walk counts. If shifts have been intense, gentle movement helps recovery more than pushing hard.",
        })

    if not insights:
        insights.append({
            "tone": "positive", "icon": "✓",
            "title": "All steady",
            "message": "Nothing unusual in your recent patterns. Keep your routine going.",
        })
    return insights[:3]
