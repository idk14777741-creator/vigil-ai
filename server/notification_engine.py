"""Notification engine for VIGIL AI — Phase 15.

Runs at startup (demo) and, in live mode, from a scheduler. Two jobs:

1. Weekly digests (idempotent per week, deduped by exact title):
   - personnel: "your weekly report is ready" once the week closes
   - supervisors: a workload-only team digest (requests, incidents, tasks)

2. Gentle reminders after the demo time re-anchor:
   - next shift within 24h  → kind "shift"
   - tasks due today/overdue → kind "task"

Dedup rule: a digest/reminder is skipped when an unread notification with
the same (user_id, kind, title) already exists — restarts never spam.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import data_store
import weekly_report


def _notify(user_id, kind, title, body, link):
    """Insert unless an unread duplicate (user, kind, title) exists."""
    dup = data_store.find_one("notifications",
                              lambda n: n["user_id"] == user_id and n["kind"] == kind
                              and n["title"] == title and not n.get("read_at"))
    if dup:
        return False
    data_store.insert("notifications", {
        "id": data_store.new_id("ntf"), "user_id": user_id, "kind": kind,
        "title": title, "body": body[:300], "link": link,
        "read_at": None, "created_at": data_store.now_iso(),
    })
    return True


# ---------- weekly digests ----------

def weekly_digests(now: datetime | None = None) -> int:
    """Report-ready pings + supervisor team digests for the closing week."""
    now = now or datetime.now()
    sent = 0

    for p in data_store.find("profiles", lambda x: x["role"] == "personnel"):
        week = weekly_report.compute(p["id"], now)
        recovery = week.get("recovery") or {}
        tasks = week.get("tasks") or {}
        body = "Your weekly report is ready — a calm look at your week"
        if recovery.get("avg") is not None:
            body += f": recovery averaged {recovery['avg']}"
        if tasks.get("completed"):
            body += f", {tasks['completed']} task{'s' if tasks['completed'] != 1 else ''} completed"
        body += ". Only you can see it."
        if _notify(p["id"], "system", "Your weekly report is ready", body, "/report"):
            sent += 1

    for sup in data_store.find("profiles", lambda x: x["role"] == "supervisor"):
        digest = team_digest(sup["id"], now)
        if digest and _notify(sup["id"], "system", "Your week in view — team digest",
                              digest, "/supervisor"):
            sent += 1
    return sent


def team_digest(supervisor_id: str, now: datetime | None = None) -> str:
    """Workload-only summary for a supervisor. No wellness, ever."""
    now = now or datetime.now()
    week_ago = now - timedelta(days=7)
    cutoff = week_ago.isoformat(timespec="seconds")

    sup_reqs = [r for r in data_store.find("supervisor_requests", lambda r: True)
                if r.get("created_at", "") >= cutoff]
    incidents = [i for i in data_store.find("incidents", lambda i: True)
                 if i.get("created_at", "") >= cutoff]
    open_reqs = [r for r in data_store.find("supervisor_requests", lambda r: True)
                 if r["status"] in ("open", "acknowledged", "in_progress")]
    open_incidents = [i for i in data_store.find("incidents", lambda i: True)
                      if i["status"] in ("submitted", "under_review", "action_taken")]

    bits = []
    if sup_reqs:
        bits.append(f"{len(sup_reqs)} new request{'s' if len(sup_reqs) != 1 else ''} from your team this week")
    if incidents:
        bits.append(f"{len(incidents)} incident report{'s' if len(incidents) != 1 else ''} filed")
    if open_reqs:
        bits.append(f"{len(open_reqs)} request{'s' if len(open_reqs) != 1 else ''} still in flight")
    if open_incidents:
        bits.append(f"{len(open_incidents)} incident{'s' if len(open_incidents) != 1 else ''} awaiting closure")
    if not bits:
        return "A quiet week — no new requests or incidents. Nothing needs your attention."
    return " · ".join(bits) + ". Nothing here touches anyone's wellness data."


# ---------- gentle reminders (demo re-anchor follow-up) ----------

def reminders(now: datetime | None = None) -> int:
    now = now or datetime.now()
    horizon = (now + timedelta(hours=24)).isoformat(timespec="seconds")
    today_end = now.replace(hour=23, minute=59, second=59).isoformat(timespec="seconds")
    now_iso = now.isoformat(timespec="seconds")
    sent = 0

    for p in data_store.find("profiles", lambda x: x["role"] == "personnel"):
        uid = p["id"]
        # Next shift within 24h and not already on shift.
        upcoming = [s for s in data_store.find("shifts", lambda s: s["user_id"] == uid
                                               and s["status"] == "scheduled")
                    if now_iso <= s["start_at"] <= horizon]
        if upcoming:
            s = min(upcoming, key=lambda x: x["start_at"])
            title = f"Shift ahead: {s['start_at'][11:16]} start"
            body = "Your next shift starts within 24 hours. The Shift Monitor has the full picture."
            if _notify(uid, "shift", title, body, "/shifts"):
                sent += 1
        # Tasks due today or overdue.
        tasks = data_store.find("tasks", lambda t: t["assignee_id"] == uid
                                and t["status"] in ("pending", "in_progress", "blocked"))
        due_today = [t for t in tasks if t.get("due_at") and now_iso <= t["due_at"] <= today_end]
        overdue = [t for t in tasks if t.get("due_at") and t["due_at"] < now_iso]
        if due_today:
            t = min(due_today, key=lambda x: x["due_at"])
            title = f"Due today: {t['title'][:60]}"
            if _notify(uid, "task", title,
                       "One of your tasks is due before the day ends. Steady progress counts.", "/tasks"):
                sent += 1
        if overdue:
            t = min(overdue, key=lambda x: x["due_at"])
            title = f"Past due: {t['title'][:60]}"
            if _notify(uid, "task", title,
                       "This one slipped past its due date. If it's blocked, your supervisor can help.", "/tasks"):
                sent += 1
    return sent


def run_all() -> dict:
    """Startup hook: digests + reminders. Returns counts for the log line."""
    digest_count = 0
    reminder_count = 0
    try:
        digest_count = weekly_digests()
    except Exception as exc:  # never block startup on notifications
        print(f"[notifications] digest error: {exc}")
    try:
        reminder_count = reminders()
    except Exception as exc:
        print(f"[notifications] reminder error: {exc}")
    if digest_count or reminder_count:
        data_store.save()
    return {"digests": digest_count, "reminders": reminder_count}
