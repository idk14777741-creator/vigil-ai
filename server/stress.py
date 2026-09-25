"""Stress Load Score for VIGIL AI — addendum §5–§11.

A SECOND indicator alongside Recovery. Deliberately NOT `100 − recovery`:

    Recovery answers  "How recovered am I?"       (higher = better)
    Stress answers    "How much load am I under?" (higher = more load)
    Fatigue answers   "Does the pattern indicate near-term fatigue risk?"

Different dimensions, computed by the same design rules as every VIGIL
engine: deterministic (same data → same score, re-runnable in front of
judges), explainable (every factor shows points/max plus its raw input),
baseline-aware (values are compared with the person's OWN recent pattern,
not universal thresholds), and non-diagnostic (physiological deviations
are contextual indicators, never proof of a psychological state).

Score = sum of weighted factors, 0–100. Bands choose wording only:
    0–39 steady · 40–64 elevated · 65–100 high
Weights are prototype design choices — never claimed as clinical weights.
The numerical score is produced here; any AI layer may only interpret it.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import data_store

FORMULA = {
    "workload": {"max": 25, "desc": "this week's duty hours vs your own recent average"},
    "task_pressure": {"max": 15, "desc": "open and overdue tasks on your plate"},
    "sleep_disruption": {"max": 20, "desc": "sleep below or scattered vs your own baseline"},
    "shift_intensity": {"max": 15, "desc": "night shifts, long shifts, short turnarounds this week"},
    "physio_deviation": {"max": 10, "desc": "heart-rate / HRV away from your own baseline — context only"},
    "self_report": {"max": 10, "desc": "your own 1–5 stress rating"},
    "checkin_context": {"max": 5, "desc": "your latest voluntary weekly wellbeing check-in"},
}

FACTOR_LABELS = {
    "workload": "Workload vs your baseline",
    "task_pressure": "Task pressure",
    "sleep_disruption": "Sleep disruption",
    "shift_intensity": "Shift intensity",
    "physio_deviation": "Physiological deviation",
    "self_report": "Self-reported stress",
    "checkin_context": "Wellbeing check-in context",
}

BANDS = (
    ("steady", 0, 39),
    ("elevated", 40, 64),
    ("high", 65, 100),
)

DISCLAIMER = ("The Stress Load Score is an internal wellness indicator built from your own VIGIL data. "
              "It is not a medical or psychological measurement, and a physiological change (heart rate, "
              "SpO₂) can have many causes — activity, caffeine, environment — so it is used as context, "
              "never as proof of stress. If you feel unwell, your Medic Officer is the right person to talk to.")


def _parse(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso)
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def _shift_hours(rows, until: datetime | None = None) -> float:
    """Net duty hours for a set of shifts (breaks excluded, end clipped to now)."""
    total = 0.0
    for s in rows:
        end = _parse(s["end_at"])
        if until and end > until:
            end = until
        start = _parse(s["start_at"])
        if end <= start:
            continue
        total += (end - start).total_seconds() / 3600 - (s.get("break_minutes") or 0) / 60.0
    return max(0.0, total)


def _band(score: int) -> str:
    for name, lo, hi in BANDS:
        if lo <= score <= hi:
            return name
    return "high"


def compute(uid: str, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    now_iso = now.isoformat(timespec="seconds")
    week_ago = now - timedelta(days=7)
    two_weeks = now - timedelta(days=14)

    shifts = sorted(data_store.find("shifts", lambda s: s["user_id"] == uid and s["shift_type"] == "duty"),
                    key=lambda s: s["start_at"])
    tasks = data_store.find("tasks", lambda t: t["assignee_id"] == uid)
    wellness = sorted(data_store.find("wellness_data", lambda w: w["user_id"] == uid),
                      key=lambda w: w["recorded_at"])
    checkins = sorted(data_store.find("wellbeing_checkins", lambda c: c["user_id"] == uid),
                      key=lambda c: c["week_start"])
    incidents = [i for i in data_store.find("incidents", lambda i: i["reporter_id"] == uid)
                 if _parse(i["created_at"]) >= two_weeks]

    if not shifts and not wellness:
        return {"has_data": False,
                "message": "Your Stress Load Score appears after a few days of shifts and readings.",
                "demo": True}

    # A calendar-window count of FUTURE weeks' shifts would misstate "this
    # week" (rosters are seeded ahead), so hours use the current Monday-to-now
    # window and the personal baseline uses the four full weeks before it.
    this_monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0)
    week = [s for s in shifts if _parse(s["start_at"]) >= this_monday]
    week_hours = _shift_hours(week, now)

    prior_weeks = []
    for back in (1, 2, 3, 4):
        ws = this_monday - timedelta(days=7 * back)
        we = ws + timedelta(days=7)
        prior_weeks.append([s for s in shifts if ws <= _parse(s["start_at"]) < we])
    if prior_weeks and any(prior_weeks):
        baseline_week_hours = sum(_shift_hours(w) for w in prior_weeks) / 4.0
    else:
        baseline_week_hours = None

    open_tasks = [t for t in tasks if t["status"] in ("pending", "in_progress", "blocked")]
    overdue = [t for t in open_tasks if t.get("due_at") and t["due_at"] < now_iso]

    recent_w = [w for w in wellness if _parse(w["recorded_at"]) >= two_weeks]
    older_w = [w for w in wellness if _parse(w["recorded_at"]) < two_weeks]
    latest_w = wellness[-1] if wellness else None

    def avg(rows, key):
        vals = [r.get(key) for r in rows if r.get(key) is not None]
        return sum(vals) / len(vals) if vals else None

    sleep_base = avg(recent_w, "sleep_minutes")
    hr_base_all = avg(wellness, "heart_rate")
    hrv_base_all = avg(wellness, "hrv_ms")

    factors, inputs = {}, {}

    # ---- workload: this week vs the person's own recent weekly norm ----
    if baseline_week_hours:
        delta = week_hours - baseline_week_hours
        pts = min(25.0, max(0.0, delta / 12.0 * 25))  # +12h over own norm → full
        inputs["workload"] = {"week_hours": round(week_hours, 1),
                              "personal_baseline": round(baseline_week_hours, 1)}
        note = (f"{week_hours:.0f}h this week vs your ~{baseline_week_hours:.0f}h norm"
                + (f" (+{delta:.0f}h)" if delta >= 1 else " — at or under your norm"))
    else:
        pts = min(25.0, max(0.0, (week_hours - 40) / 16.0 * 25))
        inputs["workload"] = {"week_hours": round(week_hours, 1), "personal_baseline": None}
        note = f"{week_hours:.0f}h this week (building your personal baseline)"

    # ---- task pressure ----
    pts_task = min(15.0, len(open_tasks) * 2.0 + len(overdue) * 3.0)
    inputs["task_pressure"] = {"open": len(open_tasks), "overdue": len(overdue)}
    note_task = (f"{len(open_tasks)} open" + (f", {len(overdue)} overdue" if overdue else "")
                 if open_tasks else "nothing open right now")

    # ---- sleep disruption: below own baseline + short nights this fortnight ----
    pts_sleep = 0.0
    sleep_note = "sleep readings building a baseline"
    if latest_w and sleep_base:
        last_sleep = latest_w.get("sleep_minutes") or 0
        deficit = sleep_base - last_sleep
        pts_sleep += min(12.0, max(0.0, deficit / 90.0 * 12))  # 90min below own norm → full
        short_nights = sum(1 for w in recent_w if (w.get("sleep_minutes") or 0) < 360)
        pts_sleep += min(8.0, short_nights * 2.0)
        inputs["sleep_disruption"] = {"last_sleep_minutes": last_sleep,
                                      "personal_baseline": round(sleep_base),
                                      "short_nights_14d": short_nights}
        sleep_note = (f"last night {last_sleep // 60}h {last_sleep % 60}m — about "
                      f"{deficit / 60:.1f}h below your recent average" if deficit > 30
                      else f"last night in line with your ~{int(sleep_base // 60)}h average")
        if short_nights:
            sleep_note += f" · {short_nights} short night{'s' if short_nights != 1 else ''} in two weeks"
    elif latest_w:
        last_sleep = latest_w.get("sleep_minutes") or 0
        pts_sleep = min(12.0, max(0.0, (420 - last_sleep) / 120.0 * 12))
        inputs["sleep_disruption"] = {"last_sleep_minutes": last_sleep, "personal_baseline": None}
        sleep_note = f"last night {last_sleep // 60}h {last_sleep % 60}m (building your personal baseline)"

    # ---- shift intensity: nights, long shifts, short turnarounds this week ----
    nights = sum(1 for s in week if _parse(s["start_at"]).hour >= 18 or _parse(s["start_at"]).hour < 4)
    longs = sum(1 for s in week
                if (_parse(s["end_at"]) - _parse(s["start_at"])).total_seconds() / 3600 > 10)
    turnarounds = 0
    for a, b in zip(week, week[1:]):
        gap = (_parse(b["start_at"]) - _parse(a["end_at"])).total_seconds() / 3600
        if 0 <= gap < 12:
            turnarounds += 1
    pts_shift = min(15.0, nights * 4.0 + longs * 3.0 + turnarounds * 4.0)
    bits = []
    if nights: bits.append(f"{nights} night shift{'s' if nights != 1 else ''}")
    if longs: bits.append(f"{longs} over 10h")
    if turnarounds: bits.append(f"{turnarounds} short turnaround{'s' if turnarounds != 1 else ''}")
    inputs["shift_intensity"] = {"night_shifts": nights, "long_shifts": longs, "short_turnarounds": turnarounds}
    note_shift = " · ".join(bits) if bits else "a regular-shaped week of shifts"

    # ---- physiological deviation: context ONLY, vs the person's own baseline ----
    pts_phys = 0.0
    phys_note = "readings in your usual range"
    if hr_base_all:
        last_hr = latest_w.get("heart_rate") if latest_w else None
        last_hrv = latest_w.get("hrv_ms") if latest_w else None
        dev = 0.0
        if last_hr and hr_base_all and last_hr > hr_base_all * 1.10:
            dev += min(5.0, (last_hr / hr_base_all - 1.10) / 0.15 * 5)
        if last_hrv and hrv_base_all and last_hrv < hrv_base_all * 0.85:
            dev += min(5.0, (1 - last_hrv / hrv_base_all) / 0.20 * 5)
        pts_phys = dev
        inputs["physio_deviation"] = {
            "heart_rate": last_hr, "hr_baseline": round(hr_base_all) if hr_base_all else None,
            "hrv_ms": last_hrv, "hrv_baseline": round(hrv_base_all) if hrv_base_all else None}
        phys_bits = []
        if last_hr and hr_base_all:
            phys_bits.append(f"HR {last_hr} vs your ~{round(hr_base_all)} avg")
        if last_hrv and hrv_base_all:
            phys_bits.append(f"HRV {last_hrv}ms vs your ~{round(hrv_base_all)}ms")
        phys_note = " · ".join(phys_bits) + " — many everyday causes; context only" if dev else \
            (" · ".join(phys_bits) + " — close to your usual range")

    # ---- self report + voluntary check-in ----
    stress_self = (latest_w or {}).get("stress_self_report")
    pts_self = 0.0
    self_note = "no rating yet"
    if stress_self is not None:
        pts_self = max(0.0, (stress_self - 2)) / 3.0 * 10
        inputs["self_report"] = {"rating": stress_self}
        self_note = f"you rated today {stress_self} of 5"

    latest_ck = checkins[-1] if checkins else None
    pts_ck = 0.0
    ck_note = "no weekly check-in yet"
    if latest_ck and latest_ck.get("score") is not None:
        ck_score = latest_ck["score"]
        pts_ck = max(0.0, (55 - ck_score)) / 55.0 * 5
        inputs["checkin_context"] = {"week_start": latest_ck["week_start"], "score": ck_score}
        ck_note = f"your latest check-in was {ck_score} of 100 — kept in view, gently"

    # ---- recent incident context (raised load, not blame) ----
    if incidents:
        pts_task = min(15.0, pts_task + 2.0)
        note_task += f" · {len(incidents)} incident report{'s' if len(incidents) != 1 else ''} in two weeks"

    score = round(min(100.0, pts + pts_task + pts_sleep + pts_shift + pts_phys + pts_self + pts_ck))
    factors = {
        "workload": round(pts), "task_pressure": round(pts_task), "sleep_disruption": round(pts_sleep),
        "shift_intensity": round(pts_shift), "physio_deviation": round(pts_phys),
        "self_report": round(pts_self), "checkin_context": round(pts_ck),
    }

    band = _band(score)
    notes = {"workload": note, "task_pressure": note_task, "sleep_disruption": sleep_note,
             "shift_intensity": note_shift, "physio_deviation": phys_note,
             "self_report": self_note, "checkin_context": ck_note}
    top = sorted(factors.items(), key=lambda kv: -kv[1])[:2]
    top_labels = [FACTOR_LABELS[k] for k, _ in top if _ > 0]

    return {
        "has_data": True,
        "score": score,
        "band": band,
        "band_label": {"steady": "Steady", "elevated": "Elevated", "high": "High"}[band],
        "factors": factors,
        "factor_meta": [
            {"key": k, "label": FACTOR_LABELS[k], "points": factors[k], "max": FORMULA[k]["max"],
             "input": notes[k], "desc": FORMULA[k]["desc"]}
            for k in FORMULA
        ],
        "inputs": inputs,
        "top_contributors": top_labels,
        "summary": _summary(score, band, top_labels, note),
        "support": _support(band),
        "distinct_from_recovery": ("Stress measures current load — Recovery measures how restored you are. "
                                   "They are calculated separately and can move in opposite directions."),
        "disclaimer": DISCLAIMER,
        "weights_note": "Factor weights are this prototype's transparent design choices, not clinical weights.",
        "demo": True,
    }


def history(uid: str, days: int = 14) -> list:
    """Daily stress points for the trend chart — recompute per wellness day.

    Deterministic: derived strictly from stored wellness rows, shift rows and
    task rows, so re-running yields identical history. Days without any
    readings are skipped (never interpolated — no invented data).
    """
    now = datetime.now()
    out = []
    wellness = sorted(data_store.find("wellness_data", lambda w: w["user_id"] == uid),
                      key=lambda w: w["recorded_at"])
    for w in wellness:
        day = _parse(w["recorded_at"])
        if day > now - timedelta(days=days):
            out.append({
                "date": day.date().isoformat(),
                "score": _score_at(uid, day, w),
            })
    return out[-days:]


def _score_at(uid: str, day: datetime, w: dict) -> int:
    """Lightweight as-of scoring: the person-level engine anchored to one day.

    Uses the same factor weights but restricts shift/task windows to before
    the reading, so the chart shows what the score WAS on that day.
    """
    week_ago = day - timedelta(days=7)
    shifts = [s for s in data_store.find("shifts", lambda s: s["user_id"] == uid and s["shift_type"] == "duty")
              if _parse(s["start_at"]) < day]
    tasks = [t for t in data_store.find("tasks", lambda t: t["assignee_id"] == uid)
             if t.get("created_at") and _parse(t["created_at"]) <= day]
    open_tasks = [t for t in tasks if t["status"] in ("pending", "in_progress", "blocked")]
    overdue = [t for t in open_tasks if t.get("due_at") and t["due_at"] < day.isoformat(timespec="seconds")]

    this_monday = (day - timedelta(days=day.weekday())).replace(hour=0, minute=0)
    week = [s for s in shifts if _parse(s["start_at"]) >= this_monday]
    week_hours = _shift_hours(week, day)
    prior = [[s for s in shifts
              if this_monday - timedelta(days=7 * b) <= _parse(s["start_at"]) < this_monday - timedelta(days=7 * (b - 1))]
             for b in (1, 2, 3, 4)]
    base = sum(_shift_hours(p) for p in prior) / 4.0 if any(prior) else None
    if base:
        pts_w = min(25.0, max(0.0, (week_hours - base) / 12.0 * 25))
    else:
        pts_w = min(25.0, max(0.0, (week_hours - 40) / 16.0 * 25))

    pts_t = min(15.0, len(open_tasks) * 2.0 + len(overdue) * 3.0)

    last_sleep = w.get("sleep_minutes") or 0
    pts_s = min(20.0, max(0.0, (420 - last_sleep) / 120.0 * 20))

    nights = sum(1 for s in week if _parse(s["start_at"]).hour >= 18 or _parse(s["start_at"]).hour < 4)
    longs = sum(1 for s in week if (_parse(s["end_at"]) - _parse(s["start_at"])).total_seconds() / 3600 > 10)
    pts_i = min(15.0, nights * 4.0 + longs * 3.0)

    stress_self = w.get("stress_self_report")
    pts_r = max(0.0, (stress_self - 2)) / 3.0 * 10 if stress_self is not None else 0.0

    return round(min(100.0, pts_w + pts_t + pts_s + pts_i + pts_r))


def _summary(score: int, band: str, top: list, workload_note: str) -> str:
    if band == "steady":
        base = f"Your stress load is {score} of 100 — a steady level."
    elif band == "elevated":
        base = f"Your stress load is {score} of 100 — elevated."
    else:
        base = (f"Your stress load is {score} of 100 — high. This is information, not a judgement: "
                "support is there when you want it.")
    if top:
        base += " What's contributing most: " + " and ".join(top).lower() + "."
    return base


def _support(band: str) -> list:
    """Calm, escalating support options — never punitive, never mandatory."""
    opts = [
        {"icon": "♪", "title": "De-Stress Zone", "desc": "Ten quiet minutes help many people reset",
         "path": "#/destress", "engage": "destress_zone"},
        {"icon": "⇄", "title": "Buddy Connect", "desc": "Talk it through with someone you trust",
         "path": "#/buddy", "engage": "buddy_connect"},
    ]
    if band in ("elevated", "high"):
        opts.append({"icon": "✚", "title": "Medic Officer", "desc": "Welfare support, confidential",
                     "path": "#/medic", "engage": "medic_connection"})
    if band == "high":
        opts.append({"icon": "⚑", "title": "Supervisor — load conversation",
                     "desc": "If workload is the driver, it can be rebalanced",
                     "path": "#/supervisor", "engage": "supervisor_load"})
    return opts
