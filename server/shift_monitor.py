"""Shift monitoring for VIGIL AI — Phase 3.

Computes a supportive, non-alarming view of a person's shifts:
current status, upcoming and recent shifts, weekly statistics, and
gentle flags for extended duty, short rest, and consecutive shifts.

The framing is workload *awareness*, never discipline: language stays
warm and supportive, and every flag suggests a concrete next step.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import data_store


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


def _day_start(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _hours_between(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 3600.0


def compute(uid: str, now: datetime | None = None) -> dict:
    """Build the full Shift Monitor payload for one user."""
    now = now or datetime.now()
    shifts = data_store.find("shifts", lambda s: s["user_id"] == uid)
    shifts.sort(key=lambda s: s["start_at"])

    duty = [s for s in shifts if s["shift_type"] == "duty"]
    now_iso = now.isoformat(timespec="seconds")

    active = next((s for s in duty if s["start_at"] <= now_iso < s["end_at"]), None)
    upcoming = [s for s in duty if s["start_at"] > now_iso][:6]
    past = [s for s in duty if s["end_at"] <= now_iso][-21:]  # recent history, chronological

    return {
        "status": _status(active, upcoming, past, now),
        "flags": _flags(duty, active, now),
        "weekly": _weekly(duty, now),
        "upcoming": upcoming,
        "history": list(reversed(past[-14:])),  # newest first for display
        "demo": True,
    }


# ---------- status ----------

def _status(active, upcoming, past, now) -> dict:
    if active:
        end = _parse(active["end_at"])
        total_min = int(_hours_between(_parse(active["start_at"]), end) * 60)
        elapsed_min = int(_hours_between(_parse(active["start_at"]), now) * 60)
        return {
            "kind": "active",
            "shift": active,
            "progress_pct": min(100, round(elapsed_min / max(1, total_min) * 100)),
            "hours_done": round(elapsed_min / 60, 1),
            "hours_left": round((total_min - elapsed_min) / 60, 1),
            "message": "You're on shift now. Breaks are part of the plan — take them when you can.",
        }
    if upcoming:
        nxt = upcoming[0]
        start = _parse(nxt["start_at"])
        hours_away = _hours_between(now, start)
        when = "tomorrow" if _day_start(start) > _day_start(now) else start.strftime("%A")
        if hours_away < 1:
            lead = f"starting in about {max(1, int(hours_away * 60))} minutes"
        elif hours_away < 24:
            lead = f"starting in about {int(hours_away)} hours"
        else:
            lead = f"starting {when}"
        return {
            "kind": "upcoming",
            "shift": nxt,
            "hours_away": round(hours_away, 1),
            "lead": lead,
            "message": f"Your next shift is {lead}. Rest well beforehand — it counts as part of the job.",
        }
    if past:
        last = past[-1]
        return {
            "kind": "off",
            "last_shift": last,
            "since_hours": round(_hours_between(_parse(last["end_at"]), now), 1),
            "message": "You're off shift. However your day goes, that's okay.",
        }
    return {"kind": "empty", "message": "No shifts scheduled yet. Your supervisor arranges these."}


# ---------- flags ----------

def _flags(duty, active, now) -> list:
    """Supportive observations. Empty list = nothing to flag."""
    flags = []

    # 1. Extended duty — any shift > 12h (in progress or in recent history)
    recent = duty[-10:]
    for s in recent:
        dur = _hours_between(_parse(s["start_at"]), _parse(s["end_at"]))
        if dur > 12:
            ongoing = active and s["id"] == active["id"]
            flags.append({
                "kind": "extended_duty",
                "tone": "warning",
                "shift_id": s["id"],
                "hours": round(dur, 1),
                "title": "Extended duty",
                "message": (f"You've been on shift about {round(dur)} hours. "
                            "Consider handing over when you can, and take a proper break afterwards."),
                "when": "now" if ongoing else "recent",
            })
            break  # one is enough

    # 2. Insufficient rest — < 8h between yesterday's end and today's start
    pairs = list(zip(duty, duty[1:]))
    for prev, curr in pairs:
        if _parse(curr["start_at"]) > now:  # only flag pairs already underway
            continue
        gap_h = _hours_between(_parse(prev["end_at"]), _parse(curr["start_at"]))
        if 0 <= gap_h < 8:
            flags.append({
                "kind": "insufficient_rest",
                "tone": "warning",
                "shift_id": curr["id"],
                "hours": round(gap_h, 1),
                "title": "Short rest between shifts",
                "message": (f"There were about {round(gap_h)} hours between your last two shifts. "
                            "Short turnarounds add up — a longer rest is coming up soon if you can."),
                "when": _parse(curr["start_at"]).strftime("%A"),
            })
            break

    # 3. Consecutive duty days (>= 5 in a row, ending today or later)
    by_day = {}
    for s in duty:
        day = _day_start(_parse(s["start_at"])).date()
        by_day[day] = True
    streak = 0
    check_day = _day_start(now).date()
    while True:
        if by_day.get(check_day):
            streak += 1
            check_day -= timedelta(days=1)
        else:
            break
    if streak >= 5:
        flags.append({
            "kind": "consecutive_days",
            "tone": "info",
            "days": streak,
            "title": "Several shifts in a row",
            "message": (f"You've had {streak} shifts in a row. "
                        "A full day off soon will help you recharge."),
            "when": "streak",
        })

    # 4. Night shift coming up — gentle heads-up, not a warning
    if active is None:
        upcoming = [s for s in duty if s["start_at"] > now.isoformat(timespec="seconds")]
        if upcoming:
            start_h = _parse(upcoming[0]["start_at"]).hour
            if start_h >= 20 or start_h < 5:
                flags.append({
                    "kind": "night_shift",
                    "tone": "info",
                    "shift_id": upcoming[0]["id"],
                    "title": "Night shift ahead",
                    "message": "You have a night shift coming up. Daytime rest beforehand genuinely helps.",
                    "when": _parse(upcoming[0]["start_at"]).strftime("%A"),
                })

    return flags


# ---------- weekly stats ----------

def _weekly(duty, now) -> dict:
    """Current ISO week (Mon–Sun) plus the previous one."""
    def week_bounds(anchor: datetime):
        start = _day_start(anchor) - timedelta(days=anchor.weekday())
        return start, start + timedelta(days=7)

    def summarise(start: datetime, end: datetime):
        in_week = [s for s in duty if start <= _parse(s["start_at"]) < end]
        hours = sum(_hours_between(_parse(s["start_at"]), _parse(s["end_at"])) for s in in_week)
        breaks = sum(s.get("break_minutes") or 0 for s in in_week)
        longest = max((_hours_between(_parse(s["start_at"]), _parse(s["end_at"])) for s in in_week), default=0.0)
        return {
            "shifts": len(in_week),
            "hours": round(hours, 1),
            "break_minutes": breaks,
            "longest_shift_h": round(longest, 1),
            "label": f"Week of {start.strftime('%d %b')}",
        }

    this_start, this_end = week_bounds(now)
    prev_start = this_start - timedelta(days=7)
    cur = summarise(this_start, this_end)
    prev = summarise(prev_start, this_start)
    return {
        "this": cur,
        "previous": prev,
        "hours_trend": round(cur["hours"] - prev["hours"], 1),
        "message": (f"That's {cur['hours']} hours across {cur['shifts']} shifts this week."
                    if cur["shifts"] else "No shifts recorded for this week yet."),
    }
