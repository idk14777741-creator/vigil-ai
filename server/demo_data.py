"""Demo data generator for VIGIL AI — Phase 2 (Dashboard).

Builds time-anchored demo collections so the dashboard always shows a living
workspace, no matter when the demo is started or restarted:

  shifts          — 3 weeks of history + today + 10 days ahead per personnel
  wellness_data   — 14 days of simulated daily readings (heart rate, SpO2, sleep…)
  recovery_scores — 14 days of transparent 0–100 scores with factor breakdowns

All of it is SIMULATED. Every response and screen labels it as demo data —
it must never present itself as real medical information.

Re-anchoring: rows are generated relative to the seed moment. On later server
starts, `refresh_if_stale()` regenerates these collections if the anchor is
older than STALE_AFTER_HOURS, and shifts user-authored rows (tasks, requests)
forward by the same gap so deadlines stay meaningful.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta

import data_store

STALE_AFTER_HOURS = 6
PERSONNEL_IDS = ["usr_priya", "usr_rohan", "usr_leila", "usr_aarav"]

# Per-user simulation profiles: (hr_range, spo2_range, sleep_range, quality_range,
# steps_range, stress_range, shift_pattern)
USER_PROFILES = {
    "usr_priya": {
        "hr": (57, 67), "spo2": (97, 99), "sleep": (395, 470), "quality": (3, 5),
        "steps": (6200, 11000), "stress": (2, 3),
        "pattern": "days",  # 06:00–14:00 weekdays
    },
    "usr_rohan": {
        "hr": (63, 79), "spo2": (96, 98), "sleep": (300, 395), "quality": (2, 4),
        "steps": (4500, 9000), "stress": (3, 5),
        "pattern": "days",  # + an extended 16h shift yesterday
    },
    "usr_leila": {
        "hr": (60, 73), "spo2": (96, 99), "sleep": (310, 430), "quality": (2, 4),
        "steps": (5200, 9500), "stress": (2, 4),
        "pattern": "nights",  # 22:00–06:00 incl. weekend pair
    },
    # SIH demo persona A: the steady contrast — normal load, healthy recovery.
    "usr_aarav": {
        "hr": (58, 68), "spo2": (97, 99), "sleep": (420, 500), "quality": (3, 5),
        "steps": (7000, 12000), "stress": (1, 2),
        "pattern": "days_steady",  # plain 8h weekday shifts, no extensions
    },
}


def _rng(*parts) -> random.Random:
    return random.Random("vigil-demo:" + ":".join(str(p) for p in parts))


def _local_iso(dt: datetime) -> str:
    """Naive local ISO — the demo renders in the viewer's own clock."""
    return dt.replace(microsecond=0, tzinfo=None).isoformat()


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(iso)


# ============================================================
# Shifts
# ============================================================

def _shift(user_id, start: datetime, end: datetime, shift_type="duty", notes="", scheduled_hours=None) -> dict:
    now = datetime.now()
    status = "completed" if end < now else ("scheduled" if start > now else "active")
    actual_h = (end - start).total_seconds() / 3600
    # scheduled_minutes records the planned length where it differs from actual
    # (extended duty story) so the UI can show Scheduled vs Actual honestly.
    return {
        "id": data_store.new_id("shf"), "user_id": user_id,
        "start_at": _local_iso(start), "end_at": _local_iso(end),
        "shift_type": shift_type, "status": status,
        "break_minutes": 30 if shift_type == "duty" else 0,
        "scheduled_minutes": int(scheduled_hours * 60) if scheduled_hours else int(actual_h * 60),
        "notes": notes, "created_at": data_store.now_iso(),
    }


def _background_shifts(user_id: str, today: datetime) -> list:
    """Template-based shifts for history and the days ahead."""
    prof = USER_PROFILES[user_id]["pattern"]
    out = []
    for offset in range(-20, 11):
        if offset == 0:
            continue  # today is special-cased in build_all
        day = today + timedelta(days=offset)
        weekday = day.weekday()  # Mon=0 .. Sun=6
        if prof == "days_steady":
            if work := weekday < 5:
                out.append(_shift(user_id, day.replace(hour=9), day.replace(hour=17)))
        elif prof == "days":
            work = weekday < 5
            # Rohan's heavy yesterday: an extended 16h shift the day before today.
            if user_id == "usr_rohan" and offset == -1:
                out.append(_shift(user_id, day.replace(hour=10, minute=0),
                                  day + timedelta(days=1, hours=2),  # ends 02:00 today
                                  scheduled_hours=8,
                                  notes="Extended duty — incident support overlap (demo)"))
                continue
            if work:
                out.append(_shift(user_id, day.replace(hour=6), day.replace(hour=14)))
        else:  # nights
            night_days = {2, 4}  # Wed, Fri baseline
            if user_id == "usr_leila":
                night_days = {2, 4, 5, 6}  # + Sat/Sun pair → consecutive nights
                if offset == -2:
                    # Short-rest demo story: an extra evening shift with a tight turnaround
                    out.append(_shift(user_id, day.replace(hour=15), day.replace(hour=21, minute=30)))
            if weekday in night_days or (user_id == "usr_leila" and offset == -2 and day.weekday() == 0):
                out.append(_shift(user_id, day.replace(hour=22),
                                  day + timedelta(days=1, hours=6)))
    return out


def _today_shifts(user_id: str, today: datetime) -> list:
    """Guarantee a meaningful 'today' story for each demo persona.

    Priya's day shift slides so that it straddles *now* — before 14:00 the
    06:00–14:00 duty is active, later an 10:00–18:00 (etc.) duty is active
    instead, so the dashboard's "On shift now" hero works at any hour.
    """
    now = datetime.now()
    if user_id == "usr_priya":
        # Priya carries the SIH demo story: yesterday she covered an incident
        # and her 8h shift ran to 12.5h — the extended-duty thread that the
        # dashboard insight, recovery explanation and supervisor view tie into.
        yest = today - timedelta(days=1)
        extended = _shift(user_id, yest.replace(hour=6), yest.replace(hour=18, minute=30),
                          scheduled_hours=8,
                          notes="Extended duty — incident support overlap (demo)")
        if now.hour < 14:
            return [extended, _shift(user_id, today.replace(hour=6), today.replace(hour=14),
                                     notes="Alpha Unit day duty (demo)")]
        # Afternoon/evening: an 8h duty that is mid-way right now. Cap the
        # end at 23:30 so we never roll past midnight.
        end_hour = min(23, now.hour + 4)
        end = today.replace(hour=end_hour, minute=30 if end_hour == 23 else 0)
        start = end - timedelta(hours=8)
        return [extended, _shift(user_id, start, end, notes="Alpha Unit day duty (demo)")]
    if user_id == "usr_rohan":
        # Recovering from last night's extended duty — rest day.
        return []
    if user_id == "usr_aarav":
        # Steady persona: the plain weekday template above drives his story.
        # Weekends he is genuinely off — which also exercises the calm
        # "no shifts" empty states for the demo.
        return []
    if user_id == "usr_leila":
        if 20 <= now.hour or now.hour < 6:
            # Night hours: her watch is active right now (started 22:00 the
            # previous evening when we're in the small hours).
            if now.hour < 6:
                start = (today - timedelta(days=1)).replace(hour=22)
            else:
                start = now.replace(minute=0, second=0, microsecond=0)
            return [_shift(user_id, start,
                           today + timedelta(days=1, hours=6), notes="Night watch (demo)")]
        return [_shift(user_id, today.replace(hour=22),
                       today + timedelta(days=1, hours=6), notes="Night watch (demo)")]
    return []


# ============================================================
# Wellness + recovery (simulated, deterministic per user/day)
# ============================================================

def _wellness_row(user_id: str, day: datetime, rng: random.Random, after_night: bool) -> dict:
    prof = USER_PROFILES[user_id]
    hr_lo, hr_hi = prof["hr"]
    sl_lo, sl_hi = prof["sleep"]
    q_lo, q_hi = prof["quality"]
    st_lo, st_hi = prof["stress"]
    sleep = rng.randint(sl_lo, sl_hi) - (90 if after_night else 0)
    stress = min(5, max(1, rng.randint(st_lo, st_hi) + (1 if after_night else 0)))
    return {
        "id": data_store.new_id("wdb"), "user_id": user_id,
        "recorded_at": _local_iso(day.replace(hour=7, minute=30)),
        "source": "simulated",
        "heart_rate": rng.randint(hr_lo, hr_hi),
        "hrv_ms": max(20, rng.randint(38, 72) - (14 if after_night else 0)),
        "spo2": rng.randint(*prof["spo2"]),
        "sleep_minutes": max(180, sleep),
        "sleep_quality": rng.randint(q_lo, q_hi),
        "steps": rng.randint(*prof["steps"]),
        "stress_self_report": stress,
    }


def _shift_hours_in_week(user_id: str, day: datetime, shifts_by_user: dict) -> float:
    week_start = day - timedelta(days=day.weekday())
    total = 0.0
    for s in shifts_by_user.get(user_id, []):
        start = _parse(s["start_at"])
        if week_start <= start < day + timedelta(days=1):
            total += (_parse(s["end_at"]) - start).total_seconds() / 3600
    return total


def recovery_from(user_id: str, day: datetime, wellness: dict, shifts_by_user: dict) -> dict:
    """Transparent Recovery Score — every factor is shown to the user.

    Sleep (0–30): 7h target  ·  Rest (0–25): 12h since last duty ends
    Load (0–25): ≤40h week full  ·  Activity (0–10): 8k steps  ·  Stress (0–10)
    """
    sleep_min = wellness["sleep_minutes"] or 0
    steps = wellness["steps"] or 0
    stress = wellness["stress_self_report"] or 3

    day_start = day.replace(hour=0)
    last_end = None
    for s in shifts_by_user.get(user_id, []):
        end = _parse(s["end_at"])
        if end <= day_start + timedelta(hours=8) and (last_end is None or end > last_end):
            last_end = end
    rest_hours = (day_start + timedelta(hours=7) - last_end).total_seconds() / 3600 if last_end else 24.0

    week_hours = _shift_hours_in_week(user_id, day, shifts_by_user)

    f_sleep = min(30.0, sleep_min / 420.0 * 30)
    f_rest = min(25.0, max(0.0, rest_hours) / 12.0 * 25)
    f_load = 25.0 - min(25.0, max(0.0, week_hours - 40) / 16.0 * 25)
    f_act = min(10.0, steps / 8000.0 * 10)
    f_stress = (5 - stress) / 4.0 * 10
    score = round(f_sleep + f_rest + f_load + f_act + f_stress)

    factors = {"sleep": round(f_sleep), "rest": round(f_rest), "shift_load": round(f_load),
               "activity": round(f_act), "stress": round(f_stress),
               "inputs": {"sleep_minutes": sleep_min, "rest_hours": round(max(0, rest_hours), 1),
                          "week_hours": round(week_hours, 1), "steps": steps, "stress": stress}}
    explanation = _explain(factors, sleep_min, rest_hours, week_hours)
    return {
        "id": data_store.new_id("rcv"), "user_id": user_id,
        "computed_at": _local_iso(day.replace(hour=7, minute=35)),
        "score": max(0, min(100, score)), "factors": factors, "explanation": explanation,
    }


def _explain(factors: dict, sleep_min: float, rest_hours: float, week_hours: float) -> str:
    bits = []
    if sleep_min >= 400:
        bits.append(f"a solid {int(sleep_min // 60)}h {int(sleep_min % 60)}m of sleep")
    elif sleep_min < 360:
        bits.append(f"short sleep ({int(sleep_min // 60)}h {int(sleep_min % 60)}m)")
    else:
        bits.append("reasonable sleep")
    if rest_hours >= 12:
        bits.append("plenty of rest since your last shift")
    elif rest_hours < 8:
        bits.append("limited rest since your last shift")
    if week_hours > 50:
        bits.append("a heavy week of shifts")
    elif week_hours <= 40:
        bits.append("a manageable weekly load")
    return "Recovery reflects " + ", ".join(bits) + ". This is a wellness indicator, not a medical assessment."


# ============================================================
# Build + re-anchor
# ============================================================

def build_all() -> None:
    """(Re)generate shifts, wellness and recovery scores for demo personnel."""
    db = data_store.db()
    now = datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    db["shifts"] = []
    db["wellness_data"] = []
    db["recovery_scores"] = []

    shifts_by_user = {}
    for uid in PERSONNEL_IDS:
        rows = _background_shifts(uid, today) + _today_shifts(uid, today)
        rows.sort(key=lambda s: s["start_at"])
        shifts_by_user[uid] = rows
        db["shifts"].extend(rows)

    for uid in PERSONNEL_IDS:
        rng = _rng(uid, today.date())
        # Which mornings follow a night shift (poor day-sleep)?
        night_ends = {_parse(s["end_at"]).date() for s in shifts_by_user[uid]
                      if s["start_at"].endswith("T22:00:00")}
        for offset in range(-13, 1):
            day = today + timedelta(days=offset)
            after_night = day.date() in night_ends
            w = _wellness_row(uid, day, rng, after_night)
            rec = recovery_from(uid, day, w, shifts_by_user)
            if offset == 0:  # today's readings exist up to now
                w["recorded_at"] = data_store.now_iso()
                rec["computed_at"] = data_store.now_iso()
            db["wellness_data"].append(w)
            db["recovery_scores"].append(rec)

    db["meta"]["demo_anchor_at"] = data_store.now_iso()


def refresh_if_stale() -> None:
    """On startup: regenerate time-based demo data if it has gone stale.

    User-authored rows (tasks, requests) are shifted forward by the gap so
    deadlines remain meaningful instead of silently going overdue.
    """
    anchor_iso = data_store.db().get("meta", {}).get("demo_anchor_at")
    now = datetime.now()
    if not anchor_iso:
        build_all()
        data_store.save()
        return
    try:
        anchor = datetime.fromisoformat(anchor_iso).replace(tzinfo=None)
    except ValueError:
        anchor = now - timedelta(hours=STALE_AFTER_HOURS + 1)
    gap = now - anchor
    if gap < timedelta(hours=STALE_AFTER_HOURS):
        return
    build_all()
    delta = timedelta(days=gap.days)  # whole days, keeps times of day stable
    if delta:
        for table, fields in (
            ("tasks", ("due_at", "created_at", "updated_at")),
            ("medic_requests", ("created_at", "updated_at")),
            ("supervisor_requests", ("created_at", "updated_at")),
        ):
            for row in data_store.db().get(table, []):
                for field in fields:
                    raw = row.get(field)
                    if raw:
                        try:
                            row[field] = _local_iso(_parse(raw) + delta)
                        except (ValueError, TypeError):
                            pass
    data_store.save()
    print(f"Demo data re-anchored to now (shifted {delta.days}d where applicable).")
