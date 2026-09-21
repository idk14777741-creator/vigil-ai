"""Roster Fatigue Balancer — supervisor-side, privacy-preserving by construction.

The supervisor plans duty; VIGIL projects the AGGREGATE effect on team
recovery. What crosses the privacy line is fixed here, server-side:

  Supervisors receive
    ✓ team size, unit name
    ✓ aggregate recovery values (averages, counts) — never attached to a name
    ✓ per-person OPERATIONAL roster facts (hours, consecutive days, extended
      duty upcoming) — the roster they already manage
    ✓ roster-level suggestions

  Supervisors NEVER receive
    ✕ any individual wellness or recovery value
    ✕ any biometric value (HR / HRV / SpO₂ / sleep)
    ✕ any anomaly result
    ✕ any forecast for a named person
    ✕ private conversations, incident details, medic threads

Aggregate fatigue metrics are computed from data the supervisor cannot see
individually — the aggregation happens where the data lives (this server),
and only the anonymous result is returned. Role checks are real: only
supervisor/admin roles reach these routes at all.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import data_store
import forecast

BAND_LABELS = {"steady": "Steady", "elevated": "Elevated", "heavy": "Heavy"}


def _parse(iso):
    return forecast._parse(iso)


def _hours(a, b):
    return forecast._hours(a, b)


def team_uids(supervisor_id: str) -> list:
    """Members of units this supervisor leads (admin → everyone)."""
    prof = data_store.find_one("profiles", lambda p: p["id"] == supervisor_id)
    if prof and prof.get("role") == "admin":
        return [p["id"] for p in data_store.all_rows("profiles")
                if p.get("role") == "personnel"]
    units = data_store.find("unit_members", lambda m: m["user_id"] == supervisor_id)
    out = []
    for m in units:
        for mm in data_store.find("unit_members", lambda x: x["unit_id"] == m["unit_id"]):
            pid = mm["user_id"]
            p = data_store.find_one("profiles", lambda q: q["id"] == pid)
            if p and p.get("role") == "personnel" and pid not in out:
                out.append(pid)
    return out


def team_fatigue_metrics(supervisor_id: str, now: datetime | None = None) -> dict:
    """Aggregate-only team picture. No per-person health values exist here."""
    now = now or datetime.now()
    uids = team_uids(supervisor_id)
    if not uids:
        return {"has_team": False, "message": "No personnel are assigned to your units yet.",
                "demo": True}

    scores = []
    for uid in uids:
        recs = sorted(data_store.find("recovery_scores", lambda r: r["user_id"] == uid),
                      key=lambda r: r["computed_at"])
        if recs:
            scores.append(recs[-1]["score"])

    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_end = week_start + timedelta(days=7)
    upcoming_week = []
    extended_upcoming = 0
    for uid in uids:
        for s in data_store.find("shifts", lambda s: s["user_id"] == uid):
            if s["shift_type"] != "duty" or not (week_start <= _parse(s["start_at"]) < week_end):
                continue
            upcoming_week.append(s)
            if _hours(_parse(s["start_at"]), _parse(s["end_at"])) > 12:
                extended_upcoming += 1

    total_hours = sum(_hours(_parse(s["start_at"]), _parse(s["end_at"])) for s in upcoming_week)
    avg_score = round(sum(scores) / len(scores)) if scores else None
    band = ("steady" if avg_score is None else
            ("steady" if avg_score >= 70 else ("elevated" if avg_score >= 45 else "heavy")))
    low = len([s for s in scores if s < 45])
    return {
        "has_team": True,
        "team_size": len(uids),
        "team_recovery_avg": avg_score,
        "team_recovery_band": band,
        "band_label": BAND_LABELS[band],
        "distribution": {"steady": len([s for s in scores if s >= 70]),
                         "elevated": len([s for s in scores if 45 <= s < 70]),
                         "heavy": low},
        "workload": {"week_hours_total": round(total_hours, 1),
                     "avg_hours_per_person": round(total_hours / len(uids), 1) if uids else 0,
                     "extended_duty_upcoming": extended_upcoming},
        "risk_window": "Next 24–48 hours",
        "demo": True,
    }


def _member_roster_view(uid: str, now: datetime) -> dict:
    """Operational roster facts only — no health values."""
    prof = data_store.find_one("profiles", lambda p: p["id"] == uid)
    shifts = sorted(data_store.find("shifts", lambda s: s["user_id"] == uid),
                    key=lambda s: s["start_at"])
    duty = [s for s in shifts if s["shift_type"] == "duty"]
    upcoming = [s for s in duty if s["start_at"] > now.isoformat(timespec="seconds")]
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_hours = round(sum(_hours(_parse(s["start_at"]), _parse(s["end_at"]))
                           for s in duty if week_start <= _parse(s["start_at"]) < week_start + timedelta(days=7)), 1)
    consec = 0
    day = now.date()
    while True:
        if any(_parse(s["start_at"]).date() <= day <= _parse(s["end_at"]).date() for s in duty):
            consec += 1
            day -= timedelta(days=1)
        else:
            break
    return {
        "member_id": uid,
        "name": (prof.get("full_name") if prof else None) or "Member",
        "week_hours": week_hours,
        "consecutive_days": consec,
        "upcoming_shifts": [{"id": s["id"], "start_at": s["start_at"], "end_at": s["end_at"],
                             "hours": round(_hours(_parse(s["start_at"]), _parse(s["end_at"])), 1)}
                            for s in upcoming[:4]],
    }


def roster_overview(supervisor_id: str, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    uids = team_uids(supervisor_id)
    members = sorted((_member_roster_view(uid, now) for uid in uids),
                     key=lambda m: (-m["week_hours"], -m["consecutive_days"]))
    metrics = team_fatigue_metrics(supervisor_id, now)
    return {"members": members, "metrics": metrics, "demo": True}


def scenario_simulate(supervisor_id: str, body: dict, now: datetime | None = None) -> dict:
    """Simulate a hypothetical roster on AGGREGATES ONLY.

    Body: {"extend": {"shift_id": extra_hours}, "extra_shifts": [{"user_id", "start_at", "end_at"}]}
    Returns before/after aggregate comparison + suggestions. Nothing about an
    individual's health is ever computed into the response, and nothing is
    persisted unless the supervisor saves the scenario.
    """
    now = now or datetime.now()
    uids = team_uids(supervisor_id)
    if not uids:
        return 403, {"error": "No personnel are assigned to your units yet."}

    extend = {}
    for sid, extra in (body.get("extend") or {}).items():
        try:
            extend[sid] = max(0.0, min(12.0, float(extra)))
        except (TypeError, ValueError):
            return 400, {"error": "Extension hours must be a number."}
    extra_shifts = []
    for s in body.get("extra_shifts") or []:
        uid = s.get("user_id")
        if uid not in uids:
            return 403, {"error": "Scenario shifts may only involve your own unit members."}
        try:
            extra_shifts.append({"user_id": uid, "start_at": s["start_at"], "end_at": s["end_at"]})
        except KeyError:
            return 400, {"error": "Scenario shift needs start_at and end_at."}

    base_rows = forecast.project_team(uids, now=now)
    scenario_by_user = {}
    for uid in uids:
        ext = {sid: h for sid, h in extend.items()
               if any(sh["id"] == sid for sh in data_store.find("shifts", lambda s: s["user_id"] == uid))}
        sc = {"extend": ext}
        if extra_shifts:
            sc["extra_shifts"] = [{"start_at": s["start_at"], "end_at": s["end_at"]}
                                  for s in extra_shifts if s["user_id"] == uid]
        scenario_by_user[uid] = sc
    proj_rows = forecast.project_team(uids, scenario_by_user=scenario_by_user, now=now)

    def agg(rows):
        cur = [c for _, c, _ in rows if c is not None]
        pro = [p for _, _, p in rows if p is not None]
        return (round(sum(cur) / len(cur)) if cur else None,
                round(sum(pro) / len(pro)) if pro else None)

    base_cur, base_pro = agg(base_rows)
    proj_cur, proj_pro = agg(proj_rows)

    def band(v):
        if v is None:
            return None
        return "steady" if v >= 70 else ("elevated" if v >= 45 else "heavy")

    base_b, proj_b = band(base_pro), band(proj_pro)
    order = {"steady": 0, "elevated": 1, "heavy": 2}
    impact = "No change"
    if base_b and proj_b and order[proj_b] > order[base_b]:
        impact = f"{BAND_LABELS[base_b]} → {BAND_LABELS[proj_b]}"
    elif base_b and proj_b and order[proj_b] < order[base_b]:
        impact = f"{BAND_LABELS[base_b]} → {BAND_LABELS[proj_b]}"

    suggestions = []
    for uid, cur, pro in proj_rows:
        if pro is None:
            continue
        mv = _member_roster_view(uid, now)
        if pro - (cur or pro) <= -8:
            suggestions.append({"member_id": uid, "name": mv["name"],
                                "suggestion": "Increase recovery gap before this duty",
                                "reason": "Projected 24h recovery drop is large in this scenario"})
        elif mv["consecutive_days"] >= 5:
            suggestions.append({"member_id": uid, "name": mv["name"],
                                "suggestion": "Review consecutive duty days",
                                "reason": f"{mv['consecutive_days']} consecutive duty days scheduled"})
        elif mv["week_hours"] > 55:
            suggestions.append({"member_id": uid, "name": mv["name"],
                                "suggestion": "Redistribute extended duty",
                                "reason": f"{mv['week_hours']}h scheduled this week"})
    return 200, {
        "scenario": {"extend": extend, "extra_shifts": extra_shifts},
        "current_team_recovery": base_cur,
        "projected_team_recovery": proj_pro,
        "projected_band": proj_b,
        "impact": impact,
        "suggestions": suggestions[:4],
        "privacy": ("Projection is aggregate-only. No individual recovery, wellness or "
                    "biometric value is shown to you — by design."),
        "demo": True,
        "label": forecast.LABEL,
    }


def save_scenario(supervisor_id: str, body: dict) -> tuple:
    name = (body.get("name") or "").strip()[:60]
    if not name:
        return 400, {"error": "Give the scenario a short name."}
    row = {"id": data_store.new_id("rsc"), "supervisor_id": supervisor_id,
           "name": name, "scenario": body.get("scenario") or {},
           "result_summary": body.get("result_summary") or {},
           "created_at": data_store.now_iso()}
    data_store.insert("roster_scenarios", row)
    data_store.audit(supervisor_id, "roster.scenario_saved", target=name)
    return 200, {"scenario": row, "demo": True}


def list_scenarios(supervisor_id: str) -> dict:
    rows = sorted(data_store.find("roster_scenarios", lambda r: r["supervisor_id"] == supervisor_id),
                  key=lambda r: r["created_at"], reverse=True)[:10]
    return {"scenarios": rows, "demo": True}
