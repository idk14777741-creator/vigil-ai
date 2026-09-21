"""AI assistant API for VIGIL AI — Phase 8.

All model access is proxied server-side: the client never sees provider
configuration, and a live key will live in the environment only.

  POST   /api/ai/chat             send a message, get a reply (persists both)
  GET    /api/ai/conversations    list own conversations (newest first)
  GET    /api/ai/conversations/{id}
  DELETE /api/ai/conversations/{id}   delete own conversation
  POST   /api/ai/conversations    start a new conversation

Privacy: conversations belong to their author only — nobody else (not
supervisors, not medics, not admins) has any route to read them.
"""
from __future__ import annotations

import ai_provider
import data_store


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def _no_match():
    return None, None, None


SAFETY_TOPICS = ("emergency", "chest pain", "suicid", "self-harm", "self harm", "overdose", "bleeding heavily")


def handle(method: str, path: str, ctx: dict):
    """Called from api_routes before the auth gate — we do our own auth."""
    from auth_api import current_profile

    if not path.startswith("/api/ai/"):
        return _no_match()

    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Please sign in to continue."})

    if method == "POST" and path == "/api/ai/chat":
        return chat(profile, ctx.get("body") or {}, ctx)
    if method == "GET" and path == "/api/ai/conversations":
        return list_conversations(profile)
    if method == "POST" and path == "/api/ai/conversations":
        return create_conversation(profile, ctx.get("body") or {})
    if method == "GET" and path.startswith("/api/ai/conversations/"):
        return get_conversation(profile, path.rsplit("/", 1)[-1])
    if method == "DELETE" and path.startswith("/api/ai/conversations/"):
        return delete_conversation(profile, path.rsplit("/", 1)[-1], ctx)
    return _no_match()


# ---------- routes ----------

def chat(profile, body, ctx):
    text = (body.get("message") or "").strip()
    if not text:
        return _res(400, {"error": "Type a message first."})
    if len(text) > 2000:
        return _res(400, {"error": "Message is limited to 2000 characters."})

    conv_id = body.get("conversation_id")
    if conv_id:
        conv = _own_conversation(profile, conv_id)
        if not conv:
            return _res(404, {"error": "Conversation not found."})
    else:
        title = text[:48] + ("…" if len(text) > 48 else "")
        conv = data_store.insert("ai_conversations", {
            "id": data_store.new_id("aic"),
            "user_id": profile["id"],
            "title": title,
            "created_at": data_store.now_iso(),
            "updated_at": data_store.now_iso(),
        })

    _append_message(conv["id"], "user", text)

    provider = ai_provider.get_provider()
    lower = text.lower()
    if any(k in lower for k in SAFETY_TOPICS):
        reply = provider.SAFETY_REDIRECT
        flagged = True
        support = None
    else:
        # Grounded platform answers first (SIU phase 10): deterministic,
        # computed from the user's own permitted data. Falls through to the
        # configured AI provider for anything the platform can't answer.
        grounded = None
        try:
            import ai_grounding
            grounded = ai_grounding.grounded_reply(profile["id"], text)
        except Exception:
            grounded = None
        if grounded:
            reply = grounded["reply"]
            support = grounded.get("support")
        else:
            history = data_store.find("ai_messages", lambda m: m["conversation_id"] == conv["id"])
            history.sort(key=lambda m: m["created_at"])
            try:
                reply = provider.complete(history[-8:])
            except Exception:
                # Provider outage fallback — the assistant stays helpful.
                reply = ("I couldn't reach my AI service just now, but I'm still here. "
                         "I can show your Recovery factors, your week in review, or connect you to "
                         "your support network — try asking about your week, your shifts, or say you need support.")
            support = None
        flagged = False

    _append_message(conv["id"], "assistant", reply)
    data_store.update("ai_conversations", lambda c: c["id"] == conv["id"],
                      {"updated_at": data_store.now_iso()})
    data_store.audit(profile["id"], "ai.chat", detail={"flagged": flagged, "chars": len(text)})

    return _res(200, {
        "conversation_id": conv["id"],
        "reply": reply,
        "flagged": flagged,
        "support": support,
    })


def list_conversations(profile):
    rows = data_store.find("ai_conversations", lambda c: c["user_id"] == profile["id"])
    rows.sort(key=lambda c: c.get("updated_at", ""), reverse=True)
    return _res(200, {"conversations": [{
        "id": c["id"], "title": c["title"],
        "created_at": c["created_at"], "updated_at": c.get("updated_at"),
    } for c in rows[:50]]})


def create_conversation(profile, body):
    title = (body.get("title") or "New conversation").strip()[:80]
    conv = data_store.insert("ai_conversations", {
        "id": data_store.new_id("aic"),
        "user_id": profile["id"],
        "title": title,
        "created_at": data_store.now_iso(),
        "updated_at": data_store.now_iso(),
    })
    return _res(201, {"conversation": conv})


def get_conversation(profile, conv_id):
    conv = _own_conversation(profile, conv_id)
    if not conv:
        return _res(404, {"error": "Conversation not found."})
    messages = data_store.find("ai_messages", lambda m: m["conversation_id"] == conv_id)
    messages.sort(key=lambda m: m["created_at"])
    return _res(200, {"conversation": conv, "messages": messages})


def delete_conversation(profile, conv_id, ctx):
    conv = _own_conversation(profile, conv_id)
    if not conv:
        return _res(404, {"error": "Conversation not found."})
    data_store.db()["ai_messages"] = [m for m in data_store.db()["ai_messages"] if m["conversation_id"] != conv_id]
    data_store.db()["ai_conversations"] = [c for c in data_store.db()["ai_conversations"] if c["id"] != conv_id]
    data_store.save()
    data_store.audit(profile["id"], "ai.conversation_deleted", target=conv_id)
    return _res(200, {"ok": True})


# ---------- helpers ----------

def _own_conversation(profile, conv_id):
    conv = data_store.find_one("ai_conversations", lambda c: c["id"] == conv_id)
    if not conv or conv["user_id"] != profile["id"]:
        return None
    return conv


def _append_message(conv_id, role, content):
    data_store.insert("ai_messages", {
        "id": data_store.new_id("aim"),
        "conversation_id": conv_id,
        "role": role,
        "content": content,
        "created_at": data_store.now_iso(),
    })
