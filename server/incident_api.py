"""Incident Reporting for VIGIL AI — Phase 14.

A secure, structured reporting flow: personnel file incidents (operational,
safety, trauma, near miss), supervisors and admins triage them through a
status flow and record resolutions. Every step is audit-logged.

Access control (enforced here, not in the UI):
  - A report is visible to its reporter, supervisors and admins only.
  - Buddies and medics have NO route to incidents at all.
  - Reporters can edit nothing after submission except adding context
    messages — the record belongs to the process, not to the person.
"""
from __future__ import annotations

import data_store

INCIDENT_TYPES = ("operational", "safety", "trauma", "near_miss", "other")
SEVERITIES = ("low", "medium", "high", "critical")
STATUSES = ("submitted", "under_review", "action_taken", "resolved", "closed")
TYPE_LABELS = {
    "operational": "Operational", "safety": "Safety", "trauma": "Trauma-related",
    "near_miss": "Near miss", "other": "Other",
}
SEVERITY_LABELS = {"low": "Low", "medium": "Medium", "high": "High", "critical": "Critical"}


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def _no_match():
    return None, None, None


def _can_see(profile, incident):
    role = profile["role"]
    if role in ("supervisor", "admin"):
        return True
    return incident["reporter_id"] == profile["id"]


def _can_manage(profile):
    return profile["role"] in ("supervisor", "admin")


def handle(method: str, path: str, ctx: dict):
    from auth_api import current_profile

    if not path.startswith("/api/incidents"):
        return _no_match()
    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Please sign in to continue."})
    role = profile["role"]

    if method == "GET" and path == "/api/incidents":
        if role == "personnel":
            return mine(profile)
        if role in ("supervisor", "admin"):
            return queue(profile)
        return _res(403, {"error": "Incidents are handled by reporters, supervisors and admins."})
    if method == "POST" and path == "/api/incidents":
        if role not in ("personnel", "supervisor", "admin"):
            return _res(403, {"error": "You can't file incidents from this account."})
        return create(profile, ctx.get("body") or {}, ctx)

    if path.startswith("/api/incidents/"):
        incident_id = path.rsplit("/", 1)[-1]
        incident = data_store.find_one("incidents", lambda i: i["id"] == incident_id)
        if not incident or not _can_see(profile, incident):
            return _res(404, {"error": "Incident not found."})
        if method == "GET":
            return detail(profile, incident)
        if method == "POST":
            # POST /api/incidents/{id} → add a context note (anyone who can see it).
            return add_context(profile, incident, ctx.get("body") or {}, ctx)
        if method == "PATCH":
            if not _can_manage(profile):
                return _res(403, {"error": "Only supervisors can update incident status."})
            return update_status(profile, incident, ctx.get("body") or {}, ctx)
    return _no_match()


# ---------- filing ----------

def create(profile, body, ctx):
    from security import sanitize_text
    incident_type = (body.get("incident_type") or "").strip()
    severity = (body.get("severity") or "").strip()
    occurred_on = (body.get("occurred_on") or "").strip()
    description = sanitize_text(body.get("description"), 5000)
    location = sanitize_text(body.get("location"), 160)
    people = sanitize_text(body.get("people_involved"), 300)
    immediate = sanitize_text(body.get("immediate_action"), 1000)

    if incident_type not in INCIDENT_TYPES:
        return _res(400, {"error": "Pick what kind of incident this was."})
    if severity not in SEVERITIES:
        return _res(400, {"error": "Pick a severity level."})
    if not _valid_date(occurred_on):
        return _res(400, {"error": "When did it happen? Use the date picker."})
    if not description or len(description) < 5:
        return _res(400, {"error": "Describe what happened (at least a few words) — future readers rely on it."})
    if occurred_on > data_store.now_iso()[:10]:
        return _res(400, {"error": "That date is in the future."})

    incident = data_store.insert("incidents", {
        "id": data_store.new_id("inc"),
        "reporter_id": profile["id"],
        "incident_type": incident_type,
        "occurred_on": occurred_on,
        "occurred_at": _valid_time(body.get("occurred_at")),
        "location": location,
        "description": description,
        "people_involved": people,
        "severity": severity,
        "immediate_action": immediate,
        "status": "submitted",
        "resolution": None,
        "created_at": data_store.now_iso(),
        "updated_at": data_store.now_iso(),
    })
    # Notify supervisors for triage.
    for m in data_store.find("profiles", lambda p: p["role"] == "supervisor"):
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": m["id"], "kind": "incident",
            "title": "New incident reported",
            "body": f"{SEVERITY_LABELS[severity]} severity · {TYPE_LABELS[incident_type]}: {description[:80]}",
            "link": "/incidents", "read_at": None, "created_at": data_store.now_iso(),
        })
    data_store.audit(profile["id"], "incident.reported", target=incident["id"],
                     detail={"severity": severity, "type": incident_type})
    return _res(201, {"incident": _project(profile, incident)})


def _valid_date(value):
    import re
    return bool(value) and bool(re.match(r"^\d{4}-\d{2}-\d{2}$", value.strip()))


def _valid_time(value):
    import re
    if not value:
        return None
    value = str(value).strip()
    if re.match(r"^\d{2}:\d{2}(:\d{2})?$", value):
        return value[:5] + ":00" if len(value) == 5 else value
    return None


# ---------- views ----------

def mine(profile):
    rows = data_store.find("incidents", lambda i: i["reporter_id"] == profile["id"])
    rows.sort(key=lambda i: i["created_at"], reverse=True)
    return _res(200, {
        "incidents": [_project(profile, i) for i in rows],
        "scope": "mine",
    })


def queue(profile):
    rows = data_store.find("incidents", lambda i: True)
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    status_order = {"submitted": 0, "under_review": 1, "action_taken": 2, "resolved": 3, "closed": 4}
    rows.sort(key=lambda i: (status_order[i["status"]], order[i["severity"]], i["created_at"]), reverse=False)
    open_count = sum(1 for i in rows if i["status"] in ("submitted", "under_review"))
    critical_count = sum(1 for i in rows if i["severity"] == "critical" and i["status"] not in ("resolved", "closed"))
    return _res(200, {
        "incidents": [_project(profile, i) for i in rows],
        "open_count": open_count,
        "critical_count": critical_count,
        "scope": "queue",
    })


def _project(profile, i):
    reporter = data_store.find_one("profiles", lambda p: p["id"] == i["reporter_id"])
    return {
        "id": i["id"], "incident_type": i["incident_type"], "occurred_on": i["occurred_on"],
        "occurred_at": i.get("occurred_at"), "location": i.get("location"),
        "description": i["description"], "people_involved": i.get("people_involved"),
        "severity": i["severity"], "immediate_action": i.get("immediate_action"),
        "status": i["status"], "resolution": i.get("resolution"),
        "created_at": i["created_at"], "updated_at": i["updated_at"],
        "reporter": reporter["full_name"] if reporter else "Unknown",
        "is_mine": i["reporter_id"] == profile["id"],
        "can_manage": _can_manage(profile),
        "context_count": len(data_store.find("incident_updates", lambda u: u["incident_id"] == i["id"])),
    }


def detail(profile, incident):
    updates = data_store.find("incident_updates", lambda u: u["incident_id"] == incident["id"])
    updates.sort(key=lambda u: u["created_at"])
    who = {}
    for u in updates:
        p = data_store.find_one("profiles", lambda x: x["id"] == u["author_id"])
        who[u["author_id"]] = p["full_name"] if p else "Unknown"
    return _res(200, {
        "incident": _project(profile, incident),
        "context": [{"id": u["id"], "author": who[u["author_id"]], "mine": u["author_id"] == profile["id"],
                     "body": u["body"], "created_at": u["created_at"]} for u in updates],
    })


def add_context(profile, incident, body, ctx):
    from security import sanitize_text
    text = sanitize_text(body.get("body"), 2000)
    if not text:
        return _res(400, {"error": "Write the note first."})
    update = data_store.insert("incident_updates", {
        "id": data_store.new_id("inu"),
        "incident_id": incident["id"], "author_id": profile["id"],
        "body": text, "created_at": data_store.now_iso(),
    })
    # Notify the reporter (if someone else wrote) or supervisors.
    if profile["id"] != incident["reporter_id"]:
        notify_id = incident["reporter_id"]
        note = "Update on your incident report"
    else:
        notify_id = None
        for m in data_store.find("profiles", lambda p: p["role"] == "supervisor"):
            data_store.insert("notifications", {
                "id": data_store.new_id("ntf"), "user_id": m["id"], "kind": "incident",
                "title": "Context added to an incident",
                "body": text[:90], "link": "/incidents",
                "read_at": None, "created_at": data_store.now_iso(),
            })
    if notify_id:
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": notify_id, "kind": "incident",
            "title": note, "body": text[:90], "link": "/incidents",
            "read_at": None, "created_at": data_store.now_iso(),
        })
    data_store.update("incidents", lambda i: i["id"] == incident["id"],
                      {"updated_at": data_store.now_iso()})
    data_store.audit(profile["id"], "incident.context_added", target=incident["id"])
    return _res(201, {"update": {"id": update["id"], "author": profile["full_name"],
                                 "mine": True, "body": text, "created_at": update["created_at"]}})


def update_status(profile, incident, body, ctx):
    status = (body.get("status") or "").strip()
    if status not in STATUSES:
        return _res(400, {"error": "Unknown status."})
    from security import sanitize_text
    resolution = sanitize_text(body.get("resolution"), 2000) if body.get("resolution") else None
    if status in ("resolved", "closed") and not resolution and not (incident.get("resolution") or resolution):
        return _res(400, {"error": "Add a short resolution before closing this out."})
    patch = {"status": status, "updated_at": data_store.now_iso()}
    if resolution:
        patch["resolution"] = resolution
    data_store.update("incidents", lambda i: i["id"] == incident["id"], patch)
    if incident["reporter_id"] != profile["id"]:
        data_store.insert("notifications", {
            "id": data_store.new_id("ntf"), "user_id": incident["reporter_id"], "kind": "incident",
            "title": "Your incident report was updated",
            "body": f"Status is now {status.replace('_', ' ')}" + (f" — {resolution[:70]}" if resolution else "."),
            "link": "/incidents", "read_at": None, "created_at": data_store.now_iso(),
        })
    data_store.audit(profile["id"], "incident.status_updated", target=incident["id"],
                     detail={"status": status})
    return _res(200, {"ok": True, "status": status})
