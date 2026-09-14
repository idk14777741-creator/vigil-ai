"""Live auth adapter — Supabase GoTrue sign-in, bridged to local sessions.

Strategy (deliberately boring):
  - Passwords are verified by Supabase Auth, never locally, in live mode.
  - On success we ensure a local profile row exists (provisioned on first
    login from the GoTrue user) and issue our own opaque session cookie.
  - The rest of the app keeps using `current_profile()` unchanged.

This means the live cutover does not touch api_routes, RLS reads the same
profiles table, and demo mode never imports this module.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

import config


class LiveAuthError(Exception):
    pass


def gotrue_signin(email: str, password: str) -> dict:
    """Verify credentials against Supabase Auth. Returns the GoTrue user."""
    i = config.INTEGRATIONS
    url = i["supabase_url"].rstrip("/") + "/auth/v1/token?grant_type=password"
    payload = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "apikey": i["supabase_anon_key"],
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            body = json.loads(res.read().decode())
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 401, 403):
            raise LiveAuthError("Invalid email or password.") from None
        raise LiveAuthError(f"Auth service error (HTTP {exc.code})") from None
    except urllib.error.URLError as exc:
        raise LiveAuthError("Auth service unreachable.") from exc
    if not body.get("user"):
        raise LiveAuthError("Auth service returned no user.")
    return body["user"]


def ensure_profile(gottrue_user: dict) -> dict | None:
    """Find (or provision) the local profile row for a GoTrue user."""
    import data_store
    sid = gottrue_user.get("id")
    meta = gottrue_user.get("user_metadata") or {}
    email = (gottrue_user.get("email") or "").lower()

    profile = data_store.find_one("profiles", lambda p: p.get("auth_user_id") == sid or p["email"] == email)
    if profile:
        if not profile.get("auth_user_id"):
            data_store.update("profiles", lambda p: p["id"] == profile["id"], {"auth_user_id": sid})
        return data_store.find_one("profiles", lambda p: p["id"] == profile["id"])

    # First login for this account — provision a minimal profile matching the
    # live schema (auth_user_id NOT NULL). An admin refines role/unit after.
    profile = data_store.insert("profiles", {
        "id": "usr_" + sid.replace("-", "")[:12],
        "auth_user_id": sid,
        "email": email,
        "full_name": meta.get("full_name") or email.split("@")[0].title(),
        "role": "personnel",
        "unit_id": meta.get("unit_id"),
        "avatar_color": "teal",
        "status": "active",
        "created_at": data_store.now_iso(),
        "updated_at": data_store.now_iso(),
    })
    return profile


def signin(email: str, password: str) -> dict:
    """Full live sign-in: GoTrue verify + local profile + session token."""
    user = gotrue_signin(email, password)
    profile = ensure_profile(user)
    if not profile:
        raise LiveAuthError("Could not provision your profile — contact your administrator.")
    if profile.get("status") != "active":
        raise LiveAuthError("This account is not active. Contact your administrator.")
    from auth_api import sessions
    token = sessions.create(profile["id"])
    return {"profile": profile, "token": token}
