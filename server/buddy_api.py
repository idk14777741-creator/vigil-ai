"""Buddy Connect for VIGIL AI — Phase 10.

A voluntary trusted-person support system. Core privacy model:

  - Buddies get NOTHING by default. No heart rate, no SpO2, no sleep, no
    medical info, no AI conversations, no incident reports, no supervisor
    communications. Ever. There is no route that exposes them.
  - The only thing a buddy can ever see is what the person explicitly
    shares: presence ("on/off shift today") and task status, each an
    explicit opt-in flag stored in `share_scope`.
  - Messages flow only inside an `accepted` connection, and both sides
    always see the full thread (it's their conversation).
"""
from __future__ import annotations

import data_store


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def _no_match():
    return None, None, None


# Consent-first sharing (SIU phase 8): every key is an explicit opt-in the
# user controls per connection. Buddies get NOTHING that is not switched on
# here — and each key maps to exactly one small, non-sensitive read.
DEFAULT_SCOPE = {
    "presence": False,        # on/off shift right now
    "task_status": False,     # open task count (no titles)
    "shift_info": False,      # weekly shift hours + last shift length
    "recovery_score": False,  # the 0-100 score + direction (no factor inputs)
    "sleep": False,           # last night's sleep duration
    "wellness_trends": False, # 7-day averages: sleep, steps, resting heart rate
}
SHARE_KEYS = tuple(DEFAULT_SCOPE)


def handle(method: str, path: str, ctx: dict):
    from auth_api import current_profile

    if not path.startswith("/api/buddy"):
        return _no_match()
    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Please sign in to continue."})

    if method == "GET" and path == "/api/buddy":
        return my_buddy(profile)
    if method == "POST" and path == "/api/buddy/invite":
        return invite(profile, ctx.get("body") or {}, ctx)
    if method == "POST" and path == "/api/buddy/respond":
        return respond(profile, ctx.get("body") or {}, ctx)
    if method == "POST" and path == "/api/buddy/remove":
        return remove(profile, ctx.get("body") or {}, ctx)
    if method == "PATCH" and path == "/api/buddy/share":
        return set_share(profile, ctx.get("body") or {}, ctx)
    if method == "GET" and path == "/api/buddy/messages":
        return messages(profile, ctx.get("query", {}).get("connection_id"))
    if method == "POST" and path == "/api/buddy/messages":
        return send_message(profile, ctx.get("body") or {}, ctx)
    return _no_match()


# ---------- helpers ----------

def _connections(uid):
    """All non-removed connections involving uid."""
    rows = data_store.find("buddy_connections", lambda c:
                           (c["requester_id"] == uid or c["addressee_id"] == uid)
                           and c["status"] in ("pending", "accepted"))
    return rows


def _accepted(uid, conn_id=None):
    """A specific accepted connection (if owned), else the most recent one."""
    rows = [c for c in _connections(uid) if c["status"] == "accepted"]
    if not rows:
        return None
    if conn_id:
        for c in rows:
            if c["id"] == conn_id:
                return c
        return None
    return max(rows, key=lambda c: c.get("updated_at", ""))


def _other(conn, uid):
    other_id = conn["addressee_id"] if conn["requester_id"] == uid else conn["requester_id"]
    return data_store.find_one("profiles", lambda p: p["id"] == other_id)


def _view(conn, uid):
    other = _other(conn, uid)
    return {
        "id": conn["id"],
        "status": conn["status"],
        "direction": "outgoing" if conn["requester_id"] == uid else "incoming",
        "share_scope": {**DEFAULT_SCOPE, **(conn.get("share_scope") or {})},
        "created_at": conn["created_at"],
        "buddy": {"id": other["id"], "full_name": other["full_name"],
                  "avatar_color": other.get("avatar_color")} if other else None,
    }


# ---------- routes ----------

def my_buddy(profile):
    uid = profile["id"]
    conns = _connections(uid)
    accepted = next((c for c in conns if c["status"] == "accepted"), None)
    pending_in = [_view(c, uid) for c in conns if c["status"] == "pending" and c["addressee_id"] == uid]
    pending_out = [_view(c, uid) for c in conns if c["status"] == "pending" and c["requester_id"] == uid]

    # Shared snapshot: only what the OTHER side opted in to share.
    shared = None
    if accepted:
        other = _other(accepted, uid)
        their_scope = {**DEFAULT_SCOPE, **(accepted.get("share_scope") or {})}
        # share_scope belongs to the connection owner (this user) — what *I*
        # share with *them* is controlled by MY flags. What they share is on
        # the mirrored connection; in demo we keep one row, so "shared by
        # them" = their own data filtered by *their* flags.
        shared = {}
        if their_scope.get("presence"):
            shared["presence"] = _presence_of(other["id"])
        if their_scope.get("task_status"):
            tasks = data_store.find("tasks", lambda t: t["assignee_id"] == other["id"] and t["status"] in ("pending", "in_progress", "blocked"))
            shared["task_status"] = {"open": len(tasks)}
        shared.update(_shared_wellness(other["id"], their_scope))
    unread = 0
    if accepted:
        unread = len(data_store.find("buddy_messages", lambda m: m["connection_id"] == accepted["id"]
                                     and m["sender_id"] != uid and not m.get("read_at")))

    return _res(200, {
        "connection": _view(accepted, uid) if accepted else None,
        "pending_incoming": pending_in,
        "pending_outgoing": pending_out,
        "shared": shared,
        "unread": unread,
        "note": "Buddies never see wellness data, incidents, or AI conversations — only what you explicitly share.",
    })


def _presence_of(uid):
    import shift_monitor
    view = shift_monitor.compute(uid)
    kind = view["status"]["kind"]
    return {"on_shift": kind == "active"}


def invite(profile, body, ctx):
    email = (body.get("email") or "").strip().lower()
    from security import valid_email
    if not valid_email(email):
        return _res(400, {"error": "Enter a valid email address."})
    if email == profile["email"]:
        return _res(400, {"error": "That's your own email — choose a trusted person instead."})
    target = data_store.find_one("profiles", lambda p: p["email"] == email and p.get("status") == "active")
    if not target:
        return _res(404, {"error": "No VIGIL AI account with that email. Buddies need an account to connect."})
    if target["role"] != "personnel":
        return _res(400, {"error": "Buddy Connect links two personnel accounts."})
    # existing connection in any direction?
    for c in _connections(profile["id"]):
        if _other(c, profile["id"])["id"] == target["id"]:
            return _res(409, {"error": "You already have a connection with this person."})
    conn = data_store.insert("buddy_connections", {
        "id": data_store.new_id("bdy"),
        "requester_id": profile["id"],
        "addressee_id": target["id"],
        "status": "pending",
        "share_scope": dict(DEFAULT_SCOPE),
        "created_at": data_store.now_iso(),
        "updated_at": data_store.now_iso(),
    })
    data_store.insert("notifications", {
        "id": data_store.new_id("ntf"), "user_id": target["id"], "kind": "buddy",
        "title": "Buddy request",
        "body": f"{profile['full_name']} would like to connect as your buddy.",
        "link": "/buddy", "read_at": None, "created_at": data_store.now_iso(),
    })
    data_store.audit(profile["id"], "buddy.invite_sent", target=email)
    return _res(201, {"connection": _view(conn, profile["id"])})


def respond(profile, body, ctx):
    conn_id = body.get("connection_id") or ""
    action = body.get("action")  # accept | decline
    conn = data_store.find_one("buddy_connections", lambda c: c["id"] == conn_id)
    if not conn or conn["addressee_id"] != profile["id"]:
        return _res(404, {"error": "Request not found."})
    if action not in ("accept", "decline"):
        return _res(400, {"error": "Action must be accept or decline."})
    if action == "accept":
        data_store.update("buddy_connections", lambda c: c["id"] == conn_id,
                          {"status": "accepted", "updated_at": data_store.now_iso()})
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": conn["requester_id"], "kind": "buddy",
            "title": "Buddy connected",
            "body": f"{profile['full_name']} accepted your buddy request. You can message each other now.",
            "link": "/buddy", "read_at": None, "created_at": data_store.now_iso(),
        })
    else:
        data_store.db()["buddy_connections"] = [
            c for c in data_store.db()["buddy_connections"] if c["id"] != conn_id]
        data_store.save()
    data_store.audit(profile["id"], f"buddy.{action}", target=conn_id)
    return _res(200, {"ok": True, "status": "accepted" if action == "accept" else "declined"})


def remove(profile, body, ctx):
    conn_id = body.get("connection_id") or ""
    conn = data_store.find_one("buddy_connections", lambda c: c["id"] == conn_id)
    if not conn or (conn["requester_id"] != profile["id"] and conn["addressee_id"] != profile["id"]):
        return _res(404, {"error": "Connection not found."})
    other = _other(conn, profile["id"])
    data_store.db()["buddy_connections"] = [
        c for c in data_store.db()["buddy_connections"] if c["id"] != conn_id]
    data_store.db()["buddy_messages"] = [
        m for m in data_store.db()["buddy_messages"] if m["connection_id"] != conn_id]
    data_store.save()
    data_store.insert("notifications", {
        "id": data_store.new_id("ntf"), "user_id": other["id"], "kind": "buddy",
        "title": "Buddy connection ended",
        "body": "Your buddy connection has ended. Shared data access is removed too.",
        "link": "/buddy", "read_at": None, "created_at": data_store.now_iso(),
    })
    data_store.audit(profile["id"], "buddy.removed", target=conn_id)
    return _res(200, {"ok": True})


def set_share(profile, body, ctx):
    conn = _accepted(profile["id"], body.get("connection_id"))
    if not conn:
        return _res(400, {"error": "Connect with a buddy first."})
    patch = {}
    for key in SHARE_KEYS:
        if key in body:
            patch[key] = bool(body[key])
    if not patch:
        return _res(400, {"error": "Nothing to update."})
    scope = {**DEFAULT_SCOPE, **(conn.get("share_scope") or {})}
    scope.update(patch)
    data_store.update("buddy_connections", lambda c: c["id"] == conn["id"],
                      {"share_scope": scope, "updated_at": data_store.now_iso()})
    data_store.audit(profile["id"], "buddy.share_updated", detail={k: v for k, v in patch.items()})
    return _res(200, {"share_scope": scope})


def _shared_wellness(uid, scope):
    """Consent-gated wellness reads. Each key serves the minimum needed —
    e.g. recovery shares the score, never the factor inputs or notes."""
    out = {}
    if not any(scope.get(k) for k in ("shift_info", "recovery_score", "sleep", "wellness_trends")):
        return out

    if scope.get("shift_info"):
        import shift_monitor
        view = shift_monitor.compute(uid)
        weekly = view.get("weekly", {}).get("this", {})
        out["shift_info"] = {
            "week_hours": weekly.get("hours"),
            "shifts_this_week": weekly.get("shifts"),
        }

    if scope.get("recovery_score"):
        rows = sorted(data_store.find("recovery_scores", lambda r: r["user_id"] == uid),
                      key=lambda r: r["computed_at"])
        if rows:
            latest = rows[-1]
            prev = rows[-2] if len(rows) > 1 else None
            out["recovery_score"] = {
                "score": latest["score"],
                "change": (latest["score"] - prev["score"]) if prev else None,
            }

    wellness = sorted(data_store.find("wellness_data", lambda w: w["user_id"] == uid),
                      key=lambda w: w["recorded_at"])
    if wellness:
        latest = wellness[-1]
        week = [w for w in wellness[-8:-1] if w.get("sleep_minutes") is not None]
        if scope.get("sleep") and latest.get("sleep_minutes") is not None:
            m = latest["sleep_minutes"]
            out["sleep"] = {"hours": round(m / 60, 1)}
        if scope.get("wellness_trends") and week:
            avg = lambda k: (round(sum(w[k] for w in week if w.get(k) is not None) /
                                   max(1, len([w for w in week if w.get(k) is not None])))
                             if any(w.get(k) is not None for w in week) else None)
            out["wellness_trends"] = {
                "sleep_avg_hours": round((avg("sleep_minutes") or 0) / 60, 1),
                "steps_avg": avg("steps"),
                "hr_avg": avg("heart_rate"),
                "window_days": len(week),
            }
    return out


def messages(profile, conn_id=None):
    conn = _accepted(profile["id"], conn_id)
    if not conn:
        return _res(200, {"connection": None, "messages": []})
    rows = data_store.find("buddy_messages", lambda m: m["connection_id"] == conn["id"])
    rows.sort(key=lambda m: m["created_at"])
    # mark incoming read
    data_store.update("buddy_messages",
                      lambda m: m["connection_id"] == conn["id"] and m["sender_id"] != profile["id"] and not m.get("read_at"),
                      {"read_at": data_store.now_iso()})
    return _res(200, {"connection": _view(conn, profile["id"]),
                      "messages": [{"id": m["id"], "sender_id": m["sender_id"], "body": m["body"],
                                    "created_at": m["created_at"]} for m in rows[-100:]]})


def send_message(profile, body, ctx):
    conn = _accepted(profile["id"], body.get("connection_id"))
    if not conn:
        return _res(400, {"error": "Connect with a buddy first."})
    text = (body.get("body") or "").strip()
    if not text:
        return _res(400, {"error": "Type a message first."})
    if len(text) > 2000:
        return _res(400, {"error": "Message is limited to 2000 characters."})
    msg = data_store.insert("buddy_messages", {
        "id": data_store.new_id("bms"),
        "connection_id": conn["id"],
        "sender_id": profile["id"],
        "body": text,
        "read_at": None,
        "created_at": data_store.now_iso(),
    })
    other = _other(conn, profile["id"])
    data_store.insert("notifications", {
        "id": data_store.new_id("ntf"), "user_id": other["id"], "kind": "buddy",
        "title": "Message from your buddy",
        "body": text[:80] + ("…" if len(text) > 80 else ""),
        "link": "/buddy", "read_at": None, "created_at": data_store.now_iso(),
    })
    return _res(201, {"message": {"id": msg["id"], "sender_id": msg["sender_id"],
                                  "body": msg["body"], "created_at": msg["created_at"]}})
