"""Supervisor Connection for VIGIL AI — Phase 13.

Personnel raise shift / task / workload concerns with their unit supervisor
and follow up in a private two-way thread. Supervisors see a queue and move
requests through statuses. Workload concerns only — never wellness data.

Privacy: a thread is visible to the requester and their supervisor only.
Supervisors see nothing about a person's wellness here — that boundary is
enforced by the absence of any such code path, not just by the UI.
"""
from __future__ import annotations

import data_store

CATEGORIES = ("work_issue", "shift_concern", "task_concern", "general_support")
STATUSES = ("open", "acknowledged", "in_progress", "resolved", "declined")
CATEGORY_LABELS = {
    "work_issue": "Work issue", "shift_concern": "Shift concern",
    "task_concern": "Task concern", "general_support": "General support",
}


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def _no_match():
    return None, None, None


def handle(method: str, path: str, ctx: dict):
    from auth_api import current_profile

    if not path.startswith("/api/supervisor"):
        return _no_match()
    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Please sign in to continue."})
    uid, role = profile["id"], profile["role"]

    if method == "GET" and path == "/api/supervisor/my":
        return my_requests(profile)
    if method == "POST" and path == "/api/supervisor/requests":
        if role != "personnel":
            return _res(403, {"error": "Only personnel can raise requests."})
        return create_request(profile, ctx.get("body") or {}, ctx)
    if path.startswith("/api/supervisor/requests/"):
        request_id = path.rsplit("/", 1)[-1]
        if method == "GET":
            return thread(profile, request_id)
        if method == "POST":
            return post_message(profile, request_id, ctx.get("body") or {}, ctx)

    if not (path == "/api/supervisor/queue" or path.startswith("/api/supervisor/queue/")):
        return _no_match()
    if role not in ("supervisor", "admin"):
        return _res(403, {"error": "This area is for supervisors."})
    if method == "GET" and path == "/api/supervisor/queue":
        return queue(profile)
    if method == "PATCH" and path.startswith("/api/supervisor/queue/"):
        request_id = path.rsplit("/", 1)[-1]
        return update_status(profile, request_id, ctx.get("body") or {}, ctx)
    return _no_match()


# ---------- personnel ----------

def _assigned_supervisor(uid: str):
    """Supervisor sharing the person's unit; falls back to any supervisor."""
    memberships = data_store.find("unit_members", lambda m: m["user_id"] == uid)
    unit_ids = {m["unit_id"] for m in memberships}
    for m in data_store.find("unit_members", lambda m: m["unit_id"] in unit_ids):
        p = data_store.find_one("profiles", lambda x: x["id"] == m["user_id"] and x["role"] == "supervisor")
        if p:
            return p["id"]
    sup = data_store.find_one("profiles", lambda x: x["role"] == "supervisor")
    return sup["id"] if sup else None


def my_requests(profile):
    uid = profile["id"]
    rows = data_store.find("supervisor_requests", lambda r: r["user_id"] == uid)
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return _res(200, {
        "requests": [_project(r) for r in rows],
        "supervisor": _supervisor_card(_assigned_supervisor(uid)),
    })


def _supervisor_card(supervisor_id):
    if not supervisor_id:
        return None
    s = data_store.find_one("profiles", lambda p: p["id"] == supervisor_id)
    if not s:
        return None
    return {"id": s["id"], "full_name": s["full_name"]}


def _project(r):
    return {
        "id": r["id"], "category": r["category"], "description": r["description"],
        "status": r["status"], "created_at": r["created_at"], "updated_at": r["updated_at"],
        "message_count": len(data_store.find("supervisor_request_messages", lambda m: m["request_id"] == r["id"])),
    }


def create_request(profile, body, ctx):
    from security import sanitize_text
    category = (body.get("category") or "").strip()
    description = sanitize_text(body.get("description"), 2000)
    if category not in CATEGORIES:
        return _res(400, {"error": "Pick what the request is about."})
    if not description or len(description) < 3:
        return _res(400, {"error": "Describe the concern so your supervisor can help."})
    request = data_store.insert("supervisor_requests", {
        "id": data_store.new_id("sreq"),
        "user_id": profile["id"],
        "supervisor_id": _assigned_supervisor(profile["id"]),
        "category": category,
        "description": description,
        "status": "open",
        "created_at": data_store.now_iso(),
        "updated_at": data_store.now_iso(),
    })
    if request.get("supervisor_id"):
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": request["supervisor_id"], "kind": "supervisor_request",
            "title": "New request from your team",
            "body": f"{CATEGORY_LABELS[category]}: {description[:90]}",
            "link": "/supervisor", "read_at": None, "created_at": data_store.now_iso(),
        })
    data_store.audit(profile["id"], "supervisor.request_created", detail={"request": request["id"], "category": category})
    return _res(201, {"request": _project(request)})


# ---------- threads (requester + assigned supervisor only) ----------

def _can_see(profile, request):
    uid, role = profile["id"], profile["role"]
    if request["user_id"] == uid:
        return True
    if role == "admin":
        return True
    if role == "supervisor" and request.get("supervisor_id") in (uid, None):
        return True
    return False


def thread(profile, request_id):
    request = data_store.find_one("supervisor_requests", lambda r: r["id"] == request_id)
    if not request or not _can_see(profile, request):
        return _res(404, {"error": "Request not found."})
    messages = data_store.find("supervisor_request_messages", lambda m: m["request_id"] == request_id)
    messages.sort(key=lambda m: m["created_at"])
    who = {}
    for m in messages:
        sender = data_store.find_one("profiles", lambda p: p["id"] == m["sender_id"])
        who[m["sender_id"]] = sender["full_name"] if sender else "Unknown"
    requester = data_store.find_one("profiles", lambda p: p["id"] == request["user_id"])
    return _res(200, {
        "request": {
            "id": request["id"], "category": request["category"],
            "description": request["description"], "status": request["status"],
            "created_at": request["created_at"],
            "person": requester["full_name"] if requester else "Unknown",
            "is_mine": request["user_id"] == profile["id"],
            "can_reply": profile["role"] in ("personnel", "supervisor", "admin"),
            "can_set_status": profile["role"] in ("supervisor", "admin"),
        },
        "messages": [{"id": m["id"], "sender_id": m["sender_id"], "sender_name": who[m["sender_id"]],
                      "mine": m["sender_id"] == profile["id"], "body": m["body"],
                      "created_at": m["created_at"]} for m in messages],
    })


def post_message(profile, request_id, body, ctx):
    from security import sanitize_text
    request = data_store.find_one("supervisor_requests", lambda r: r["id"] == request_id)
    if not request or not _can_see(profile, request):
        return _res(404, {"error": "Request not found."})
    text = sanitize_text(body.get("body"), 2000)
    if not text:
        return _res(400, {"error": "Write a message first."})
    message = data_store.insert("supervisor_request_messages", {
        "id": data_store.new_id("srm"),
        "request_id": request_id, "sender_id": profile["id"],
        "body": text, "created_at": data_store.now_iso(),
    })
    if profile["id"] == request["user_id"]:
        notify_id = request.get("supervisor_id")
        note = "New message from " + profile["full_name"]
    else:
        notify_id = request["user_id"]
        note = "Your supervisor replied"
    if notify_id:
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": notify_id, "kind": "supervisor_message",
            "title": note, "body": text[:90], "link": "/supervisor",
            "read_at": None, "created_at": data_store.now_iso(),
        })
    data_store.update("supervisor_requests", lambda r: r["id"] == request_id,
                      {"updated_at": data_store.now_iso()})
    data_store.audit(profile["id"], "supervisor.message_posted", detail={"request": request_id})
    return _res(201, {"message": {"id": message["id"], "sender_id": profile["id"],
                                  "sender_name": profile["full_name"], "mine": True,
                                  "body": text, "created_at": message["created_at"]}})


# ---------- supervisor ----------

def queue(profile):
    rows = data_store.find("supervisor_requests", lambda r: True)
    rows.sort(key=lambda r: r["updated_at"], reverse=True)
    people = {}
    for r in rows:
        p = data_store.find_one("profiles", lambda x: x["id"] == r["user_id"])
        people[r["user_id"]] = p["full_name"] if p else "Unknown"
    open_count = sum(1 for r in rows if r["status"] in ("open", "acknowledged"))
    return _res(200, {
        "requests": [{
            "id": r["id"], "category": r["category"], "description": r["description"],
            "status": r["status"], "person": people.get(r["user_id"], "Unknown"),
            "person_id": r["user_id"],
            "created_at": r["created_at"], "updated_at": r["updated_at"],
            "message_count": len(data_store.find("supervisor_request_messages", lambda m: m["request_id"] == r["id"])),
        } for r in rows],
        "open_count": open_count,
    })


def update_status(profile, request_id, body, ctx):
    if profile["role"] not in ("supervisor", "admin"):
        return _res(403, {"error": "Only the supervisor can update request status."})
    request = data_store.find_one("supervisor_requests", lambda r: r["id"] == request_id)
    if not request:
        return _res(404, {"error": "Request not found."})
    status = (body.get("status") or "").strip()
    if status not in STATUSES:
        return _res(400, {"error": "Unknown status."})
    data_store.update("supervisor_requests", lambda r: r["id"] == request_id,
                      {"status": status, "updated_at": data_store.now_iso()})
    data_store.insert("notifications", {
        "id": data_store.new_id("ntf"), "user_id": request["user_id"], "kind": "supervisor_status",
        "title": "Supervisor request update",
        "body": f"Your {CATEGORY_LABELS.get(request['category'], 'request').lower()} is now {status.replace('_', ' ')}.",
        "link": "/supervisor", "read_at": None, "created_at": data_store.now_iso(),
    })
    data_store.audit(profile["id"], "supervisor.status_updated",
                     detail={"request": request_id, "status": status})
    return _res(200, {"ok": True, "status": status})
