"""Medic Connection for VIGIL AI — Phase 12.

Personnel raise wellness/support requests to their assigned Medic Officer
and can authorize (or revoke) access to their wellness data at any time.
Medics see a queue of requests, follow up through a private two-way thread,
and — only with explicit authorization — see that person's wellness summary.

Privacy rules enforced here, not just in the UI:
  - Wellness data reaches a medic ONLY when wellness_authorizations says so.
  - Threads are visible to the requester and their medic only.
  - Every authorization change and status change is audit-logged.
"""
from __future__ import annotations

import data_store

CATEGORIES = ("injury", "illness", "mental_health", "medication", "follow_up", "other")
STATUSES = ("open", "acknowledged", "in_progress", "resolved", "declined")
CATEGORY_LABELS = {
    "injury": "Injury", "illness": "Illness", "mental_health": "Mental health",
    "medication": "Medication", "follow_up": "Follow-up", "other": "Something else",
}


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def _no_match():
    return None, None, None


def handle(method: str, path: str, ctx: dict):
    from auth_api import current_profile

    if not path.startswith("/api/medic"):
        return _no_match()
    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Please sign in to continue."})
    uid, role = profile["id"], profile["role"]

    # ---------- personnel ----------
    if method == "GET" and path == "/api/medic/my":
        return my_requests(profile)
    if method == "POST" and path == "/api/medic/requests":
        if role != "personnel":
            return _res(403, {"error": "Only personnel can raise requests."})
        return create_request(profile, ctx.get("body") or {}, ctx)
    if method == "GET" and path == "/api/medic/authorization":
        return authorization_status(profile)
    if method == "POST" and path == "/api/medic/authorization":
        if role != "personnel":
            return _res(403, {"error": "Only personnel can change authorization."})
        return set_authorization(profile, ctx.get("body") or {}, ctx)

    # ---------- shared: thread access ----------
    if path.startswith("/api/medic/requests/"):
        request_id = path.rsplit("/", 1)[-1]
        if method == "GET":
            return thread(profile, request_id)
        if method == "POST":
            return post_message(profile, request_id, ctx.get("body") or {}, ctx)

    # ---------- medic ----------
    medic_area = path == "/api/medic/queue" or path == "/api/medic/authorized" or path.startswith("/api/medic/queue/")
    if not medic_area:
        return _no_match()
    if role not in ("medic", "admin"):
        return _res(403, {"error": "This area is for Medic Officers."})
    if method == "GET" and path == "/api/medic/queue":
        return queue(profile)
    if method == "GET" and path == "/api/medic/authorized":
        return authorized_people(profile)
    if method == "GET" and path.startswith("/api/medic/queue/"):
        person_id = path.rsplit("/", 1)[-1]
        return person_wellness(profile, person_id)
    if method == "PATCH" and path.startswith("/api/medic/queue"):
        request_id = path.rsplit("/", 1)[-1]
        return update_status(profile, request_id, ctx.get("body") or {}, ctx)
    return _no_match()


# ---------- personnel ----------

def _assigned_medic(uid: str):
    """The unit's medic for now; falls back to any seeded medic."""
    import data_store
    mreq = data_store.find_one("medic_requests", lambda r: r["user_id"] == uid and r.get("medic_id"))
    if mreq:
        return mreq["medic_id"]
    medic = data_store.find_one("profiles", lambda p: p["role"] == "medic")
    return medic["id"] if medic else None


def my_requests(profile):
    uid = profile["id"]
    rows = data_store.find("medic_requests", lambda r: r["user_id"] == uid)
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    auth = data_store.find_one("wellness_authorizations",
                               lambda a: a["personnel_id"] == uid and a.get("authorized"))
    return _res(200, {
        "requests": [_project(r, uid) for r in rows],
        "medic": _medic_card(_assigned_medic(uid)),
        "wellness_authorized": bool(auth),
    })


def _medic_card(medic_id):
    if not medic_id:
        return None
    m = data_store.find_one("profiles", lambda p: p["id"] == medic_id)
    if not m:
        return None
    return {"id": m["id"], "full_name": m["full_name"]}


def _project(r, viewer_id):
    return {
        "id": r["id"], "category": r["category"], "description": r["description"],
        "status": r["status"], "created_at": r["created_at"], "updated_at": r["updated_at"],
        "message_count": len(data_store.find("medic_request_messages", lambda m: m["request_id"] == r["id"])),
    }


def create_request(profile, body, ctx):
    from security import sanitize_text
    category = (body.get("category") or "").strip()
    description = sanitize_text(body.get("description"), 2000)
    if category not in CATEGORIES:
        return _res(400, {"error": "Pick a category for your request."})
    if not description or len(description) < 3:
        return _res(400, {"error": "Tell the Medic Officer a little about what's going on."})
    request = data_store.insert("medic_requests", {
        "id": data_store.new_id("mreq"),
        "user_id": profile["id"],
        "medic_id": _assigned_medic(profile["id"]),
        "category": category,
        "description": description,
        "status": "open",
        "created_at": data_store.now_iso(),
        "updated_at": data_store.now_iso(),
    })
    if request.get("medic_id"):
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": request["medic_id"], "kind": "medic_request",
            "title": "New request from your team",
            "body": f"{CATEGORY_LABELS[category]}: {description[:90]}",
            "link": "/medic", "read_at": None, "created_at": data_store.now_iso(),
        })
    data_store.audit(profile["id"], "medic.request_created", detail={"request": request["id"], "category": category})
    return _res(201, {"request": _project(request, profile["id"])})


def authorization_status(profile):
    uid = profile["id"]
    auth = data_store.find_one("wellness_authorizations", lambda a: a["personnel_id"] == uid)
    return _res(200, {
        "wellness_authorized": bool(auth and auth.get("authorized")),
        "medic": _medic_card(_assigned_medic(uid)),
        "updated_at": auth.get("updated_at") if auth else None,
    })


def set_authorization(profile, body, ctx):
    from security import sanitize_text
    authorized = bool(body.get("authorized"))
    medic_id = _assigned_medic(profile["id"])
    if not medic_id:
        return _res(400, {"error": "No Medic Officer assigned yet."})
    existing = data_store.find_one("wellness_authorizations",
                                   lambda a: a["personnel_id"] == profile["id"] and a["medic_id"] == medic_id)
    if existing:
        data_store.update("wellness_authorizations", lambda a: a["id"] == existing["id"],
                          {"authorized": authorized, "updated_at": data_store.now_iso()})
    else:
        data_store.insert("wellness_authorizations", {
            "id": data_store.new_id("wla"),
            "personnel_id": profile["id"], "medic_id": medic_id,
            "authorized": authorized, "updated_at": data_store.now_iso(),
        })
    data_store.audit(profile["id"], "medic.authorization_" + ("granted" if authorized else "revoked"),
                     detail={"medic": medic_id})
    if authorized:
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": medic_id, "kind": "wellness_auth",
            "title": "Wellness sharing authorized",
            "body": f"{profile['full_name']} authorized you to view their wellness summary.",
            "link": "/medic", "read_at": None, "created_at": data_store.now_iso(),
        })
    return _res(200, {"wellness_authorized": authorized})


# ---------- threads (requester + assigned medic only) ----------

def _can_see(profile, request):
    uid, role = profile["id"], profile["role"]
    if request["user_id"] == uid:
        return True
    if role in ("medic", "admin") and request.get("medic_id") in (uid, None):
        return True
    if role == "admin":
        return True
    return False


def thread(profile, request_id):
    request = data_store.find_one("medic_requests", lambda r: r["id"] == request_id)
    if not request or not _can_see(profile, request):
        return _res(404, {"error": "Request not found."})
    messages = data_store.find("medic_request_messages", lambda m: m["request_id"] == request_id)
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
            "can_reply": profile["role"] in ("personnel", "medic", "admin"),
            "can_set_status": profile["role"] in ("medic", "admin"),
        },
        "messages": [{"id": m["id"], "sender_id": m["sender_id"], "sender_name": who[m["sender_id"]],
                      "mine": m["sender_id"] == profile["id"], "body": m["body"],
                      "created_at": m["created_at"]} for m in messages],
    })


def post_message(profile, request_id, body, ctx):
    from security import sanitize_text
    request = data_store.find_one("medic_requests", lambda r: r["id"] == request_id)
    if not request or not _can_see(profile, request):
        return _res(404, {"error": "Request not found."})
    text = sanitize_text(body.get("body"), 2000)
    if not text:
        return _res(400, {"error": "Write a message first."})
    message = data_store.insert("medic_request_messages", {
        "id": data_store.new_id("mrm"),
        "request_id": request_id, "sender_id": profile["id"],
        "body": text, "created_at": data_store.now_iso(),
    })
    # Notify the other side.
    if profile["id"] == request["user_id"]:
        notify_id = request.get("medic_id")
        note = "New message from " + profile["full_name"]
    else:
        notify_id = request["user_id"]
        note = "Your Medic Officer replied"
    if notify_id:
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": notify_id, "kind": "medic_message",
            "title": note, "body": text[:90], "link": "/medic",
            "read_at": None, "created_at": data_store.now_iso(),
        })
    data_store.update("medic_requests", lambda r: r["id"] == request_id,
                      {"updated_at": data_store.now_iso()})
    data_store.audit(profile["id"], "medic.message_posted", detail={"request": request_id})
    return _res(201, {"message": {"id": message["id"], "sender_id": profile["id"],
                                  "sender_name": profile["full_name"], "mine": True,
                                  "body": text, "created_at": message["created_at"]}})


# ---------- medic ----------

def queue(profile):
    rows = data_store.find("medic_requests", lambda r: True)
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
            "message_count": len(data_store.find("medic_request_messages", lambda m: m["request_id"] == r["id"])),
        } for r in rows],
        "open_count": open_count,
    })


def authorized_people(profile):
    auths = data_store.find("wellness_authorizations", lambda a: a.get("authorized"))
    out = []
    for a in auths:
        p = data_store.find_one("profiles", lambda x: x["id"] == a["personnel_id"])
        if not p:
            continue
        out.append({"personnel_id": a["personnel_id"], "name": p["full_name"],
                    "updated_at": a["updated_at"]})
    return _res(200, {"authorized": out})


def person_wellness(profile, person_id):
    """Wellness summary — served ONLY with explicit authorization."""
    if profile["role"] not in ("medic", "admin"):
        return _res(403, {"error": "This area is for Medic Officers."})
    auth = data_store.find_one("wellness_authorizations",
                               lambda a: a["personnel_id"] == person_id and a.get("authorized"))
    if not auth:
        return _res(403, {"error": "This person hasn't authorized wellness sharing."})
    p = data_store.find_one("profiles", lambda x: x["id"] == person_id)
    rows = data_store.find("wellness_data", lambda r: r["user_id"] == person_id)
    rows.sort(key=lambda r: r.get("date", ""))
    recent = rows[-7:]
    if not recent:
        return _res(200, {"person": p["full_name"] if p else "Unknown", "authorized": True, "has_data": False})

    def avg(key):
        vals = [r.get(key) for r in recent if isinstance(r.get(key), (int, float))]
        return round(sum(vals) / len(vals)) if vals else None

    stress_vals = [r.get("stress") for r in recent if isinstance(r.get("stress"), (int, float))]
    return _res(200, {
        "person": p["full_name"] if p else "Unknown",
        "authorized": True,
        "has_data": True,
        "window_days": len(recent),
        "avg_sleep_minutes": avg("sleep_minutes"),
        "avg_heart_rate": avg("heart_rate"),
        "avg_spo2": avg("spo2"),
        "avg_steps": avg("steps"),
        "avg_stress": round(sum(stress_vals) / len(stress_vals), 1) if stress_vals else None,
        "note": "Shared by the person's explicit authorization. Averages over the last 7 days — context, not a diagnosis.",
    })


def update_status(profile, request_id, body, ctx):
    if profile["role"] not in ("medic", "admin"):
        return _res(403, {"error": "Only a Medic Officer can update request status."})
    request = data_store.find_one("medic_requests", lambda r: r["id"] == request_id)
    if not request:
        return _res(404, {"error": "Request not found."})
    status = (body.get("status") or "").strip()
    if status not in STATUSES:
        return _res(400, {"error": "Unknown status."})
    data_store.update("medic_requests", lambda r: r["id"] == request_id,
                      {"status": status, "updated_at": data_store.now_iso()})
    data_store.insert("notifications", {
        "id": data_store.new_id("ntf"), "user_id": request["user_id"], "kind": "medic_status",
        "title": "Medic request update",
        "body": f"Your {CATEGORY_LABELS.get(request['category'], 'request')} is now {status.replace('_', ' ')}.",
        "link": "/medic", "read_at": None, "created_at": data_store.now_iso(),
    })
    data_store.audit(profile["id"], "medic.status_updated",
                     detail={"request": request_id, "status": status})
    return _res(200, {"ok": True, "status": status})
