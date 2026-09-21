"""Operational-context engine for VIGIL AI — SIH upgrade phases 3–5.

One deterministic, explainable picture that joins the modules the demo has
always had — shifts, tasks, wellness, recovery — into a single narrative:

    Shift Load → Operational Load → Wellness Context → Recovery Score
              → Explainable Insight → Support Options → Follow-up

Design rules (mirrors the platform's own):
  - Deterministic: the same data always yields the same insights. No LLM
    is involved in scoring or explanations — judges can re-run the demo
    and see identical reasoning.
  - Explainable: every insight lists the evidence rows (numbers the user
    can find on the Shift Monitor, Tasks, Wellness and Recovery pages).
  - Non-diagnostic: operational awareness, never medical claims, never
    alarmist. Suggests support instead of rating people.
  - Support-routing: each insight points at the module that can actually
    help (supervisor for load, medic for wellbeing, de-stress in the
    moment, buddy for connection).
"""
from __future__ import annotations

from datetime import datetime, timedelta

import data_store

# Load is framed in three calm bands. Never used for judgements — only
# to choose supportive wording and which support options surface.
BANDS = ("steady", "elevated", "heavy")


def _parse(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso)
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def _hours(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 3600.0


def compute(uid: str, now: datetime | None = None) -> dict:
    """Build the full operational-context payload for one user."""
    now = now or datetime.now()
    now_iso = now.isoformat(timespec="seconds")

    shifts = data_store.find("shifts", lambda s: s["user_id"] == uid)
    shifts.sort(key=lambda s: s["start_at"])
    duty = [s for s in shifts if s["shift_type"] == "duty"]

    tasks = data_store.find("tasks", lambda t: t["assignee_id"] == uid)
    open_tasks = [t for t in tasks if t["status"] in ("pending", "in_progress", "blocked")]
    overdue = [t for t in open_tasks if t.get("due_at") and t["due_at"] < now_iso]

    wellness = sorted(data_store.find("wellness_data", lambda w: w["user_id"] == uid),
                      key=lambda w: w["recorded_at"])
    recovery = sorted(data_store.find("recovery_scores", lambda r: r["user_id"] == uid),
                      key=lambda r: r["computed_at"])

    shift_ctx = _shift_context(duty, now)
    task_ctx = _task_context(open_tasks, overdue, len(tasks))
    rest_ctx = _rest_context(wellness, recovery)
    load = _load_score(shift_ctx, task_ctx, rest_ctx)

    return {
        "shift": shift_ctx,
        "tasks": task_ctx,
        "rest": rest_ctx,
        "load": load,
        "insights": _insights(uid, shift_ctx, task_ctx, rest_ctx, recovery, now),
        "support_options": _support_options(load),
        "generated_at": data_store.now_iso(),
        "demo": True,
    }


# ---------- shift context ----------

def _shift_context(duty, now: datetime) -> dict:
    now_iso = now.isoformat(timespec="seconds")
    active = next((s for s in duty if s["start_at"] <= now_iso < s["end_at"]), None)
    upcoming = [s for s in duty if s["start_at"] > now_iso]

    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_end = week_start + timedelta(days=7)
    prev_start = week_start - timedelta(days=7)
    this_week = [s for s in duty if week_start <= _parse(s["start_at"]) < week_end]
    prev_week = [s for s in duty if prev_start <= _parse(s["start_at"]) < week_start]
    hours = lambda rows: round(sum(_hours(_parse(s["start_at"]), _parse(s["end_at"])) for s in rows), 1)

    scheduled_vs_actual = None
    started = [s for s in duty if _parse(s["start_at"]) <= now]  # ignore future shifts
    for s in reversed(started):  # most recent shift that already overran its plan
        sched = (s.get("scheduled_minutes") or 0) / 60.0
        actual = _hours(_parse(s["start_at"]), _parse(s["end_at"]))
        if sched and actual > sched + 0.75:
            scheduled_vs_actual = {
                "shift_id": s["id"],
                "scheduled_h": round(sched, 1),
                "actual_h": round(actual, 1),
                "extra_h": round(actual - sched, 1),
                "when": _parse(s["end_at"]).strftime("%a") if _parse(s["end_at"]) < now else "in progress",
            }
            break

    return {
        "active": bool(active),
        "week_hours": hours(this_week),
        "prev_week_hours": hours(prev_week),
        "hours_trend": round(hours(this_week) - hours(prev_week), 1),
        "longest_shift_h": max((_hours(_parse(s["start_at"]), _parse(s["end_at"])) for s in this_week + prev_week[-3:]), default=0.0),
        "scheduled_vs_actual": scheduled_vs_actual,
        "shift_count_this_week": len(this_week),
    }


# ---------- task context ----------

def _task_context(open_tasks, overdue, total) -> dict:
    high = [t for t in open_tasks if t.get("priority") in ("high", "critical")]
    return {
        "open": len(open_tasks),
        "overdue": len(overdue),
        "high_priority": len(high),
        "total": total,
    }


# ---------- rest + wellness context ----------

def _rest_context(wellness, recovery) -> dict:
    latest_w = wellness[-1] if wellness else None
    week_w = [w for w in wellness[-8:-1] if w.get("sleep_minutes") is not None]
    latest_r = recovery[-1] if recovery else None
    prev_r = recovery[-2] if len(recovery) > 1 else None

    sleep_min = (latest_w.get("sleep_minutes") if latest_w else None)
    sleep_avg_prev = (round(sum(w["sleep_minutes"] for w in week_w) / len(week_w)) if week_w else None)
    stress = (latest_w.get("stress_self_report") if latest_w else None)

    return {
        "sleep_minutes": sleep_min,
        "sleep_avg_prev_week": sleep_avg_prev,
        "sleep_drop_minutes": (sleep_avg_prev - sleep_min) if (sleep_min is not None and sleep_avg_prev is not None) else None,
        "stress": stress,
        "recovery_score": latest_r["score"] if latest_r else None,
        "recovery_prev": prev_r["score"] if prev_r else None,
        "recovery_factors": (latest_r.get("factors") or {}) if latest_r else {},
        "recovery_inputs": ((latest_r.get("factors") or {}).get("inputs") or {}) if latest_r else {},
    }


# ---------- operational load (deterministic 0–100) ----------

def _load_score(shift_ctx, task_ctx, rest_ctx) -> dict:
    """Transparent composite of workload pressure. Points LOST from 100."""
    lost = 0.0
    reasons = []

    ext = shift_ctx["scheduled_vs_actual"]
    if ext and ext["extra_h"] >= 2:
        lost += 20
        reasons.append(f"last shift ran {ext['extra_h']}h past its plan")
    elif shift_ctx["week_hours"] > 50:
        lost += 20
        reasons.append(f"{shift_ctx['week_hours']}h worked this week")
    if shift_ctx["week_hours"] > 50 and not (ext and ext["extra_h"] >= 2):
        pass  # already counted above
    if ext and ext["extra_h"] >= 2 and shift_ctx["week_hours"] > 50:
        lost += 10
        reasons.append(f"{shift_ctx['week_hours']}h total this week")
    if task_ctx["overdue"]:
        lost += min(15, 8 + 2 * task_ctx["overdue"])
        reasons.append(f"{task_ctx['overdue']} task{'s' if task_ctx['overdue'] != 1 else ''} past due")
    elif task_ctx["high_priority"] >= 2:
        lost += 8
        reasons.append(f"{task_ctx['high_priority']} high-priority tasks open")

    drop = rest_ctx["sleep_drop_minutes"]
    if drop is not None and drop >= 60:
        lost += 25
        reasons.append(f"sleep down {round(drop / 60 * 10) / 10}h vs your week average")
    elif rest_ctx["sleep_minutes"] is not None and rest_ctx["sleep_minutes"] < 360:
        lost += 20
        reasons.append("under 6h sleep last night")
    if rest_ctx["stress"] is not None and rest_ctx["stress"] >= 4:
        lost += 15
        reasons.append("self-reported stress at 4+ of 5")

    lost = min(60.0, lost)  # operational pressure informs context — it never dominates recovery
    score = round(100 - lost)
    band = "steady" if score >= 70 else ("elevated" if score >= 45 else "heavy")
    return {
        "score": score,
        "band": band,
        "points_lost": round(lost),
        "reasons": reasons,
        "label": {"steady": "Operational load: steady",
                  "elevated": "Operational load: elevated",
                  "heavy": "Operational load: heavy"}[band],
    }


# ---------- insights ----------

def _insights(uid, shift_ctx, task_ctx, rest_ctx, recovery, now: datetime) -> list:
    out = []

    ext = shift_ctx["scheduled_vs_actual"]
    if ext:
        out.append({
            "id": "extended_shift",
            "tone": "info" if ext["actual_h"] < 14 else "warning",
            "icon": "◐",
            "title": "Your last shift ran longer than scheduled",
            "message": (f"It was planned for {ext['scheduled_h']}h and you were on duty about {ext['actual_h']}h "
                        f"({ext['when']}). Extended duty adds to your operational load and eats into rest."),
            "evidence": [f"Scheduled: {ext['scheduled_h']}h", f"Actual: {ext['actual_h']}h"],
            "actions": [
                {"label": "See it in Shift Monitor", "path": "/shifts"},
                {"label": "Discuss load with your supervisor", "path": "/supervisor"},
            ],
        })

    if shift_ctx["hours_trend"] >= 8:
        out.append({
            "id": "week_up",
            "tone": "info",
            "icon": "⚑",
            "title": "This week is heavier than last",
            "message": (f"You're at {shift_ctx['week_hours']}h so far, up {shift_ctx['hours_trend']}h on last week "
                        "at the same point. Worth watching before it compounds."),
            "evidence": [f"This week: {shift_ctx['week_hours']}h", f"Last week: {shift_ctx['prev_week_hours']}h"],
            "actions": [{"label": "Open Shift Monitor", "path": "/shifts"}],
        })

    if task_ctx["overdue"]:
        out.append({
            "id": "overdue",
            "tone": "warning",
            "icon": "☑",
            "title": "Some tasks are past due",
            "message": (f"{task_ctx['overdue']} task{'s are' if task_ctx['overdue'] != 1 else ' is'} open past the deadline. "
                        "Higher operational workload may contribute to reduced recovery — if any of it is blocked, your supervisor can help rebalance."),
            "evidence": [f"{task_ctx['open']} open · {task_ctx['overdue']} overdue"],
            "actions": [
                {"label": "Review in Tasks", "path": "/tasks"},
                {"label": "Talk to your supervisor", "path": "/supervisor"},
            ],
        })

    drop = rest_ctx["sleep_drop_minutes"]
    if drop is not None and drop >= 60:
        out.append({
            "id": "sleep_down",
            "tone": "info",
            "icon": "☾",
            "title": "Sleep is below your usual pattern",
            "message": (f"Last night you slept {int((rest_ctx['sleep_minutes'] or 0) // 60)}h {int((rest_ctx['sleep_minutes'] or 0) % 60)}m — "
                        f"about {round(drop / 60 * 10) / 10}h less than your weekly average. Short sleep is the biggest lever on your Recovery Score."),
            "evidence": ["Last night: " + _hm(rest_ctx["sleep_minutes"]),
                         "Week average: " + _hm(rest_ctx["sleep_avg_prev_week"])],
            "actions": [{"label": "Wellness Monitor", "path": "/wellness"},
                        {"label": "Wind down in the De-stress Zone", "path": "/destress"}],
        })

    if rest_ctx["recovery_score"] is not None:
        prev = rest_ctx["recovery_prev"]
        score = rest_ctx["recovery_score"]
        if prev is not None and prev - score >= 3:
            drivers = _recovery_drivers(rest_ctx)
            out.append({
                "id": "recovery_drop",
                "tone": "info",
                "icon": "◉",
                "title": "Your recovery is lower than your recent baseline",
                "message": ("Your Recovery Score fell from " + str(prev) + " to " + str(score)
                            + ". The largest factor changes: " + drivers + ". "
                            + "Support options are below — reaching out early is the smart move."),
                "evidence": _factor_evidence(rest_ctx),
                "actions": [
                    {"label": "Why did my score change?", "path": "/recovery"},
                    {"label": "Request medic follow-up", "path": "/medic"},
                ],
            })

    return out


def _hm(mins):
    if mins is None:
        return "—"
    return f"{int(mins // 60)}h {int(mins % 60)}m"


def _recovery_drivers(rest_ctx) -> str:
    factors = rest_ctx.get("recovery_factors") or {}
    named = [("sleep", "sleep"), ("rest", "rest between shifts"),
             ("shift_load", "weekly shift load"), ("activity", "activity"), ("stress", "self-reported stress")]
    scored = [(label, factors.get(key, 0)) for key, label in named if key in factors]
    scored.sort(key=lambda kv: kv[1])
    return ", ".join(label for label, _ in scored[:2])


def _factor_evidence(rest_ctx) -> list:
    inputs = rest_ctx.get("recovery_inputs") or {}
    out = []
    if inputs.get("sleep_minutes") is not None:
        out.append("Sleep " + _hm(inputs.get("sleep_minutes")))
    if inputs.get("rest_hours") is not None:
        out.append(f"Rest {inputs.get('rest_hours')}h since duty")
    if inputs.get("week_hours") is not None:
        out.append(f"Load {inputs.get('week_hours')}h/week")
    if inputs.get("stress") is not None:
        out.append(f"Stress {inputs.get('stress')}/5")
    return out


# ---------- support routing ----------

def _support_options(load: dict) -> list:
    """Which support surfaces matter for this load band. Order matters."""
    base = [
        {"icon": "⚑", "title": "Supervisor Connection", "desc": "Rebalance shift or task load", "path": "/supervisor"},
        {"icon": "✚", "title": "Medic Officer", "desc": "Private wellbeing follow-up", "path": "/medic"},
        {"icon": "♪", "title": "De-stress Zone", "desc": "Two-minute reset, any time", "path": "/destress"},
        {"icon": "⇄", "title": "Buddy Connect", "desc": "A trusted person to talk to", "path": "/buddy"},
    ]
    if load["band"] == "steady":
        return base[2:]
    if load["band"] == "elevated":
        return [base[0]] + base[2:]
    return base  # heavy: everything, supervisor first


# ---------- score-change explainability (phase 4) ----------

FACTOR_LABELS = {
    "sleep": "Sleep",
    "rest": "Rest since last shift",
    "shift_load": "Weekly shift load",
    "activity": "Activity",
    "stress": "Self-reported stress",
}


def score_change_explanation(uid: str) -> dict | None:
    """Deterministic 'why did my score change' — compares the last two rows."""
    rows = sorted(data_store.find("recovery_scores", lambda r: r["user_id"] == uid),
                  key=lambda r: r["computed_at"])
    if len(rows) < 2:
        return None
    latest, prev = rows[-1], rows[-2]
    lf, pf = latest.get("factors") or {}, prev.get("factors") or {}
    li, pi = lf.get("inputs") or {}, pf.get("inputs") or {}

    deltas = []
    for key in ("sleep", "rest", "shift_load", "activity", "stress"):
        d = round(lf.get(key, 0) - pf.get(key, 0))
        if d != 0:
            deltas.append({"key": key, "label": FACTOR_LABELS[key], "delta": d,
                           "now": lf.get(key, 0), "prev": pf.get(key, 0),
                           "input_now": _input_text(key, li), "input_prev": _input_text(key, pi)})
    deltas.sort(key=lambda d: abs(d["delta"]), reverse=True)

    total = round(latest["score"] - prev["score"])
    return {
        "score": latest["score"],
        "previous_score": prev["score"],
        "total_change": total,
        "direction": "up" if total > 0 else ("down" if total < 0 else "steady"),
        "factors": deltas,
        "headline": _headline(total, deltas),
        "computed_at": latest["computed_at"],
        "demo": True,
    }


def _input_text(key, inputs):
    if key == "sleep":
        m = inputs.get("sleep_minutes")
        return _hm(m) + " slept" if m is not None else "—"
    if key == "rest":
        h = inputs.get("rest_hours")
        return f"{h}h since last shift" if h is not None else "—"
    if key == "shift_load":
        h = inputs.get("week_hours")
        return f"{h}h this week" if h is not None else "—"
    if key == "activity":
        return f"{(inputs.get('steps') or 0):,} steps"
    if key == "stress":
        v = inputs.get("stress")
        return f"rated {v} of 5" if v is not None else "—"
    return "—"


def _headline(total, deltas) -> str:
    if total == 0 or not deltas:
        return "Your score held steady since yesterday — the factors moved little."
    lead = deltas[0]
    direction = "improved" if total > 0 else "decreased"
    verb = "helped" if total > 0 else "cost"
    others = deltas[1:3]
    parts = [f"Your recovery {direction} by {abs(total)} points since yesterday, primarily because your {lead['label'].lower()} "
             f"{'gained' if lead['delta'] > 0 else 'lost'} {abs(lead['delta'])} points "
             f"({lead['input_prev']} → {lead['input_now']})."]
    if others:
        parts.append("Also: " + "; ".join(
            f"{d['label'].lower()} {verb} {abs(d['delta'])} ({d['input_prev']} → {d['input_now']})" for d in others) + ".")
    parts.append("Every factor is shown with its points on this page — nothing hidden.")
    return " ".join(parts)


# ---------- timeline (phase 11 support) ----------

def timeline(uid: str, limit: int = 60) -> list:
    """The user's recent journey across modules, newest first.

    Joins events the user can verify on their own pages — never private
    content from other people, never wellness values anyone else can see.
    """
    events = []

    now = datetime.now()
    for s in data_store.find("shifts", lambda s: s["user_id"] == uid):
        start = _parse(s["start_at"])
        end = _parse(s["end_at"])
        dur = _hours(start, end)
        if start > now:
            events.append({"at": s["start_at"], "icon": "◐", "kind": "shift",
                           "title": f"Shift scheduled — {_hm(dur * 60)}",
                           "detail": s.get("notes") or None,
                           "path": "/shifts"})
            continue
        events.append({"at": s["start_at"], "icon": "◐", "kind": "shift",
                       "title": f"Shift started — {_hm(dur * 60)}",
                       "detail": s.get("notes") or ("Extended duty" if dur > 12 else None),
                       "path": "/shifts"})
        if end <= now:
            events.append({"at": s["end_at"], "icon": "◉", "kind": "shift_end",
                           "title": f"Shift ended after {round(dur, 1)}h" + (" — extended" if dur > 12 else ""),
                           "detail": None, "path": "/shifts"})

    for t in data_store.find("tasks", lambda t: t["assignee_id"] == uid):
        events.append({"at": t["created_at"], "icon": "☑", "kind": "task",
                       "title": f"Task assigned: {t['title']}",
                       "detail": f"Priority {t['priority']}", "path": "/tasks"})
        if t["status"] == "completed":
            events.append({"at": t.get("updated_at") or t["created_at"], "icon": "✓", "kind": "task_done",
                           "title": f"Task completed: {t['title']}", "detail": None, "path": "/tasks"})

    for r in data_store.find("medic_requests", lambda r: r["user_id"] == uid):
        events.append({"at": r["created_at"], "icon": "✚", "kind": "support",
                       "title": "Medic support requested",
                       "detail": r.get("category", "").replace("_", " "), "path": "/medic"})
    for r in data_store.find("supervisor_requests", lambda r: r["user_id"] == uid):
        events.append({"at": r["created_at"], "icon": "⚑", "kind": "support",
                       "title": "Supervisor support requested",
                       "detail": r.get("category", "").replace("_", " "), "path": "/supervisor"})

    for i in data_store.find("incidents", lambda i: i["reporter_id"] == uid):
        events.append({"at": i["created_at"], "icon": "△", "kind": "incident",
                       "title": f"Incident reported ({i.get('severity', '')} severity)",
                       "detail": f"Status: {i.get('status', '').replace('_', ' ')}", "path": "/incidents"})

    for r in data_store.find("recovery_scores", lambda r: r["user_id"] == uid):
        if r.get("score") is None:
            continue
        events.append({"at": r["computed_at"], "icon": "◉", "kind": "recovery",
                       "title": f"Recovery Score updated: {r['score']}/100",
                       "detail": None, "path": "/recovery"})

    # Intelligence loop events — the user's own record only.
    import interventions
    catalog = {c["id"]: c for c in interventions.catalog_view()}
    followups = {f["event_id"]: f for f in data_store.find("intervention_followups", lambda f: f["user_id"] == uid)}
    for e in data_store.find("intervention_events", lambda e: e["user_id"] == uid):
        item = catalog.get(e["intervention_id"], {"label": e["intervention_id"], "icon": "✦"})
        fu = followups.get(e["id"])
        ch = (fu or {}).get("observed_change")
        events.append({"at": e["created_at"], "icon": item["icon"], "kind": "support_loop",
                       "title": f"Support engaged: {item['label']}",
                       "detail": ((f"observed recovery change {ch:+d}" if ch is not None
                                   else "follow-up pending") + " · observational"),
                       "path": "/recovery"})
    for c in data_store.find("wellbeing_checkins", lambda c: c["user_id"] == uid):
        events.append({"at": c["created_at"], "icon": "☰", "kind": "wellbeing",
                       "title": f"Weekly wellbeing check-in: {c['score']}/100",
                       "detail": "self-reflection, not a diagnosis", "path": "/wellbeing"})
    for a in data_store.find("anomaly_events", lambda a: a["user_id"] == uid):
        events.append({"at": a["detected_at"], "icon": "🛡", "kind": "anomaly",
                       "title": f"On-device pattern check: {(a.get('status') or '').replace('_', ' ')}",
                       "detail": f"confidence {a.get('confidence')} · computed locally, minimal result stored",
                       "path": "/wellbeing"})

    events.sort(key=lambda e: e["at"], reverse=True)
    return events[:limit]
