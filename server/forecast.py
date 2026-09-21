"""Fatigue Forecast for VIGIL AI — intelligence layer, phases 1–2.

Answers one question: "Where might my recovery be heading?" over the next
24 and 48 hours — always as an *estimate with uncertainty*, never a
guarantee, never a medical or fitness-for-duty prediction.

    Forecast Engine
        ↓
    Input Features (from the platform's own data)
        ↓
    Prediction        (projected Recovery Score)
        ↓
    Uncertainty Estimate (± band, confidence)
        ↓
    Contributing Factors (each one explainable)

Design rules:
  - Deterministic: the same platform data always produces the same forecast.
    Judges can re-run the demo and see identical numbers.
  - Explainable: every contributor names the exact evidence (upcoming shift
    length, sleep vs the person's own baseline, rest gap…), each of which is
    visible on the Shift Monitor / Wellness / Recovery pages.
  - Uncertainty-aware: every projection carries a ± band and a confidence
    level that widens when inputs are missing or volatile.
  - Modular: `TransparentLinearEngine` is a transparent rule-based model.
    A trained ML model can be swapped in behind the same interface later
    (see `ENGINE` at the bottom of this file).
  - Honest labelling: responses carry model + "DEMO / SIMULATED FORECAST".
    This model has NOT been clinically validated and makes no diagnosis.

Language rules: "projected", "estimated", "may" — never "guaranteed",
"certain", "fit/unfit", "diagnosis".
"""
from __future__ import annotations

from datetime import datetime, timedelta

import data_store

LABEL = "DEMO / SIMULATED FORECAST"
DISCLAIMER = ("Forecasts are estimates and may change as new information becomes available. "
              "This is a wellness planning aid — not a medical prediction and not a "
              "fitness-for-duty decision.")


def _parse(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso)
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def _hours(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 3600.0


# ============================================================
# Feature extraction — every feature traces back to a page the
# user can open (Shift Monitor, Wellness, Recovery, Wellbeing).
# ============================================================

def extract_features(uid: str, shifts: list, wellness: list, recovery: list,
                     wellbeing: list, now: datetime) -> dict:
    rec = sorted(recovery, key=lambda r: r["computed_at"])
    well = sorted(wellness, key=lambda w: w["recorded_at"])
    duty = sorted([s for s in shifts if s.get("shift_type") == "duty"], key=lambda s: s["start_at"])
    now_iso = now.isoformat(timespec="seconds")

    current = rec[-1]["score"] if rec else None
    prev = rec[-3:]  # last up-to-3 scores for a slope
    slope = None
    if len(prev) >= 2:
        deltas = [prev[i]["score"] - prev[i - 1]["score"] for i in range(1, len(prev))]
        slope = round(sum(deltas) / len(deltas), 1)

    latest_w = well[-1] if well else None
    sleep_min = latest_w.get("sleep_minutes") if latest_w else None
    stress = latest_w.get("stress_self_report") if latest_w else None
    week_w = [w for w in well[-8:-1] if w.get("sleep_minutes") is not None]
    sleep_baseline = round(sum(w["sleep_minutes"] for w in week_w) / len(week_w)) if week_w else None
    short_nights_3 = len([w for w in well[-3:] if (w.get("sleep_minutes") or 0) < 360])

    # Week workload (Monday-anchored), matching the insights engine: the whole
    # calendar week counts, past days and planned days alike — it is planned load.
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_end = week_start + timedelta(days=7)
    week_hours = round(sum(_hours(_parse(s["start_at"]), _parse(s["end_at"]))
                           for s in duty if week_start <= _parse(s["start_at"]) < week_end), 1)

    last_end = None
    for s in duty:
        end = _parse(s["end_at"])
        if end <= now and (last_end is None or end > last_end):
            last_end = end
    rest_hours = round(_hours(last_end, now), 1) if last_end else None

    # Consecutive duty days ending today.
    consec = 0
    day = now.date()
    while True:
        if any(_parse(s["start_at"]).date() <= day <= _parse(s["end_at"]).date() for s in duty):
            consec += 1
            day -= timedelta(days=1)
        else:
            break

    # Wellbeing check-in trend (optional supporting feature).
    wb = sorted(wellbeing, key=lambda c: c["week_start"])
    wb_delta = None
    if len(wb) >= 2:
        last, prev = wb[-1].get("score"), wb[-2].get("score")
        if last is not None and prev is not None:
            wb_delta = round(last - prev, 2)

    return {
        "current": current,
        "recovery_rows": len(rec),
        "slope": slope,
        "sleep_min": sleep_min,
        "sleep_baseline": sleep_baseline,
        "short_nights_3": short_nights_3,
        "stress": stress,
        "week_hours": week_hours,
        "rest_hours": rest_hours,
        "consecutive_days": consec,
        "wellbeing_delta": wb_delta,
        "upcoming": [s for s in duty if s["start_at"] > now_iso],
        "last_end": last_end,
    }


# ============================================================
# The transparent rule-based engine (v1)
# ============================================================

class TransparentLinearEngine:
    """A fully readable model: additive contributions, each one nameable.

    Deliberately simple — explainability over complexity. The interface
    (`project(features, horizon)`) is what a trained model would implement
    to replace this without touching any UI or API code.
    """

    name = "transparent-rules-v1"
    kind = "rule_based"

    def project(self, f: dict, horizon_h: int, now: datetime) -> dict:
        """Return {delta, uncertainty_pm, contributions} for one horizon."""
        parts = []  # (label, delta, evidence)

        # 1. Recent trajectory, partially carried forward (decays with time).
        if f.get("slope") is not None:
            carry = round(max(-8.0, min(8.0, f["slope"])) * (0.4 if horizon_h <= 24 else 0.2), 1)
            if carry:
                parts.append(("Recent recovery trend", carry,
                              f"last scores moved {f['slope']:+.0f} points/day on average"))

        # 2. Sleep vs the person's own baseline.
        sleep_min, base = f.get("sleep_min"), f.get("sleep_baseline")
        if sleep_min is not None:
            if base is not None and sleep_min <= base - 45:
                d = -3 if horizon_h <= 24 else -4
                parts.append(("Sleep below your usual pattern", d,
                              f"{int(sleep_min // 60)}h {int(sleep_min % 60)}m last night vs your "
                              f"{int(base // 60)}h weekly average"))
            elif base is not None and sleep_min >= base + 45:
                d = 2 if horizon_h <= 24 else 3
                parts.append(("Well-rested night", d,
                              f"{int(sleep_min // 60)}h {int(sleep_min % 60)}m — above your weekly average"))
            if f.get("short_nights_3", 0) >= 2 and horizon_h > 24:
                parts.append(("Several short nights this week", -2,
                              f"{f['short_nights_3']} of the last 3 nights under 6h"))

        # 3. Upcoming shifts in this horizon (merged into ONE contributor so
        # multiple duties don't repeat the same line — the points still add up).
        horizon_end = now + timedelta(hours=horizon_h)
        shift_parts = []
        for s in f.get("upcoming", []):
            start, end = _parse(s["start_at"]), _parse(s["end_at"])
            if not (now < start < horizon_end):
                continue
            dur = _hours(start, end)
            d = -2.0
            detail = f"{dur:.0f}h duty starting {start.strftime('%a %H:%M')}"
            if dur > 8:
                d -= min(6.0, (dur - 8) * 1.5)
                detail += f" — {dur - 8:.0f}h longer than a standard duty"
            if f.get("consecutive_days", 0) >= 4:
                d -= 2
                detail += f" (day {f['consecutive_days'] + 1} of consecutive duty)"
            shift_parts.append((d, detail))
        if shift_parts:
            total_d = round(sum(x[0] for x in shift_parts), 1)
            detail = shift_parts[0][1]
            if len(shift_parts) > 1:
                detail += f" (+{len(shift_parts) - 1} more shift{'s' if len(shift_parts) > 2 else ''} in this window)"
            parts.append(("Upcoming shift", total_d, detail))

        # 4. Rest gap before the next shift.
        upcoming = f.get("upcoming") or []
        if upcoming:
            next_start = _parse(upcoming[0]["start_at"])
            gap = _hours(f["last_end"], next_start) if f.get("last_end") else 24.0
            if next_start < horizon_end and gap < 10:
                parts.append(("Short recovery period before your next shift",
                              -4 if horizon_h <= 24 else -3,
                              f"about {gap:.0f}h between duty ending and the next one starting"))
        # 5. Genuine off-day bonus.
        elif f.get("last_end") and _hours(f["last_end"], now) >= 2:
            if horizon_h <= 24 or len([s for s in f.get("upcoming", [])
                                       if _parse(s["start_at"]) < now + timedelta(hours=horizon_h)]) <= 1:
                parts.append(("Recovery day with no duty", 3 if horizon_h <= 24 else 4,
                              "no shifts in this window — the score usually drifts up"))

        # 6. Self-reported stress.
        stress = f.get("stress")
        if stress is not None and stress >= 4:
            parts.append(("Self-reported stress running high", -4 if stress == 5 else -3,
                          f"you rated stress {stress} of 5"))

        # 7. Wellbeing check-in trend (self-reported, supporting signal only).
        wb = f.get("wellbeing_delta")
        if wb is not None and abs(wb) >= 0.4:
            parts.append(("Weekly wellbeing check-ins drifting " + ("down" if wb < 0 else "up"),
                          -2 if wb < 0 else 1,
                          f"self-reported wellbeing moved {wb:+.1f} week-over-week"))

        # 8. Weekly workload pressure.
        if f.get("week_hours") is not None and f["week_hours"] > 50:
            parts.append(("Heavy weekly workload", -2, f"{f['week_hours']}h on duty this week"))

        total = round(sum(d for _, d, _ in parts), 1)
        total = max(-15.0, min(10.0, total))
        return {"delta": total, "contributions": parts}

    def uncertainty(self, f: dict, horizon_h: int) -> float:
        pm = 3.0 if horizon_h <= 24 else 6.0
        rec = f.get("recovery_rows") or 0
        if rec < 3:
            pm += 1
        if f.get("stress") is None:
            pm += 1
        if f.get("sleep_min") is None:
            pm += 1
        if f.get("slope") is None:
            pm += 1
        return min(pm, 5.0 if horizon_h <= 24 else 9.0)

    def confidence(self, f: dict) -> str:
        missing = sum(1 for k in ("stress", "sleep_min", "slope") if f.get(k) is None)
        if missing == 0:
            return "high"
        if missing <= 2:
            return "moderate"
        return "low"


ENGINE = TransparentLinearEngine()


# ============================================================
# Public API
# ============================================================

def _contributor_view(parts: list) -> list:
    """Top contributors, most influential first, calm phrasing.

    Parts from both horizons are merged by label so one factor appears once
    (points summed) instead of repeating per horizon.
    """
    merged = {}
    order = []
    for label, delta, detail in parts:
        if label not in merged:
            merged[label] = {"delta": 0.0, "details": []}
            order.append(label)
        merged[label]["delta"] += delta
        if detail not in merged[label]["details"]:
            merged[label]["details"].append(detail)
    out = []
    for label in sorted(order, key=lambda l: abs(merged[l]["delta"]), reverse=True)[:4]:
        m = merged[label]
        delta = round(m["delta"], 1)
        detail = m["details"][0]
        if len(m["details"]) > 1:
            detail += f" (and {len(m['details']) - 1} more shift{'s' if len(m['details']) > 2 else ''} in this window)"
        out.append({
            "label": label,
            "direction": "down" if delta < 0 else ("up" if delta > 0 else "flat"),
            "points": delta,
            "detail": detail,
        })
    return out


def _why_text(parts: list, horizon_h: int) -> list:
    """Numbered plain-language reasons for the projection."""
    reasons = []
    for label, delta, detail in sorted(parts, key=lambda p: abs(p[1]), reverse=True)[:4]:
        arrow = "may pull recovery down" if delta < 0 else ("may support recovery" if delta > 0 else "")
        reasons.append(f"{label} — {detail}; {arrow}." if arrow else f"{label} — {detail}.")
    if not reasons:
        reasons.append("Nothing notable in your recent pattern for this window — the projection stays close to today's score.")
    return reasons


def compute(uid: str, scenario: dict | None = None, now: datetime | None = None) -> dict:
    """Full forecast for one user.

    `scenario` (roster balancer only): {"extra_shifts": [...], "extend": {shift_id: extra_hours}}
    — hypothetical shifts replace the real upcoming window inside the model.
    Never persisted as the user's actual schedule.
    """
    now = now or datetime.now()
    shifts = data_store.find("shifts", lambda s: s["user_id"] == uid)
    wellness = data_store.find("wellness_data", lambda w: w["user_id"] == uid)
    recovery = data_store.find("recovery_scores", lambda r: r["user_id"] == uid)
    wellbeing = data_store.find("wellbeing_checkins", lambda c: c["user_id"] == uid)

    if scenario:
        extra = []
        for s in scenario.get("extra_shifts", []):
            extra.append({"id": "scenario", "start_at": s["start_at"], "end_at": s["end_at"],
                          "shift_type": "duty"})
        extend = scenario.get("extend", {})
        for s in shifts:
            if s["id"] in extend:
                s = dict(s)
                s["end_at"] = _parse(s["end_at"]) + timedelta(hours=float(extend[s["id"]]))
                s["end_at"] = s["end_at"].isoformat(timespec="seconds")
                s["start_at"] = _parse(s["start_at"]).isoformat(timespec="seconds")
                extra.append(s)
        upcoming_now = now.isoformat(timespec="seconds")
        real_upcoming_ids = {s["id"] for s in shifts if s["start_at"] > upcoming_now}
        shifts = [s for s in shifts if s["id"] not in real_upcoming_ids] + extra

    f = extract_features(uid, shifts, wellness, recovery, wellbeing, now)
    current = f["current"]
    if current is None:
        return {
            "has_data": False,
            "message": "Your first forecast appears after a day of shifts and rest — the model needs a Recovery Score to project from.",
            "demo": True, "label": LABEL, "disclaimer": DISCLAIMER,
        }

    p24 = ENGINE.project(f, 24, now)
    p48 = ENGINE.project(f, 48, now)
    pm24 = ENGINE.uncertainty(f, 24)
    pm48 = ENGINE.uncertainty(f, 48)

    v24 = max(0, min(100, round(current + p24["delta"])))
    v48 = max(0, min(100, round(current + p48["delta"])))

    return {
        "has_data": True,
        "current": current,
        "h24": {"projected": v24, "pm": round(pm24, 1),
                "range": [max(0, v24 - round(pm24)), min(100, v24 + round(pm24))],
                "change": v24 - current},
        "h48": {"projected": v48, "pm": round(pm48, 1),
                "range": [max(0, v48 - round(pm48)), min(100, v48 + round(pm48))],
                "change": v48 - current},
        "confidence": ENGINE.confidence(f),
        "contributors": _contributor_view((p24["contributions"] + p48["contributions"])),
        "why": {"h24": _why_text(p24["contributions"], 24), "h48": _why_text(p48["contributions"], 48)},
        "engine": {"name": ENGINE.name, "kind": ENGINE.kind},
        "next_shift": ({"start_at": f["upcoming"][0]["start_at"], "end_at": f["upcoming"][0]["end_at"]}
                       if f["upcoming"] else None),
        "demo": True,
        "label": LABEL,
        "disclaimer": DISCLAIMER,
    }


def project_team(uids: list, scenario_by_user: dict | None = None,
                 now: datetime | None = None) -> list:
    """Per-person (current, projected-24h) tuples for aggregate use only.

    Callers (roster balancer) must aggregate — individual results here are
    NEVER returned to supervisors by any API route.
    """
    now = now or datetime.now()
    out = []
    for uid in uids:
        fc = compute(uid, scenario=(scenario_by_user or {}).get(uid), now=now)
        if fc.get("has_data"):
            out.append((uid, fc["current"], fc["h24"]["projected"]))
        else:
            out.append((uid, None, None))
    return out
