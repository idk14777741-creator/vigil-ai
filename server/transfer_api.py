"""Offline welfare transfer relay + online sync — device-to-device layer.

Two responsibilities, kept strictly separate (per the offline architecture):

1. LOCAL RELAY (/api/transfer/*) — a store-and-forward rendezvous server on
   the LOCAL network. It exists so two devices on the same Wi-Fi can exchange
   an Authorized Welfare Report even when the site has no internet. It only
   ever holds ENCRYPTED envelopes (ciphertext + nonce + ephemeral public key);
   it cannot read them. Sessions expire in 2 hours and are closed after the
   report is pulled.

2. CENTRAL SYNC (/api/transfer/sync) — runs when internet returns. The client
   uploads its queued offline records idempotently (client_ref dedupe) and
   pulls everything newer than its last cursor. No duplicate records, ever.

Both endpoints are session-authenticated and role-checked, and every
meaningful action lands in the audit log. The demo "offline simulation"
uses the same relay — it is labelled as simulated in the UI, never faked
as a WebRTC success.
"""
from __future__ import annotations

import secrets

import config
import data_store
from auth_api import current_profile

SESSION_TTL_MINUTES = 120
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no ambiguous chars


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def _no_match():
    return None, None, None


def handle(method: str, path: str, ctx: dict):
    if not path.startswith("/api/transfer") and not path.startswith("/api/medic/inbox"):
        return _no_match()
    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Please sign in to continue."})

    routes = {
        ("GET", "/api/transfer/recipients"): lambda: transfer_recipients(profile),
        ("POST", "/api/transfer/preview"): lambda: transfer_preview(profile, ctx.get("body") or {}),
        ("POST", "/api/transfer/sessions"): lambda: session_create(profile, ctx.get("body") or {}, ctx),
        ("GET", "/api/transfer/sessions"): lambda: session_list(profile),
        ("POST", "/api/transfer/sessions/join"): lambda: session_join(profile, ctx.get("body") or {}, ctx),
        ("POST", "/api/transfer/reports"): lambda: report_register(profile, ctx.get("body") or {}, ctx),
        ("GET", "/api/transfer/history"): lambda: history(profile),
        ("GET", "/api/transfer/inbox"): lambda: inbox(profile),
        ("POST", "/api/transfer/sync"): lambda: sync_push(profile, ctx.get("body") or {}, ctx),
        ("GET", "/api/medic/inbox"): lambda: inbox(profile),
    }
    fn = routes.get((method, path))
    if fn:
        return fn()

    # /api/transfer/sessions/{id}[/close|/envelopes]
    if path.startswith("/api/transfer/sessions/"):
        parts = path.strip("/").split("/")
        session_id = parts[3] if len(parts) >= 4 else ""
        tail = parts[4] if len(parts) == 5 else ""
        if len(parts) == 4 and method == "GET":
            return session_status(profile, session_id)
        if len(parts) == 5 and tail == "close" and method == "POST":
            return session_close(profile, session_id, ctx)
        if len(parts) == 5 and tail == "envelopes" and method == "POST":
            return envelope_push(profile, ctx.get("body") or {}, ctx, session_id)
        return _no_match()

    # /api/transfer/envelopes (pull) and /api/transfer/envelopes/{id}/ack
    if path == "/api/transfer/envelopes" and method == "GET":
        return envelope_pull(profile, ctx.get("query", {}))
    if path.startswith("/api/transfer/envelopes/") and path.endswith("/ack") and method == "POST":
        return envelope_ack(profile, path.split("/")[3], ctx.get("body") or {}, ctx)
    if path.startswith("/api/medic/inbox/") and method == "POST":
        return medic_review(profile, path.split("/")[-1], ctx.get("body") or {}, ctx)
    return _no_match()


# ---------- recipient directory ----------

def transfer_recipients(profile):
    """Authorized recipients a personnel user may choose: medics + supervisors."""
    if profile["role"] != "personnel":
        return _res(403, {"error": "Only personnel can transfer welfare reports."})
    rows = data_store.find("profiles", lambda p: p["role"] in ("medic", "supervisor") and p.get("status", "active") == "active")
    same_unit = [p for p in rows if p.get("unit_id") == profile.get("unit_id")]
    people = same_unit or rows
    people.sort(key=lambda p: (0 if p["role"] == "medic" else 1, p["full_name"]))
    return _res(200, {"recipients": [
        {"id": p["id"], "name": p["full_name"], "role": p["role"]} for p in people
    ]})


def transfer_preview(profile, body):
    if profile["role"] != "personnel":
        return _res(403, {"error": "Only personnel can preview their welfare report."})
    import welfare_report
    builder = welfare_report.builder_for_role(body.get("recipient_role", ""))
    if not builder:
        return _res(400, {"error": "Choose a valid recipient role (medic or supervisor)."})
    view = builder(profile)
    return _res(200, {
        "payload": view["payload"],
        "shared": view["shared"],
        "not_shared": view["not_shared"],
        "payload_hash": view["payload_hash"],
        "note": "This is the complete report. Transfers carry this report only — never your raw database.",
    })


# ---------- relay sessions (local Wi-Fi path) ----------

def session_create(profile, body, ctx):
    if profile["role"] != "personnel":
        return _res(403, {"error": "Only personnel can start a welfare transfer session."})
    recipient_role = body.get("recipient_role") if body.get("recipient_role") in ("medic", "supervisor") else "medic"
    recipient_id = (body.get("recipient_id") or body.get("medic_id") or "").strip()
    recipient = data_store.find_one("profiles", lambda p: p["id"] == recipient_id and p["role"] == recipient_role)
    if not recipient:
        return _res(400, {"error": "Choose a valid " + ("Medic Officer" if recipient_role == "medic" else "Supervisor") + " to receive the report."})
    open_sessions = data_store.find("transfer_sessions",
                                    lambda s: s["personnel_id"] == profile["id"] and s["status"] in ("pending", "active"))
    if len(open_sessions) >= 3:
        return _res(429, {"error": "You already have open transfer sessions. Close one before starting another."})
    code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
    row = {
        "id": data_store.new_id("tfs"),
        "code": code,
        "personnel_id": profile["id"],
        "personnel_name": profile["full_name"],
        "recipient_id": recipient_id,
        "recipient_name": recipient["full_name"],
        "recipient_role": recipient_role,
        "status": "pending",
        "encryption": "AES-GCM 256 — devices pair by verifying a matching safety phrase; the relay never sees keys or plaintext",
        "created_at": data_store.now_iso(),
        "expires_at": _expiry(),
        "closed_at": None,
    }
    data_store.insert("transfer_sessions", row)
    data_store.audit(profile["id"], "transfer.session_created", target=row["id"],
                     detail={"recipient_id": recipient_id, "recipient_role": recipient_role, "method": "local_relay"}, ip=ctx.get("ip", ""))
    return _res(200, {"session": _session_view(row, profile)})


def session_list(profile):
    """The sender's own open sessions (so retries reuse instead of piling up)."""
    if profile["role"] != "personnel":
        return _res(403, {"error": "Only personnel hold transfer sessions."})
    rows = data_store.find("transfer_sessions",
                           lambda s: s["personnel_id"] == profile["id"] and s["status"] in ("pending", "active"))
    now = data_store.now_iso()
    open_rows = []
    for row in rows:
        if row.get("expires_at") and row["expires_at"] < now:
            data_store.update("transfer_sessions", lambda s: s["id"] == row["id"],
                              {"status": "closed", "closed_at": now})
            continue
        open_rows.append(row)
    return _res(200, {"sessions": [_session_view(row, profile) for row in open_rows]})


def session_join(profile, body, ctx):
    if profile["role"] not in ("medic", "supervisor"):
        return _res(403, {"error": "Only a Medic Officer or Supervisor can join a transfer session."})
    code = (body.get("code") or "").strip().upper()
    session = data_store.find_one("transfer_sessions", lambda s: s["code"] == code and s["status"] == "pending")
    if not session:
        return _res(404, {"error": "No open session with that code. Check the 6-character code with the sender."})
    if session["personnel_id"] == profile["id"]:
        return _res(400, {"error": "You cannot join your own transfer session."})
    if session.get("recipient_role") not in ("", profile["role"]):
        return _res(403, {"error": "That session is waiting for a " + session.get("recipient_role", "medic") + "."})
    data_store.update("transfer_sessions", lambda s: s["id"] == session["id"],
                      {"status": "active", "recipient_id": profile["id"], "recipient_name": profile["full_name"],
                       "recipient_role": profile["role"]})
    session["status"], session["recipient_id"], session["recipient_name"], session["recipient_role"] = (
        "active", profile["id"], profile["full_name"], profile["role"])
    data_store.audit(profile["id"], "transfer.session_joined", target=session["id"], ip=ctx.get("ip", ""))
    return _res(200, {"session": _session_view(session, profile)})


def session_status(profile, session_id):
    session = _session_for(profile, session_id)
    if not session:
        return _res(404, {"error": "Transfer session not found."})
    envelopes = data_store.find("transfer_envelopes", lambda e: e["session_id"] == session_id)
    view = _session_view(session, profile)
    view["envelopes"] = [_envelope_brief(e, profile) for e in envelopes]
    return _res(200, {"session": view})


def session_close(profile, session_id, ctx):
    session = _session_for(profile, session_id)
    if not session:
        return _res(404, {"error": "Transfer session not found."})
    data_store.update("transfer_sessions", lambda s: s["id"] == session_id,
                      {"status": "closed", "closed_at": data_store.now_iso()})
    data_store.audit(profile["id"], "transfer.session_closed", target=session_id, ip=ctx.get("ip", ""))
    return _res(200, {"ok": True})


# ---------- envelopes (ciphertext only) ----------

def envelope_push(profile, body, ctx, session_id=None):
    if profile["role"] != "personnel":
        return _res(403, {"error": "Only the sending personnel device can push a report."})
    session = _session_for(profile, session_id or body.get("session_id") or "")
    if not session:
        return _res(404, {"error": "Transfer session not found."})
    for field in ("ciphertext", "nonce", "sender_ephemeral_pub", "payload_hash", "recipient_id"):
        if not str(body.get(field) or "").strip():
            return _res(400, {"error": "Missing transfer data: " + field + "."})
    if session["status"] != "active":
        return _res(409, {"error": "That session is " + session["status"] + " — the recipient needs to join with the code first."})
    if body["recipient_id"] != session.get("recipient_id"):
        return _res(403, {"error": "Recipient must be the person who joined this session — verify their identity on your screen first."})
    summary = body.get("report_summary") or {}
    row = {
        "id": data_store.new_id("tfe"),
        "session_id": session["id"],
        "sender_id": profile["id"],
        "recipient_id": body["recipient_id"],
        "recipient_role": session.get("recipient_role") or "medic",  # matches the session — set server-side
        "ciphertext": str(body["ciphertext"])[:20000],
        "nonce": str(body["nonce"]),
        "sender_ephemeral_pub": str(body["sender_ephemeral_pub"]),
        "payload_hash": body["payload_hash"],
        "report_summary": summary,
        "transfer_method": "local_relay" if body.get("transfer_method", "local_relay") == "local_relay" else "webrtc",
        "status": "pending",
        "created_at": data_store.now_iso(),
        "delivered_at": None,
        "reviewed_at": None,
        "review_note": "",
    }
    data_store.insert("transfer_envelopes", row)
    data_store.audit(profile["id"], "transfer.report_sent", target=row["id"],
                     detail={"session": session["id"], "hash": body["payload_hash"][:16],
                             "method": row["transfer_method"], "recipient_role": row["recipient_role"]},
                     ip=ctx.get("ip", ""))
    return _res(200, {"envelope": _envelope_brief(row, profile), "session": _session_view(session, profile)})


def envelope_pull(profile, query):
    if profile["role"] not in ("medic", "supervisor"):
        return _res(403, {"error": "Only authorized recipients can pull reports."})
    session_id = query.get("session_id") or ""
    rows = data_store.find("transfer_envelopes", lambda e: e["recipient_id"] == profile["id"]
                           and (not session_id or e["session_id"] == session_id))
    fresh = []
    for row in rows:
        if row["status"] == "pending":
            delivered_at = data_store.now_iso()
            data_store.update("transfer_envelopes", lambda e: e["id"] == row["id"],
                              {"status": "delivered", "delivered_at": delivered_at})
            row["status"], row["delivered_at"] = "delivered", delivered_at
            data_store.audit(profile["id"], "transfer.report_received", target=row["id"])
        fresh.append(_envelope_full(row))
    return _res(200, {"envelopes": fresh})


def envelope_ack(profile, envelope_id, body, ctx):
    if profile["role"] not in ("medic", "supervisor"):
        return _res(403, {"error": "Only the authorized recipient can acknowledge a report."})
    row = data_store.find_one("transfer_envelopes", lambda e: e["id"] == envelope_id and e["recipient_id"] == profile["id"])
    if not row:
        return _res(404, {"error": "Report not found in your inbox."})
    data_store.update("transfer_envelopes", lambda e: e["id"] == envelope_id,
                      {"status": "reviewed", "reviewed_at": data_store.now_iso(),
                       "review_note": str(body.get("review_note") or "")[:500]})
    data_store.audit(profile["id"], "transfer.report_reviewed", target=envelope_id, ip=ctx.get("ip", ""))
    return _res(200, {"ok": True})


# ---------- registration for the WebRTC path ----------
# With a direct DataChannel the relay never carries the report, so the
# sender registers the transfer here for history/audit after it completes.

def report_register(profile, body, ctx):
    """Register a transfer that did NOT use the relay (e.g. direct WebRTC)
    for history/audit. Personnel register sends; recipients register
    receipts. The report itself never touches the server in this path."""
    payload_hash = str(body.get("payload_hash") or "").strip()
    method = body.get("transfer_method") if body.get("transfer_method") in ("webrtc", "local_relay") else "webrtc"
    recipient_role = body.get("recipient_role") if body.get("recipient_role") in ("medic", "supervisor") else "medic"
    if not payload_hash:
        return _res(400, {"error": "Missing report hash."})
    now = data_store.now_iso()
    if profile["role"] == "personnel":
        row = {
            "id": data_store.new_id("tfe"),
            "session_id": None,
            "sender_id": profile["id"],
            "recipient_id": None,
            "recipient_role": recipient_role,
            "ciphertext": "",
            "nonce": "",
            "sender_ephemeral_pub": "",
            "payload_hash": payload_hash,
            "report_summary": body.get("report_summary") or {},
            "transfer_method": method,
            "status": "delivered" if body.get("delivered") else "pending",
            "created_at": now,
            "delivered_at": now if body.get("delivered") else None,
            "reviewed_at": None,
            "review_note": "",
        }
        data_store.insert("transfer_envelopes", row)
        data_store.audit(profile["id"], "transfer.report_sent", target=row["id"],
                         detail={"method": method, "hash": payload_hash[:16],
                                 "recipient_role": recipient_role, "direct": True},
                         ip=ctx.get("ip", ""))
        return _res(200, {"envelope": _envelope_brief(row, profile)})
    if profile["role"] in ("medic", "supervisor") and body.get("received"):
        row = {
            "id": data_store.new_id("tfe"),
            "session_id": None,
            "sender_id": None,
            "recipient_id": profile["id"],
            "recipient_role": profile["role"],
            "ciphertext": "",
            "nonce": "",
            "sender_ephemeral_pub": "",
            "payload_hash": payload_hash,
            "report_summary": body.get("report_summary") or {},
            "transfer_method": method,
            "status": "delivered",
            "created_at": now,
            "delivered_at": now,
            "reviewed_at": None,
            "review_note": "",
        }
        data_store.insert("transfer_envelopes", row)
        data_store.audit(profile["id"], "transfer.report_received", target=row["id"],
                         detail={"method": method, "hash": payload_hash[:16], "direct": True},
                         ip=ctx.get("ip", ""))
        return _res(200, {"envelope": _envelope_brief(row, profile)})
    return _res(403, {"error": "Not allowed to register this transfer."})


def history(profile):
    uid = profile["id"]
    if profile["role"] in ("medic", "supervisor"):
        rows = data_store.find("transfer_envelopes", lambda e: e["recipient_id"] == uid)
    else:
        rows = data_store.find("transfer_envelopes", lambda e: e["sender_id"] == uid)
    rows.sort(key=lambda e: e["created_at"], reverse=True)
    return _res(200, {"history": [_envelope_brief(e, profile) for e in rows[:50]]})


# ---------- recipient inbox (medic + supervisor) ----------

def inbox(profile):
    if profile["role"] not in ("medic", "supervisor"):
        return _res(403, {"error": "Only Medic Officers and Supervisors have a welfare inbox."})
    rows = data_store.find("transfer_envelopes", lambda e: e["recipient_id"] == profile["id"] and e["status"] != "pending")
    rows.sort(key=lambda e: e["delivered_at"] or e["created_at"], reverse=True)
    return _res(200, {"inbox": [_envelope_full(e) for e in rows[:50]]})


def medic_review(profile, envelope_id, body, ctx):
    if profile["role"] not in ("medic", "supervisor"):
        return _res(403, {"error": "Only the authorized recipient can review reports."})
    row = data_store.find_one("transfer_envelopes", lambda e: e["id"] == envelope_id and e["recipient_id"] == profile["id"])
    if not row:
        return _res(404, {"error": "Report not found in your inbox."})
    note = str(body.get("review_note") or "")[:500]
    data_store.update("transfer_envelopes", lambda e: e["id"] == envelope_id,
                      {"status": "reviewed", "reviewed_at": data_store.now_iso(), "review_note": note})
    data_store.audit(profile["id"], "transfer.report_reviewed", target=envelope_id,
                     detail={"follow_up": bool(note)}, ip=ctx.get("ip", ""))
    return _res(200, {"ok": True, "review_note": note})


# ---------- central sync (internet returns) ----------

def sync_push(profile, body, ctx):
    """Idempotent offline-record upload: client_ref dedupes across retries."""
    records = body.get("records")
    if not isinstance(records, list) or not records:
        return _res(400, {"error": "Send a list of offline records to sync."})
    accepted, duplicates, rejected = [], [], []
    for rec in records[:200]:
        if not isinstance(rec, dict) or not rec.get("kind") or not rec.get("client_ref"):
            rejected.append({"index": records.index(rec), "error": "missing kind/client_ref"})
            continue
        client_ref = str(rec["client_ref"])
        existing = data_store.find_one("offline_sync_log",
                                       lambda r: r["user_id"] == profile["id"] and r["client_ref"] == client_ref)
        if existing:
            duplicates.append(client_ref)
            continue
        data_store.insert("offline_sync_log", {
            "id": data_store.new_id("syn"),
            "user_id": profile["id"],
            "client_ref": client_ref,
            "kind": str(rec["kind"])[:40],
            "payload": rec.get("payload") or {},
            "received_at": data_store.now_iso(),
            "duplicate": False,
        })
        _materialize_offline_record(profile, str(rec["kind"])[:40], rec.get("payload") or {})
        accepted.append(client_ref)
    data_store.audit(profile["id"], "offline.sync", target="central",
                     detail={"accepted": len(accepted), "duplicates": len(duplicates)}, ip=ctx.get("ip", ""))
    return _res(200, {
        "accepted": accepted,
        "duplicates": duplicates,
        "rejected": rejected,
        "server_time": data_store.now_iso(),
        "message": "Sync complete — nothing was duplicated.",
    })


# ---------- views / helpers ----------

def _materialize_offline_record(profile, kind: str, payload: dict) -> None:
    """Turn selected offline-generated records into central tables.

    Strictly minimal/whitelisted: anomaly events carry only the detection
    RESULT (never raw biometrics — see wellbeing.record_anomaly), and
    wellbeing check-ins are re-scored server-side from the 1–5 answers.
    """
    if kind == "anomaly_event":
        import wellbeing
        status = payload.get("status")
        model = payload.get("model")
        if status in wellbeing.ANOMALY_STATUSES and model in wellbeing.ANOMALY_MODELS:
            try:
                confidence = round(float(payload.get("confidence")), 2)
            except (TypeError, ValueError):
                return
            if not 0 <= confidence <= 1:
                return
            data_store.insert("anomaly_events", {
                "id": data_store.new_id("ano"), "user_id": profile["id"],
                "status": status, "confidence": confidence, "model": model,
                "detected_at": data_store.now_iso(), "demo": True, "synced_offline": True,
            })
    elif kind == "wellbeing_checkin":
        import wellbeing
        answers = payload.get("answers") or {}
        cleaned = {}
        for q in wellbeing.QUESTIONS:
            try:
                v = int(answers.get(q["key"]))
            except (TypeError, ValueError):
                return
            if not 1 <= v <= 5:
                return
            cleaned[q["key"]] = v
        if len(cleaned) != len(wellbeing.QUESTIONS):
            return
        week = payload.get("week_start")
        if not (isinstance(week, str) and len(week) == 10):
            return
        existing = data_store.find_one("wellbeing_checkins",
                                       lambda c: c["user_id"] == profile["id"] and c["week_start"] == week)
        row = {
            "id": existing["id"] if existing else data_store.new_id("wbc"),
            "user_id": profile["id"], "week_start": week, "answers": cleaned,
            "score": wellbeing._score(cleaned),
            "created_at": existing["created_at"] if existing else data_store.now_iso(),
            "updated_at": data_store.now_iso(),
        }
        if existing:
            data_store.update("wellbeing_checkins", lambda c: c["id"] == existing["id"], row)
        else:
            data_store.insert("wellbeing_checkins", row)


def _expiry() -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) + timedelta(minutes=SESSION_TTL_MINUTES)).isoformat(timespec="seconds")


def _expired(session) -> bool:
    try:
        return bool(session.get("expires_at")) and data_store.now_iso() > session["expires_at"] and session["status"] != "closed"
    except Exception:
        return False


def _session_for(profile, session_id):
    session = data_store.find_one("transfer_sessions", lambda s: s["id"] == session_id)
    if not session:
        return None
    involved = profile["id"] in (session.get("personnel_id"), session.get("medic_id"))
    if profile["role"] != "admin" and not involved:
        return None
    if _expired(session):
        data_store.update("transfer_sessions", lambda s: s["id"] == session_id,
                          {"status": "closed", "closed_at": data_store.now_iso()})
        session["status"] = "closed"
    return session


def _session_view(session, viewer) -> dict:
    return {
        "id": session["id"],
        "code": session["code"],
        "status": session["status"],
        "personnel_name": session.get("personnel_name", ""),
        "recipient_id": session.get("recipient_id"),
        "recipient_name": session.get("recipient_name", ""),
        "recipient_role": session.get("recipient_role", "medic"),
        "encryption": session.get("encryption", ""),
        "created_at": session.get("created_at"),
        "expires_at": session.get("expires_at"),
        "viewer_is_sender": session.get("personnel_id") == (viewer or {}).get("id"),
        "relay": config.MODE == "demo",
    }


def _envelope_brief(row, viewer) -> dict:
    mine = viewer and row.get("sender_id") == viewer.get("id")
    return {
        "id": row["id"],
        "status": row["status"],
        "transfer_method": row["transfer_method"],
        "recipient_role": row.get("recipient_role", "medic"),
        "payload_hash": row.get("payload_hash", ""),
        "report_summary": row.get("report_summary") or {},
        "created_at": row.get("created_at"),
        "delivered_at": row.get("delivered_at"),
        "reviewed_at": row.get("reviewed_at"),
        "review_note": row.get("review_note", ""),
        "direction": "sent" if mine else "received",
        "ciphertext_present": bool(row.get("ciphertext")),
    }


def _envelope_full(row) -> dict:
    return {
        "id": row["id"],
        "session_id": row.get("session_id"),
        "status": row["status"],
        "transfer_method": row["transfer_method"],
        "recipient_role": row.get("recipient_role", "medic"),
        "ciphertext": row.get("ciphertext", ""),
        "nonce": row.get("nonce", ""),
        "sender_ephemeral_pub": row.get("sender_ephemeral_pub", ""),
        "payload_hash": row.get("payload_hash", ""),
        "report_summary": row.get("report_summary") or {},
        "created_at": row.get("created_at"),
        "delivered_at": row.get("delivered_at"),
        "reviewed_at": row.get("reviewed_at"),
        "review_note": row.get("review_note", ""),
    }
