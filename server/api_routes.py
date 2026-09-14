"""Feature API routes for VIGIL AI — Phase 1 scope.

  GET  /api/health                     public liveness + mode
  GET  /api/users/lookup?q=            people search (auth)
  GET  /api/my/dashboard               aggregate overview: shifts, tasks, wellness, recovery (Phase 2)
  GET  /api/my/shifts                   Shift Monitor: status, flags, weekly stats, history (Phase 3)
  GET  /api/team/shifts                 supervisor: workload stats for assigned personnel (Phase 3)
  GET  /api/my/wellness                 wellness trends + insights (simulated, Phase 5)
  GET  /api/my/recovery                 recovery score history + suggestions (Phase 6)
  GET  /api/my/report                   weekly report (Phase 7)
  POST /api/my/report/reflection        save personal reflection (Phase 7)
  GET  /api/my/tasks                    own tasks (q, status, priority filters) (Phase 4)
  POST /api/tasks                       create + assign task (supervisor/admin) (Phase 4)
  GET  /api/tasks/{id}                  task detail (assignee, creator, or admin) (Phase 4)
  PATCH /api/tasks/{id}                 progress/status/remarks (assignee) or edit (creator/admin) (Phase 4)
  PATCH /api/me                        update own profile
  POST /api/me/password                change own password
  GET  /api/notifications              own notifications
  POST /api/notifications/read         mark read
  GET  /api/my/team                    unit teammates / assigned personnel
  GET  /api/admin/overview             admin dashboard counts
  GET  /api/admin/users?q=&role=       user management (admin)
  POST /api/admin/users                create user (admin)
  PATCH /api/admin/users/{id}          role / status / details (admin)
  POST /api/admin/notifications        broadcast notification (admin)
  GET  /api/admin/audit                audit log (admin)
  GET  /api/admin/integrations         integration status, no secrets (admin)
  POST /api/admin/reset-demo           wipe + reseed demo store (demo mode only)
  GET  /api/admin/export               full JSON backup of every collection (admin)
"""
import json
import re

import config
import data_store
from auth_api import current_profile, profile_public
from security import hash_password, password_problem, sanitize_text, valid_email, valid_name

_VALID_ROLES = {"personnel", "medic", "supervisor", "admin"}
_AVATAR_COLORS = {"teal", "blue", "violet", "amber", "rose", "green"}
_PHONE_RE = re.compile(r"^[0-9+()\-\s]{0,20}$")


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def _no_match():
    return None, None, None


def handle(method: str, path: str, ctx: dict):
    if method == "GET" and path == "/api/health":
        return _res(200, {"ok": True, "mode": config.MODE, "version": config.APP_VERSION})

    # AI routes handle their own session auth (mounted before the general gate).
    if path.startswith("/api/ai/"):
        import ai_api
        result = ai_api.handle(method, path, ctx)
        if result != _no_match():
            return result

    # Media routes handle their own session auth.
    if path.startswith("/api/music") or path.startswith("/api/videos"):
        import media_api
        result = media_api.handle(method, path, ctx)
        if result != _no_match():
            return result

    # Buddy routes handle their own session auth.
    if path.startswith("/api/buddy"):
        import buddy_api
        result = buddy_api.handle(method, path, ctx)
        if result != _no_match():
            return result

    # Message From Home (own session auth, plus invite-code upload).
    if path.startswith("/api/home"):
        import home_api
        result = home_api.handle(method, path, ctx)
        if result != _no_match():
            return result

    # Medic Connection (own session auth).
    if path.startswith("/api/medic"):
        import medic_api
        result = medic_api.handle(method, path, ctx)
        if result != _no_match():
            return result

    # Supervisor Connection (own session auth).
    if path.startswith("/api/supervisor"):
        import supervisor_api
        result = supervisor_api.handle(method, path, ctx)
        if result != _no_match():
            return result

    # Incident Reporting (own session auth).
    if path.startswith("/api/incidents"):
        import incident_api
        result = incident_api.handle(method, path, ctx)
        if result != _no_match():
            return result

    # Auth and public endpoints are handled by auth_api — never gate them here.
    if path.startswith("/api/auth/") or path == "/api/demo-accounts" or path.startswith("/api/ai/") or path.startswith("/api/music") or path.startswith("/api/videos") or path.startswith("/api/buddy") or path.startswith("/api/home") or path.startswith("/api/medic") or path.startswith("/api/supervisor") or path.startswith("/api/incidents"):
        return _no_match()

    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Please sign in to continue."})

    # ---- self-service ----
    if method == "PATCH" and path == "/api/me":
        return update_me(profile, ctx.get("body") or {}, ctx)
    if method == "POST" and path == "/api/me/password":
        return change_password(profile, ctx.get("body") or {}, ctx)

    if method == "GET" and path == "/api/users/lookup":
        return users_lookup(profile, ctx.get("query", {}))

    # ---- notifications ----
    if method == "GET" and path == "/api/notifications":
        return list_notifications(profile, ctx.get("query", {}))
    if method == "POST" and path == "/api/notifications/read":
        return mark_read(profile, ctx.get("body") or {})

    # ---- team ----
    if method == "GET" and path == "/api/my/team":
        return my_team(profile)

    # ---- dashboard aggregate (Phase 2) ----
    if method == "GET" and path == "/api/my/dashboard":
        return my_dashboard(profile)

    # ---- shift monitor (Phase 3) ----
    if method == "GET" and path == "/api/my/shifts":
        return my_shifts(profile)
    if method == "GET" and path == "/api/team/shifts":
        return team_shifts(profile)

    # ---- wellness monitor (Phase 5) ----
    if method == "GET" and path == "/api/my/wellness":
        return my_wellness(profile)

    # ---- recovery score (Phase 6) ----
    if method == "GET" and path == "/api/my/recovery":
        return my_recovery(profile)

    # ---- weekly report (Phase 7) ----
    if method == "GET" and path == "/api/my/report":
        return my_report(profile)
    if method == "POST" and path == "/api/my/report/reflection":
        return save_reflection_route(profile, ctx.get("body") or {}, ctx)

    # ---- task management (Phase 4) ----
    if method == "GET" and path == "/api/my/tasks":
        return my_tasks(profile, ctx.get("query", {}))
    if method == "POST" and path == "/api/tasks":
        return task_create(profile, ctx.get("body") or {}, ctx)
    if method == "GET" and path.startswith("/api/tasks/"):
        return task_detail(profile, path.rsplit("/", 1)[-1])
    if method == "PATCH" and path.startswith("/api/tasks/"):
        return task_update(profile, path.rsplit("/", 1)[-1], ctx.get("body") or {}, ctx)

    # ---- admin ----
    if path.startswith("/api/admin/") and profile["role"] != "admin":
        data_store.audit(profile["id"], "security.admin_denied", target=path, ip=ctx.get("ip", ""))
        return _res(403, {"error": "You do not have permission to do that."})

    if method == "POST" and path == "/api/admin/reset-demo":
        if config.MODE != "demo":
            return _res(403, {"error": "Demo reset is disabled in live mode."})
        import seed_data
        import demo_data
        from auth_api import sessions
        sessions.revoke_all()
        data_store.reset()
        seed_data.seed_if_empty()
        demo_data.build_all()
        try:
            import notification_engine
            notification_engine.run_all()
        except Exception:
            pass
        data_store.audit(profile["id"], "admin.demo_reset", target="demo environment")
        data_store.save()
        return _res(200, {"ok": True, "message": "Demo environment reset to a fresh seed."})
    if method == "GET" and path == "/api/admin/export":
        import json as _json
        import copy
        snapshot = copy.deepcopy(data_store.db())
        # Security: never export credential material.
        for p in snapshot.get("profiles", []):
            p.pop("password_hash", None)
        for r in snapshot.get("password_resets", []):
            r["token"] = "[redacted]"
        snapshot["meta"]["exported_at"] = data_store.now_iso()
        payload = _json.dumps(snapshot, default=str).encode()
        stamp = data_store.now_iso()[:10]
        return _res(200, payload, {
            "Content-Type": "application/json",
            "Content-Disposition": f'attachment; filename="vigil-backup-{stamp}.json"',
        })
    if method == "GET" and path == "/api/admin/integrations":
        import integrations
        report = integrations.status()
        report["supabase_ping"] = integrations.ping_supabase() if report["categories"]["supabase"]["anon_key_set"] else None
        return _res(200, report)
    if method == "GET" and path == "/api/admin/overview":
        return admin_overview(profile)
    if method == "GET" and path == "/api/admin/users":
        return admin_users(profile, ctx.get("query", {}))
    if method == "POST" and path == "/api/admin/users":
        return admin_create_user(profile, ctx.get("body") or {}, ctx)
    if method == "PATCH" and path.startswith("/api/admin/users/"):
        return admin_update_user(profile, path.rsplit("/", 1)[-1], ctx.get("body") or {}, ctx)
    if method == "POST" and path == "/api/admin/notifications":
        return admin_broadcast(profile, ctx.get("body") or {}, ctx)
    if method == "GET" and path == "/api/admin/audit":
        return admin_audit(profile, ctx.get("query", {}))

    return _no_match()


# ---------- self-service ----------

def update_me(profile, body, ctx):
    patch = {}
    if "full_name" in body:
        name = sanitize_text(body.get("full_name"), 80)
        if not valid_name(name):
            return _res(400, {"error": "Please enter a valid full name."})
        patch["full_name"] = name
    if "phone" in body:
        phone = (body.get("phone") or "").strip()
        if not _PHONE_RE.match(phone):
            return _res(400, {"error": "Phone can contain digits, spaces and + ( ) - only."})
        patch["phone"] = phone
    if "avatar_color" in body:
        color = body.get("avatar_color")
        if color not in _AVATAR_COLORS:
            return _res(400, {"error": "Unknown avatar color."})
        patch["avatar_color"] = color
    if "unit_id" in body and body.get("unit_id") is not None:
        unit = data_store.find_one("units", lambda u: u["id"] == body.get("unit_id"))
        if not unit:
            return _res(400, {"error": "Unknown unit."})
        patch["unit_id"] = unit["id"]
    if not patch:
        return _res(400, {"error": "Nothing to update."})
    data_store.update("profiles", lambda p: p["id"] == profile["id"], patch)
    data_store.audit(profile["id"], "profile.update", detail={"fields": sorted(patch)})
    updated = data_store.find_one("profiles", lambda p: p["id"] == profile["id"])
    return _res(200, {"user": profile_public(updated)})


def change_password(profile, body, ctx):
    from security import verify_password
    current = body.get("current_password") or ""
    new = body.get("new_password") or ""
    if not verify_password(current, profile.get("password_hash", "")):
        return _res(401, {"error": "Current password is incorrect."})
    problem = password_problem(new)
    if problem:
        return _res(400, {"error": problem})
    if verify_password(new, profile.get("password_hash", "")):
        return _res(400, {"error": "New password must be different from the current one."})
    data_store.update("profiles", lambda p: p["id"] == profile["id"], {"password_hash": hash_password(new)})
    data_store.audit(profile["id"], "auth.password_changed", ip=ctx.get("ip", ""))
    return _res(200, {"ok": True, "message": "Password changed."})


def users_lookup(profile, query):
    q = sanitize_text(query.get("q", ""), 80).lower()
    if len(q) < 2:
        return _res(200, {"results": []})
    rows = data_store.find("profiles", lambda p: p.get("status") == "active" and (
        q in p["full_name"].lower() or q in p["email"].lower()))
    rows.sort(key=lambda p: p["full_name"])
    return _res(200, {"results": [{
        "id": p["id"], "full_name": p["full_name"], "role": p["role"], "unit_id": p.get("unit_id"),
    } for p in rows[:10]]})


# ---------- notifications ----------

def list_notifications(profile, query):
    rows = data_store.find("notifications", lambda n: n["user_id"] == profile["id"])
    rows.sort(key=lambda n: n.get("created_at", ""), reverse=True)
    limit = min(int(query.get("limit", "50") or 50), 200)
    return _res(200, {"notifications": rows[:limit]})


def mark_read(profile, body):
    ids = body.get("ids")
    if body.get("all"):
        data_store.update("notifications", lambda n: n["user_id"] == profile["id"] and not n.get("read_at"),
                          {"read_at": data_store.now_iso()})
    elif isinstance(ids, list) and ids:
        safe = {str(i) for i in ids[:100]}
        data_store.update("notifications",
                          lambda n: n["user_id"] == profile["id"] and n["id"] in safe and not n.get("read_at"),
                          {"read_at": data_store.now_iso()})
    else:
        return _res(400, {"error": "Provide notification ids or all=true."})
    return _res(200, {"ok": True})


# ---------- dashboard aggregate (Phase 2) ----------

def my_dashboard(profile):
    """One call powering the personnel dashboard. Demo data only — labelled client-side."""
    uid = profile["id"]
    now = data_store.now_iso()

    shifts = data_store.find("shifts", lambda s: s["user_id"] == uid)
    shifts.sort(key=lambda s: s["start_at"])
    active = next((s for s in shifts if s["status"] == "active"), None)
    upcoming = [s for s in shifts if s["status"] == "scheduled"]
    completed = [s for s in shifts if s["status"] == "completed"]  # chronological
    last_completed = completed[-1] if completed else None

    tasks = data_store.find("tasks", lambda t: t["assignee_id"] == uid)
    tasks.sort(key=lambda t: t["due_at"] or "9999")
    open_tasks = [t for t in tasks if t["status"] in ("pending", "in_progress", "blocked")]
    today_end = _day_end(now)
    due_today = [t for t in open_tasks if t["due_at"] and t["due_at"] <= today_end]
    overdue = [t for t in open_tasks if t["due_at"] and t["due_at"] < now]

    wellness = sorted(data_store.find("wellness_data", lambda w: w["user_id"] == uid),
                      key=lambda w: w["recorded_at"])
    latest_w = wellness[-1] if wellness else None
    trend_w = wellness[-8:-1] or []  # week before today
    def _avg(rows, key):
        vals = [r[key] for r in rows if r.get(key) is not None]
        return round(sum(vals) / len(vals)) if vals else None

    recs = sorted(data_store.find("recovery_scores", lambda r: r["user_id"] == uid),
                  key=lambda r: r["computed_at"])
    latest_r = recs[-1] if recs else None
    prev_r = recs[-2] if len(recs) > 1 else None
    prev_week = recs[-8:-1]

    medic = data_store.find("medic_requests", lambda r: r["user_id"] == uid)
    sup = data_store.find("supervisor_requests", lambda r: r["user_id"] == uid)
    open_support = [r for r in medic + sup if r["status"] in ("open", "acknowledged", "in_progress")]
    open_support.sort(key=lambda r: r["created_at"], reverse=True)

    return _res(200, {
        "shift": {
            "active": active, "upcoming": upcoming[:2], "last_completed": last_completed,
            "completed_count_30d": len([s for s in shifts if s["status"] == "completed" and s["end_at"] >= _days_ago(30)]),
        },
        "tasks": {
            "open": len(open_tasks), "due_today": len(due_today), "overdue": len(overdue),
            "completed_this_week": len([t for t in tasks if t["status"] == "completed" and (t.get("updated_at") or t["created_at"]) >= _days_ago(7)]),
            "next": [pub_task(t) for t in open_tasks[:3]],
      },
        "wellness": {
            "latest": latest_w,
            "sleep_avg_prev_week": _avg(trend_w, "sleep_minutes"),
            "hr_avg_prev_week": _avg(trend_w, "heart_rate"),
        },
        "recovery": {
            "latest": latest_r, "previous": prev_r,
            "avg_prev_week": (round(sum(r["score"] for r in prev_week) / len(prev_week)) if prev_week else None),
        },
        "support": {
            "open_requests": len(open_support),
            "latest": open_support[0] if open_support else None,
        },
        "generated_at": now,
        "demo": True,
    })


def pub_task(t):
    return {"id": t["id"], "title": t["title"], "priority": t["priority"], "status": t["status"],
            "progress": t["progress"], "due_at": t["due_at"], "description": t.get("description", "")}


def _day_end(iso):
    from datetime import datetime, timedelta
    d = datetime.now().replace(hour=23, minute=59, second=59)
    return d.isoformat()


def _days_ago(n):
    from datetime import datetime, timedelta
    return (datetime.now() - timedelta(days=n)).isoformat()


# ---------- shift monitor (Phase 3) ----------

def my_shifts(profile):
    import shift_monitor
    return _res(200, shift_monitor.compute(profile["id"]))


def team_shifts(profile):
    """Supervisor view: weekly workload stats per unit member — operational data only.
    No wellness readings or recovery scores here; those stay with the person and
    the Medic Officer under the privacy model."""
    if profile["role"] not in ("supervisor", "admin"):
        return _res(403, {"error": "Only supervisors can view team shifts."})
    import shift_monitor

    if not profile.get("unit_id"):
        return _res(200, {"unit": None, "members": []})
    member_ids = {m["user_id"] for m in data_store.find("unit_members", lambda m: m["unit_id"] == profile["unit_id"])}
    members = []
    for p in data_store.find("profiles", lambda x: x["id"] in member_ids and x["role"] == "personnel" and x.get("status") == "active"):
        view = shift_monitor.compute(p["id"])
        members.append({
            "id": p["id"], "full_name": p["full_name"], "avatar_color": p.get("avatar_color"),
            "status": view["status"]["kind"],
            "active_shift": view["status"].get("shift"),
            "weekly": view["weekly"]["this"],
            "flag_count": len(view["flags"]),
            "worst_flag": max(view["flags"], key=lambda f: {"warning": 1, "info": 0}.get(f["tone"], 0))["title"] if view["flags"] else None,
            "next_shift_start": view["upcoming"][0]["start_at"] if view["upcoming"] else None,
        })
    members.sort(key=lambda m: ((m["flag_count"] or 0), -(m["weekly"] or {}).get("hours", 0)), reverse=True)
    return _res(200, {"unit": {"id": profile["unit_id"]}, "members": members})


# ---------- wellness monitor (Phase 5) ----------

def my_wellness(profile):
    import wellness
    return _res(200, wellness.compute(profile["id"]))


# ---------- recovery score (Phase 6) ----------

def my_recovery(profile):
    import recovery
    return _res(200, recovery.compute(profile["id"]))


# ---------- weekly report (Phase 7) ----------

def my_report(profile):
    import weekly_report
    return _res(200, weekly_report.compute(profile["id"]))


def save_reflection_route(profile, body, ctx):
    import weekly_report
    from datetime import datetime, timedelta
    text = body.get("reflection") or ""
    if len(text) > 2000:
        return _res(400, {"error": "Reflection is limited to 2000 characters."})
    week_start_iso = body.get("week_start")
    if not week_start_iso:
        week_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=6)
        week_start_iso = week_start.isoformat(timespec="seconds")
    else:
        try:
            datetime.fromisoformat(week_start_iso)
        except ValueError:
            return _res(400, {"error": "Invalid week_start."})
    row = weekly_report.save_reflection(profile["id"], week_start_iso, text)
    data_store.audit(profile["id"], "report.reflection_saved", detail={"chars": len(text)})
    return _res(200, {"reflection": row})


# ---------- task management (Phase 4) ----------

_TASK_PRIORITIES = {"low", "medium", "high", "critical"}
_TASK_STATUSES = {"pending", "in_progress", "blocked", "completed", "cancelled"}


def pub_task_full(t):
    """Task projection including people fields for detail views."""
    assignee = data_store.find_one("profiles", lambda p: p["id"] == t["assignee_id"])
    creator = data_store.find_one("profiles", lambda p: p["id"] == t["created_by"])
    return {
        **pub_task(t),
        "description": t.get("description", ""),
        "remarks": t.get("remarks", ""),
        "assignee": {"id": assignee["id"], "full_name": assignee["full_name"], "avatar_color": assignee.get("avatar_color")} if assignee else None,
        "created_by_name": creator["full_name"] if creator else "Supervisor",
        "created_at": t.get("created_at"),
        "updated_at": t.get("updated_at"),
    }


def my_tasks(profile, query):
    q = sanitize_text(query.get("q", ""), 80).lower()
    status = query.get("status", "")
    priority = query.get("priority", "")
    scope = query.get("scope", "mine")
    if scope == "assigned":
        if profile["role"] not in ("supervisor", "admin"):
            return _res(403, {"error": "Only supervisors can view tasks they assigned."})
        rows = data_store.find("tasks", lambda t: t["created_by"] == profile["id"])
    else:
        rows = data_store.find("tasks", lambda t: t["assignee_id"] == profile["id"])
    if status == "open":
        rows = [t for t in rows if t["status"] in ("pending", "in_progress", "blocked")]
    elif status in _TASK_STATUSES:
        rows = [t for t in rows if t["status"] == status]
    if priority in _TASK_PRIORITIES:
        rows = [t for t in rows if t["priority"] == priority]
    if q:
        rows = [t for t in rows if q in t["title"].lower() or q in (t.get("description") or "").lower()]
    now = data_store.now_iso()
    rows.sort(key=lambda t: (t["status"] not in ("pending", "in_progress", "blocked"),
                             t["due_at"] or "9999"))
    return _res(200, {"tasks": [dict(pub_task(t), overdue=bool(t["status"] in ("pending", "in_progress", "blocked") and t["due_at"] and t["due_at"] < now)) for t in rows]})


def _valid_iso_date(value):
    from datetime import datetime
    try:
        datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def task_create(profile, body, ctx):
    if profile["role"] not in ("supervisor", "admin"):
        data_store.audit(profile["id"], "security.task_create_denied", ip=ctx.get("ip", ""))
        return _res(403, {"error": "Only supervisors can assign tasks."})
    title = sanitize_text(body.get("title"), 160)
    description = sanitize_text(body.get("description"), 2000)
    priority = (body.get("priority") or "medium").lower()
    due_at = body.get("due_at") or None
    assignee_id = body.get("assignee_id") or ""
    if len(title) < 2:
        return _res(400, {"error": "Give the task a title (at least 2 characters)."})
    if priority not in _TASK_PRIORITIES:
        return _res(400, {"error": "Choose a valid priority."})
    assignee = data_store.find_one("profiles", lambda p: p["id"] == assignee_id and p.get("status") == "active")
    if not assignee:
        return _res(400, {"error": "Choose a valid assignee."})
    if due_at and not _valid_iso_date(due_at):
        return _res(400, {"error": "Due date is not a valid date."})
    task = {
        "id": data_store.new_id("tsk"), "title": title, "description": description,
        "assignee_id": assignee_id, "created_by": profile["id"], "unit_id": assignee.get("unit_id"),
        "priority": priority, "status": "pending", "progress": 0,
        "due_at": due_at, "remarks": "",
        "created_at": data_store.now_iso(), "updated_at": data_store.now_iso(),
    }
    data_store.insert("tasks", task)
    data_store.insert("notifications", {
        "id": data_store.new_id("ntf"), "user_id": assignee_id, "kind": "task",
        "title": "New task assigned",
        "body": f"{profile['full_name']} assigned you: {title}",
        "link": "/tasks", "read_at": None, "created_at": data_store.now_iso(),
    })
    data_store.audit(profile["id"], "task.created", target=task["id"], detail={"assignee": assignee_id, "priority": priority})
    return _res(201, {"task": pub_task_full(task)})


def task_detail(profile, task_id):
    t = data_store.find_one("tasks", lambda x: x["id"] == task_id)
    if not t:
        return _res(404, {"error": "Task not found."})
    allowed = (t["assignee_id"] == profile["id"] or t["created_by"] == profile["id"] or profile["role"] == "admin")
    if not allowed:
        return _res(403, {"error": "This task is private to its assignee and supervisor."})
    return _res(200, {"task": pub_task_full(t)})


def task_update(profile, task_id, body, ctx):
    t = data_store.find_one("tasks", lambda x: x["id"] == task_id)
    if not t:
        return _res(404, {"error": "Task not found."})
    is_assignee = t["assignee_id"] == profile["id"]
    is_creator = t["created_by"] == profile["id"]
    is_admin = profile["role"] == "admin"
    if not (is_assignee or is_creator or is_admin):
        return _res(403, {"error": "This task is private to its assignee and supervisor."})

    patch = {}
    # Assignee (or admin) may update execution fields
    if is_assignee or is_admin:
        if "progress" in body:
            try:
                progress = int(body["progress"])
            except (TypeError, ValueError):
                return _res(400, {"error": "Progress must be a number from 0 to 100."})
            if not 0 <= progress <= 100:
                return _res(400, {"error": "Progress must be between 0 and 100."})
            patch["progress"] = progress
            if progress == 100 and t["status"] not in ("completed", "cancelled"):
                patch["status"] = "completed"
            elif progress < 100 and t["status"] == "completed":
                patch["status"] = "in_progress"
        if "status" in body:
            status = body["status"]
            if status not in _TASK_STATUSES:
                return _res(400, {"error": "Choose a valid status."})
            patch["status"] = status
            if status == "completed":
                patch["progress"] = 100
        if "remarks" in body:
            patch["remarks"] = sanitize_text(body.get("remarks"), 1000)
    # Creator or admin may edit definition fields
    if is_creator or is_admin:
        if "title" in body:
            title = sanitize_text(body.get("title"), 160)
            if len(title) < 2:
                return _res(400, {"error": "Give the task a title (at least 2 characters)."})
            patch["title"] = title
        if "description" in body:
            patch["description"] = sanitize_text(body.get("description"), 2000)
        if "priority" in body:
            if body["priority"] not in _TASK_PRIORITIES:
                return _res(400, {"error": "Choose a valid priority."})
            patch["priority"] = body["priority"]
        if "due_at" in body:
            if body["due_at"] is None:
                patch["due_at"] = None
            elif _valid_iso_date(body["due_at"]):
                patch["due_at"] = body["due_at"]
            else:
                return _res(400, {"error": "Due date is not a valid date."})
        if "assignee_id" in body:
            new_assignee = data_store.find_one("profiles", lambda p: p["id"] == body["assignee_id"] and p.get("status") == "active")
            if not new_assignee:
                return _res(400, {"error": "Choose a valid assignee."})
            if new_assignee["id"] != t["assignee_id"]:
                patch["assignee_id"] = new_assignee["id"]
                data_store.insert("notifications", {
                    "id": data_store.new_id("ntf"), "user_id": new_assignee["id"], "kind": "task",
                    "title": "New task assigned",
                    "body": f"{profile['full_name']} assigned you: {t['title']}",
                    "link": "/tasks", "read_at": None, "created_at": data_store.now_iso(),
                })
    if not patch:
        return _res(400, {"error": "Nothing to update."})
    patch["updated_at"] = data_store.now_iso()

    completed_now = t["status"] != "completed" and patch.get("status") == "completed"
    data_store.update("tasks", lambda x: x["id"] == task_id, patch)
    if completed_now:
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": t["created_by"], "kind": "task",
            "title": "Task completed",
            "body": f"{profile['full_name']} completed: {t['title']}",
            "link": "/tasks", "read_at": None, "created_at": data_store.now_iso(),
        })
    data_store.audit(profile["id"], "task.updated", target=task_id, detail={"fields": sorted(patch)})
    updated = data_store.find_one("tasks", lambda x: x["id"] == task_id)
    return _res(200, {"task": pub_task_full(updated)})


# ---------- team ----------

def my_team(profile):
    if not profile.get("unit_id"):
        return _res(200, {"unit": None, "members": []})
    unit = data_store.find_one("units", lambda u: u["id"] == profile["unit_id"])
    member_ids = {m["user_id"] for m in data_store.find("unit_members", lambda m: m["unit_id"] == unit["id"])}
    members = [profile_public(p) for p in data_store.find("profiles", lambda p: p["id"] in member_ids and p.get("status") == "active")]
    members.sort(key=lambda p: (p["role"] != "supervisor", p["full_name"]))
    return _res(200, {"unit": {"id": unit["id"], "name": unit["name"], "description": unit.get("description", "")},
                      "members": members})


# ---------- admin ----------

def admin_overview(profile):
    users = data_store.all_rows("profiles")
    by_role = {}
    for u in users:
        by_role[u["role"]] = by_role.get(u["role"], 0) + 1
    recent_audit = data_store.all_rows("audit_logs")[-15:]
    recent_audit.reverse()
    return _res(200, {
        "totals": {"users": len(users), "units": len(data_store.all_rows("units")),
                   "notifications": len(data_store.all_rows("notifications")),
                   "audit_events": len(data_store.all_rows("audit_logs"))},
        "users_by_role": by_role,
        "recent_audit": recent_audit,
    })


def admin_users(profile, query):
    q = sanitize_text(query.get("q", ""), 80).lower()
    role = query.get("role", "")
    rows = data_store.all_rows("profiles")
    if role in _VALID_ROLES:
        rows = [u for u in rows if u["role"] == role]
    if q:
        rows = [u for u in rows if q in u["full_name"].lower() or q in u["email"].lower()]
    rows.sort(key=lambda u: u["full_name"])
    return _res(200, {"users": [profile_public(u) for u in rows]})


def admin_create_user(profile, body, ctx):
    full_name = sanitize_text(body.get("full_name"), 80)
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    role = (body.get("role") or "personnel").lower()
    if not valid_name(full_name):
        return _res(400, {"error": "Enter a valid full name."})
    if not valid_email(email):
        return _res(400, {"error": "Enter a valid email."})
    problem = password_problem(password)
    if problem:
        return _res(400, {"error": problem})
    if role not in _VALID_ROLES:
        return _res(400, {"error": "Choose a valid role."})
    if data_store.find_one("profiles", lambda p: p["email"] == email):
        return _res(409, {"error": "An account with this email already exists."})
    new_user = {
        "id": data_store.new_id("usr"), "email": email, "password_hash": hash_password(password),
        "full_name": full_name, "role": role, "unit_id": body.get("unit_id"), "phone": "",
        "avatar_color": "teal", "status": "active", "created_at": data_store.now_iso(), "last_login_at": None,
    }
    if new_user["unit_id"] and not data_store.find_one("units", lambda u: u["id"] == new_user["unit_id"]):
        new_user["unit_id"] = None
    data_store.insert("profiles", new_user)
    if new_user["unit_id"]:
        data_store.insert("unit_members", {"unit_id": new_user["unit_id"], "user_id": new_user["id"],
                                           "added_at": data_store.now_iso()})
    data_store.audit(profile["id"], "admin.user_created", target=email, detail={"role": role})
    return _res(201, {"user": profile_public(new_user)})


def admin_update_user(profile, user_id, body, ctx):
    target = data_store.find_one("profiles", lambda p: p["id"] == user_id)
    if not target:
        return _res(404, {"error": "User not found."})
    if target["id"] == profile["id"] and ("role" in body or "status" in body):
        return _res(400, {"error": "You cannot change your own role or status."})
    patch = {}
    if "role" in body:
        if body["role"] not in _VALID_ROLES:
            return _res(400, {"error": "Choose a valid role."})
        patch["role"] = body["role"]
    if "status" in body:
        if body["status"] not in {"active", "suspended"}:
            return _res(400, {"error": "Status must be active or suspended."})
        patch["status"] = body["status"]
    if "full_name" in body:
        name = sanitize_text(body.get("full_name"), 80)
        if not valid_name(name):
            return _res(400, {"error": "Enter a valid full name."})
        patch["full_name"] = name
    if "unit_id" in body:
        if body["unit_id"] is None:
            patch["unit_id"] = None
        else:
            unit = data_store.find_one("units", lambda u: u["id"] == body["unit_id"])
            if not unit:
                return _res(400, {"error": "Unknown unit."})
            patch["unit_id"] = unit["id"]
    if not patch:
        return _res(400, {"error": "Nothing to update."})
    data_store.update("profiles", lambda p: p["id"] == user_id, patch)
    if "status" in patch and patch["status"] == "suspended":
        from auth_api import sessions
        sessions.revoke_all_for_user(user_id)
    data_store.audit(profile["id"], "admin.user_updated", target=target["email"], detail=patch)
    updated = data_store.find_one("profiles", lambda p: p["id"] == user_id)
    return _res(200, {"user": profile_public(updated)})


def admin_broadcast(profile, body, ctx):
    title = sanitize_text(body.get("title"), 120)
    message = sanitize_text(body.get("message"), 500)
    kind = body.get("kind", "system")
    if not title or not message:
        return _res(400, {"error": "Title and message are required."})
    audience = body.get("audience", "all")
    if audience == "all":
        recipients = [u for u in data_store.all_rows("profiles") if u.get("status") == "active"]
    elif audience in _VALID_ROLES:
        recipients = data_store.find("profiles", lambda u: u["role"] == audience and u.get("status") == "active")
    elif audience == "user":
        target = data_store.find_one("profiles", lambda u: u["id"] == body.get("user_id"))
        recipients = [target] if target else []
    else:
        return _res(400, {"error": "Audience must be all, a role, or user."})
    for user in recipients:
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": user["id"], "kind": kind if kind in
            {"shift", "task", "support", "system", "buddy", "message_home", "incident"} else "system",
            "title": title, "body": message, "link": body.get("link") or None,
            "read_at": None, "created_at": data_store.now_iso(),
        })
    data_store.audit(profile["id"], "admin.notification_sent", detail={"audience": audience, "recipients": len(recipients)})
    return _res(201, {"sent": len(recipients)})


def admin_audit(profile, query):
    action = query.get("action", "")
    rows = data_store.all_rows("audit_logs")
    if action:
        rows = [r for r in rows if r["action"].startswith(action)]
    rows = list(reversed(rows[-300:]))
    return _res(200, {"events": rows})
