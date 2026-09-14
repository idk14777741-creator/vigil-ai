"""Message From Home for VIGIL AI — Phase 11.

Trusted loved ones send supportive video messages. The personnel owner
approves contacts, watches received videos, and can hide or delete anything.
Loved ones are not VIGIL AI users: they submit through a per-contact
invite code (a public upload page in live mode; simulated in demo).

Privacy: videos belong to one personnel account. Nobody else — not buddies,
not supervisors, not medics — has any route to them.
"""
from __future__ import annotations

import uuid

import data_store


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def _no_match():
    return None, None, None


def handle(method: str, path: str, ctx: dict):
    from auth_api import current_profile

    if not (path == "/api/home/upload" and method == "POST"):
        if not path.startswith("/api/home"):
            return _no_match()
    profile = current_profile(ctx) if not (path == "/api/home/upload" and method == "POST") else None

    # Loved-one upload: no session, authorized by invite code instead.
    if method == "POST" and path == "/api/home/upload":
        return upload(ctx.get("body") or {}, ctx)

    if not profile:
        return _res(401, {"error": "Please sign in to continue."})

    if method == "GET" and path == "/api/home":
        return my_home(profile)
    if method == "POST" and path == "/api/home/contacts":
        return add_contact(profile, ctx.get("body") or {}, ctx)
    if method == "PATCH" and path.startswith("/api/home/contacts/"):
        return update_contact(profile, path.rsplit("/", 1)[-1], ctx.get("body") or {}, ctx)
    if method == "DELETE" and path.startswith("/api/home/contacts/"):
        return delete_contact(profile, path.rsplit("/", 1)[-1], ctx)
    if method == "POST" and path == "/api/home/videos/watch":
        return mark_watched(profile, ctx.get("body") or {})
    if method == "POST" and path == "/api/home/videos/hide":
        return hide_video(profile, ctx.get("body") or {}, ctx)
    if method == "POST" and path == "/api/home/videos/delete":
        return delete_video(profile, ctx.get("body") or {}, ctx)
    return _no_match()


# ---------- personnel routes ----------

def my_home(profile):
    uid = profile["id"]
    contacts = data_store.find("support_contacts", lambda c: c["personnel_id"] == uid and c["status"] != "removed")
    contacts.sort(key=lambda c: c["created_at"])
    videos = [v for v in data_store.find("support_videos", lambda v: v["personnel_id"] == uid and not v.get("hidden_at"))]
    videos.sort(key=lambda v: v["created_at"], reverse=True)
    by_contact = {}
    for v in videos:
        by_contact.setdefault(v["contact_id"], []).append({
            "id": v["id"], "title": v["title"], "message": v.get("message", ""),
            "duration_sec": v.get("duration_sec"), "watched": bool(v.get("watched_at")),
            "created_at": v["created_at"], "has_video": bool(v.get("storage_path")),
        })
    return _res(200, {
        "contacts": [{
            "id": c["id"], "name": c["name"], "relationship": c.get("relationship", ""),
            "status": c["status"], "invite_code": c["invite_code"],
            "video_count": len(by_contact.get(c["id"], [])),
            "created_at": c["created_at"],
        } for c in contacts],
        "videos": [{
            "id": v["id"], "contact_id": v["contact_id"], "title": v["title"],
            "message": v.get("message", ""), "duration_sec": v.get("duration_sec"),
            "watched": bool(v.get("watched_at")), "created_at": v["created_at"],
            "has_video": bool(v.get("storage_path")),
            "contact": next(({"name": c["name"]} for c in contacts if c["id"] == v["contact_id"]), None),
        } for v in videos],
        "videos_by_contact": by_contact,
    })


def add_contact(profile, body, ctx):
    from security import sanitize_text, valid_name
    name = sanitize_text(body.get("name"), 80)
    relationship = sanitize_text(body.get("relationship"), 40)
    if not valid_name(name):
        return _res(400, {"error": "Enter their name (letters, spaces, hyphens)."})
    contact = data_store.insert("support_contacts", {
        "id": data_store.new_id("ctc"),
        "personnel_id": profile["id"],
        "name": name,
        "relationship": relationship,
        "invite_code": str(uuid.uuid4()),
        "status": "active",
        "created_at": data_store.now_iso(),
    })
    data_store.audit(profile["id"], "home.contact_added", detail={"contact": contact["id"]})
    return _res(201, {"contact": {
        "id": contact["id"], "name": contact["name"], "relationship": contact["relationship"],
        "invite_code": contact["invite_code"], "status": contact["status"],
    }})


def _own_contact(profile, contact_id):
    c = data_store.find_one("support_contacts", lambda x: x["id"] == contact_id)
    if not c or c["personnel_id"] != profile["id"]:
        return None
    return c


def update_contact(profile, contact_id, body, ctx):
    c = _own_contact(profile, contact_id)
    if not c:
        return _res(404, {"error": "Contact not found."})
    patch = {}
    if "relationship" in body:
        from security import sanitize_text
        patch["relationship"] = sanitize_text(body.get("relationship"), 40)
    if not patch:
        return _res(400, {"error": "Nothing to update."})
    data_store.update("support_contacts", lambda x: x["id"] == contact_id, patch)
    return _res(200, {"ok": True})


def delete_contact(profile, contact_id, ctx):
    c = _own_contact(profile, contact_id)
    if not c:
        return _res(404, {"error": "Contact not found."})
    data_store.update("support_contacts", lambda x: x["id"] == contact_id, {"status": "removed"})
    data_store.audit(profile["id"], "home.contact_removed", detail={"contact": contact_id})
    return _res(200, {"ok": True})


def mark_watched(profile, body):
    v = _own_video(profile, body.get("video_id"))
    if not v:
        return _res(404, {"error": "Video not found."})
    if not v.get("watched_at"):
        data_store.update("support_videos", lambda x: x["id"] == v["id"],
                          {"watched_at": data_store.now_iso()})
    return _res(200, {"ok": True})


def hide_video(profile, body, ctx):
    v = _own_video(profile, body.get("video_id"))
    if not v:
        return _res(404, {"error": "Video not found."})
    data_store.update("support_videos", lambda x: x["id"] == v["id"],
                      {"hidden_at": data_store.now_iso()})
    return _res(200, {"ok": True})


def delete_video(profile, body, ctx):
    v = _own_video(profile, body.get("video_id"))
    if not v:
        return _res(404, {"error": "Video not found."})
    data_store.db()["support_videos"] = [x for x in data_store.db()["support_videos"] if x["id"] != v["id"]]
    data_store.save()
    data_store.audit(profile["id"], "home.video_deleted", detail={"video": v["id"]})
    return _res(200, {"ok": True})


def _own_video(profile, video_id):
    v = data_store.find_one("support_videos", lambda x: x["id"] == video_id)
    if not v or v["personnel_id"] != profile["id"]:
        return None
    return v


# ---------- loved-one upload (invite-code authorized) ----------

def upload(body, ctx):
    code = (body.get("invite_code") or "").strip()
    title = (body.get("title") or "").strip()
    message = (body.get("message") or "").strip()
    if not code:
        return _res(400, {"error": "Missing invite code."})
    contact = data_store.find_one("support_contacts",
                                  lambda c: c["invite_code"] == code and c["status"] == "active")
    if not contact:
        return _res(403, {"error": "This invite code isn't valid."})
    if not title or len(title) > 120:
        return _res(400, {"error": "Give the video a title (up to 120 characters)."})
    if len(message) > 500:
        return _res(400, {"error": "Message is limited to 500 characters."})
    # Demo: no file storage yet — mark as placeholder content.
    video = data_store.insert("support_videos", {
        "id": data_store.new_id("spv"),
        "contact_id": contact["id"],
        "personnel_id": contact["personnel_id"],
        "title": title,
        "message": message,
        "storage_path": None,
        "duration_sec": 30,
        "watched_at": None,
        "hidden_at": None,
        "created_at": data_store.now_iso(),
    })
    data_store.insert("notifications", {
        "id": data_store.new_id("ntf"), "user_id": contact["personnel_id"], "kind": "message_home",
        "title": "New message from home",
        "body": f"{contact['name']} sent you: {title}",
        "link": "/home", "read_at": None, "created_at": data_store.now_iso(),
    })
    return _res(201, {"ok": True, "message": "Your video is on its way to them. They'll love it."})
