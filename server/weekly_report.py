"""Weekly Report for VIGIL AI — Phase 7.

Assembles the week (Mon–Sun rolling last 7 days ending today) into one calm
review: workload, tasks, wellness, recovery, support activity, plus an
optional AI summary (mock provider in demo mode, clearly labelled).

Personal reflections are stored per user/week in weekly_reports.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import data_store


def _parse(iso):
    # Demo data mixes naive local stamps with aware now_iso() stamps; compare naive.
    dt = datetime.fromisoformat(iso)
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


def _day_start(dt):
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _avg(values):
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals)) if vals else None


def compute(uid: str, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    week_start = _day_start(now) - timedelta(days=6)
    week_end = now

    # ---------- workload ----------
    shifts = [s for s in data_store.find("shifts", lambda s: s["user_id"] == uid)
              if week_start <= _parse(s["start_at"]) <= week_end]
    hours = round(sum((_parse(s["end_at"]) - _parse(s["start_at"])).total_seconds() / 3600 for s in shifts), 1)
    longest = max(((_parse(s["end_at"]) - _parse(s["start_at"])).total_seconds() / 3600 for s in shifts), default=0.0)
    workload = {
        "shifts": len(shifts),
        "hours": hours,
        "longest_shift_h": round(longest, 1),
        "break_minutes": sum(s.get("break_minutes") or 0 for s in shifts),
        "extended_shifts": len([s for s in shifts
                                if (_parse(s["end_at"]) - _parse(s["start_at"])).total_seconds() / 3600 > 12]),
    }

    # ---------- tasks ----------
    tasks = data_store.find("tasks", lambda t: t["assignee_id"] == uid)
    def in_week(t):
        stamp = t.get("updated_at") or t.get("created_at")
        try:
            return week_start <= _parse(stamp) <= week_end
        except (ValueError, TypeError):
            return False
    completed = [t for t in tasks if t["status"] == "completed" and in_week(t)]
    open_now = [t for t in tasks if t["status"] in ("pending", "in_progress", "blocked")]
    overdue = [t for t in open_now if t.get("due_at") and t["due_at"] < now.isoformat(timespec="seconds")]
    tasks_view = {
        "completed": len(completed),
        "open": len(open_now),
        "overdue": len(overdue),
        "completed_titles": [t["title"] for t in completed[:4]],
    }

    # ---------- wellness ----------
    wellness_rows = sorted([w for w in data_store.find("wellness_data", lambda w: w["user_id"] == uid)
                            if week_start <= _parse(w["recorded_at"]) <= week_end],
                           key=lambda w: w["recorded_at"])
    prior_rows = sorted([w for w in data_store.find("wellness_data", lambda w: w["user_id"] == uid)
                         if week_start - timedelta(days=7) <= _parse(w["recorded_at"]) < week_start],
                        key=lambda w: w["recorded_at"])
    wellness_view = {
        "sleep_avg_minutes": _avg([w.get("sleep_minutes") for w in wellness_rows]),
        "sleep_prior_minutes": _avg([w.get("sleep_minutes") for w in prior_rows]),
        "sleep_quality_avg": (lambda v: round(sum(v) / len(v), 1) if v else None)([w.get("sleep_quality") for w in wellness_rows if w.get("sleep_quality") is not None]),
        "hr_avg": _avg([w.get("heart_rate") for w in wellness_rows]),
        "spo2_avg": _avg([w.get("spo2") for w in wellness_rows]),
        "steps_avg": (lambda v: round(sum(v) / len(v)) if v else None)([w.get("steps") for w in wellness_rows if w.get("steps") is not None]),
        "stress_avg": (lambda v: round(sum(v) / len(v), 1) if v else None)([w.get("stress_self_report") for w in wellness_rows if w.get("stress_self_report") is not None]),
        "series_dates": [w["recorded_at"][:10] for w in wellness_rows],
        "series_sleep_hours": [round(w["sleep_minutes"] / 60.0, 1) if w.get("sleep_minutes") else None for w in wellness_rows],
        "series_hr": [w.get("heart_rate") for w in wellness_rows],
    }

    # ---------- recovery ----------
    rec_rows = sorted([r for r in data_store.find("recovery_scores", lambda r: r["user_id"] == uid)
                       if week_start <= _parse(r["computed_at"]) <= week_end],
                      key=lambda r: r["computed_at"])
    recovery_view = {
        "avg": _avg([r["score"] for r in rec_rows]),
        "low": min((r["score"] for r in rec_rows), default=None),
        "high": max((r["score"] for r in rec_rows), default=None),
        "series": [{"date": r["computed_at"][:10], "score": r["score"]} for r in rec_rows],
        "latest": rec_rows[-1]["score"] if rec_rows else None,
    }

    # ---------- support ----------
    medic = [r for r in data_store.find("medic_requests", lambda r: r["user_id"] == uid)
             if week_start <= _parse(r["created_at"]) <= week_end]
    sup = [r for r in data_store.find("supervisor_requests", lambda r: r["user_id"] == uid)
           if week_start <= _parse(r["created_at"]) <= week_end]
    resolved = len([r for r in medic + sup if r["status"] == "resolved"])
    support_view = {
        "raised": len(medic) + len(sup),
        "resolved_in_week": resolved,
        "open": len([r for r in medic + sup if r["status"] in ("open", "acknowledged", "in_progress")]),
    }

    highlights = _highlights(workload, tasks_view, wellness_view, recovery_view, support_view)

    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "label": f"{week_start.strftime('%d %b')} – {now.strftime('%d %b %Y')}",
        "workload": workload,
        "tasks": tasks_view,
        "wellness": wellness_view,
        "recovery": recovery_view,
        "support": support_view,
        "highlights": highlights,
        "ai_summary": _mock_ai_summary(uid, workload, tasks_view, wellness_view, recovery_view),
        "reflection": data_store.find_one("weekly_reports", lambda r: r["user_id"] == uid and r["week_start"] == week_start.isoformat(timespec="seconds")),
        "demo": True,
    }


# ---------- highlights ----------

def _highlights(workload, tasks, wellness, recovery, support):
    out = []
    if workload["extended_shifts"]:
        out.append(f"{workload['extended_shifts']} extended shift{'' if workload['extended_shifts'] == 1 else 's'} this week — extra rest earned.")
    if recovery["avg"] is not None:
        if recovery["avg"] >= 70:
            out.append(f"Recovery averaged {recovery['avg']} — a steady week.")
        elif recovery["avg"] >= 45:
            out.append(f"Recovery averaged {recovery['avg']} — moderate; protect sleep where you can.")
        else:
            out.append(f"Recovery averaged {recovery['avg']} — a heavier week than usual; rest is the priority.")
    if tasks["completed"]:
        out.append(f"{tasks['completed']} task{'' if tasks['completed'] == 1 else 's'} completed.")
    if tasks["overdue"]:
        out.append(f"{tasks['overdue']} task{'' if tasks['overdue'] == 1 else 's'} still open past due — worth a look when you're ready.")
    if wellness["sleep_avg_minutes"] is not None:
        h, m = divmod(wellness["sleep_avg_minutes"], 60)
        out.append(f"Sleep averaged {int(h)}h {int(m)}m a night.")
    if support["raised"]:
        out.append(f"You raised {support['raised']} support request{'' if support['raised'] == 1 else 's'} — following up is a strength.")
    if not out:
        out.append("A quiet week — nothing unusual to flag.")
    return out


# ---------- mock AI summary ----------

def _mock_ai_summary(uid, workload, tasks, wellness, recovery):
    """Deterministic template summary. Labelled as AI (mock) in the UI.

    A live LLM provider receives the same facts via the Phase 8 abstraction —
    the summary prompt will live server-side and never expose keys.
    """
    bits = []
    if workload["hours"]:
        bits.append(f"You worked {workload['hours']} hours across {workload['shifts']} shifts")
        if workload["extended_shifts"]:
            bits.append(f"including {workload['extended_shifts']} extended shift")
        bits.append("this week.")
    if tasks["completed"]:
        bits.append(f"You completed {tasks['completed']} task{'' if tasks['completed'] == 1 else 's'}")
        if tasks["open"]:
            bits.append(f"and {tasks['open']} remain open")
        bits.append(".")
    if wellness["sleep_avg_minutes"] is not None:
        h, m = divmod(wellness["sleep_avg_minutes"], 60)
        trend = ""
        if wellness["sleep_prior_minutes"]:
            d = wellness["sleep_avg_minutes"] - wellness["sleep_prior_minutes"]
            trend = (" — a little more than last week" if d >= 20 else
                     " — a little less than last week" if d <= -20 else
                     ", steady versus last week")
        bits.append(f"Sleep averaged {int(h)}h {int(m)}m{trend}.")
    if recovery["avg"] is not None:
        direction = "held up well" if recovery["avg"] >= 70 else "ran lower than usual"
        bits.append(f"Your recovery {direction} (average {recovery['avg']}/100).")
    if workload["hours"] > 45 or (recovery["avg"] is not None and recovery["avg"] < 50):
        bits.append("That's a demanding combination — prioritise rest and consider a word with your supervisor about next week's rota.")
    else:
        bits.append("Overall, a solid rhythm. Keep the balance that's working for you.")
    summary = " ".join(bits)
    # Reflection prompt suggestion
    summary += " How does the week feel from your side? A short reflection below helps you — and only you — see it."
    return summary


# ---------- reflections ----------

def save_reflection(uid: str, week_start_iso: str, text: str) -> dict:
    text = text.strip()[:2000]
    row = data_store.find_one("weekly_reports",
                              lambda r: r["user_id"] == uid and r["week_start"] == week_start_iso)
    if row:
        data_store.update("weekly_reports",
                          lambda r: r["id"] == row["id"],
                          {"reflection": text, "updated_at": data_store.now_iso()})
        row = data_store.find_one("weekly_reports", lambda r: r["id"] == row["id"])
    else:
        row = data_store.insert("weekly_reports", {
            "id": data_store.new_id("wrp"),
            "user_id": uid,
            "week_start": week_start_iso,
            "reflection": text,
            "ai_summary": None,
            "created_at": data_store.now_iso(),
            "updated_at": data_store.now_iso(),
        })
    return row
