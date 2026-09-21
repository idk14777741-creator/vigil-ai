"""Authentication API for VIGIL AI — demo adapter of the Supabase Auth contract.

Routes:
  POST /api/auth/register        create account (demo: any role; live: personnel/buddy self-serve)
  POST /api/auth/login           issue session cookie
  POST /api/auth/logout          revoke session
  GET  /api/auth/session         current user or 401
  POST /api/auth/forgot-password issue reset token (demo returns it; live: email)
  POST /api/auth/reset-password  consume reset token
  GET  /api/me                   current profile + unread count
  GET  /api/demo-accounts        demo quick-fill list (demo flag only)
"""
import json

import config
import data_store
from security import SessionStore, hash_password, password_problem, valid_email, valid_name, verify_password

sessions = SessionStore(config.SESSION_TTL_HOURS)

_VALID_ROLES = {"personnel", "medic", "supervisor", "admin"}
_AVATAR_COLORS = {"teal", "blue", "violet", "amber", "rose", "green"}


def profile_public(p: dict) -> dict:
    return {
        "id": p["id"],
        "email": p["email"],
        "full_name": p["full_name"],
        "role": p["role"],
        "unit_id": p.get("unit_id"),
        "phone": p.get("phone", ""),
        "avatar_color": p.get("avatar_color", "teal"),
        "status": p.get("status", "active"),
        "created_at": p.get("created_at"),
    }


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def _no_match():
    return None, None, None


def handle(method: str, path: str, ctx: dict):
    routes = {
        ("POST", "/api/auth/register"): register,
        ("POST", "/api/auth/login"): login,
        ("POST", "/api/auth/logout"): logout,
        ("GET", "/api/auth/session"): session_info,
        ("POST", "/api/auth/forgot-password"): forgot_password,
        ("POST", "/api/auth/reset-password"): reset_password,
        ("GET", "/api/me"): me,
        ("GET", "/api/demo-accounts"): demo_accounts,
    }
    fn = routes.get((method, path))
    if fn is None:
        return _no_match()
    try:
        body = ctx.get("body") or {}
        return fn(body, ctx)
    except Exception:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        return _res(500, {"error": "Something went wrong. Please try again."})


# ---------- helpers ----------

def current_profile(ctx: dict):
    token = ctx.get("session_token", "")
    user_id = sessions.get_user(token)
    if not user_id:
        return None
    return data_store.find_one("profiles", lambda p: p["id"] == user_id)


def _cookie(token: str) -> dict:
    max_age = config.SESSION_TTL_HOURS * 3600
    return {"Set-Cookie": f"vigil_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"}


def _clear_cookie() -> dict:
    return {"Set-Cookie": "vigil_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"}


# ---------- routes ----------

def register(body: dict, ctx: dict):
    full_name = (body.get("full_name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    role = (body.get("role") or "personnel").strip().lower()

    if not valid_name(full_name):
        return _res(400, {"error": "Please enter your full name (letters, spaces, hyphens)."})
    if not valid_email(email):
        return _res(400, {"error": "Please enter a valid email address."})
    problem = password_problem(password)
    if problem:
        return _res(400, {"error": problem})
    if role not in _VALID_ROLES:
        return _res(400, {"error": "Please choose a valid role."})
    if data_store.find_one("profiles", lambda p: p["email"] == email):
        return _res(409, {"error": "An account with this email already exists."})

    profile = {
        "id": data_store.new_id("usr"),
        "email": email,
        "password_hash": hash_password(password),
        "full_name": full_name,
        "role": role,
        "unit_id": None,
        "phone": "",
        "avatar_color": "teal",
        "status": "active",
        "created_at": data_store.now_iso(),
        "last_login_at": None,
    }
    data_store.insert("profiles", profile)
    if role == "personnel":
        # Demo: new personnel join "Unassigned" pool until an admin places them.
        pass
    data_store.audit(profile["id"], "auth.register", target=email, ip=ctx.get("ip", ""))
    token = sessions.create(profile["id"])
    return _res(201, {"user": profile_public(profile)}, _cookie(token))


def login(body: dict, ctx: dict):
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not valid_email(email) or not password:
        return _res(400, {"error": "Enter your email and password."})

    if config.MODE == "live":
        # Live mode: Supabase Auth verifies; we bridge to a local session.
        import live_auth
        try:
            result = live_auth.signin(email, password)
        except live_auth.LiveAuthError as exc:
            data_store.audit(None, "auth.login_failed", target=email, ip=ctx.get("ip", ""))
            code = 401 if "Invalid" in str(exc) else 503
            return _res(code, {"error": str(exc)})
        profile = result["profile"]
        data_store.audit(profile["id"], "auth.login", ip=ctx.get("ip", ""), detail={"provider": "supabase"})
        return _res(200, {"user": profile_public(profile)}, _cookie(result["token"]))

    profile = data_store.find_one("profiles", lambda p: p["email"] == email)
    if not profile or not verify_password(password, profile.get("password_hash", "")):
        data_store.audit(None, "auth.login_failed", target=email, ip=ctx.get("ip", ""))
        return _res(401, {"error": "Invalid email or password."})
    if profile.get("status") != "active":
        return _res(403, {"error": "This account is not active. Contact your administrator."})

    data_store.update("profiles", lambda p: p["id"] == profile["id"], {"last_login_at": data_store.now_iso()})
    data_store.audit(profile["id"], "auth.login", ip=ctx.get("ip", ""))
    token = sessions.create(profile["id"])
    return _res(200, {"user": profile_public(profile)}, _cookie(token))


def logout(body: dict, ctx: dict):
    profile = current_profile(ctx)
    if profile:
        data_store.audit(profile["id"], "auth.logout", ip=ctx.get("ip", ""))
    sessions.revoke(ctx.get("session_token", ""))
    return _res(200, {"ok": True}, _clear_cookie())


def session_info(body: dict, ctx: dict):
    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Not signed in"})
    return _res(200, {"user": profile_public(profile), "mode": config.MODE, "version": config.APP_VERSION})


def me(body: dict, ctx: dict):
    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Not signed in"})
    unread = len(data_store.find("notifications", lambda n: n["user_id"] == profile["id"] and not n.get("read_at")))
    return _res(200, {"user": profile_public(profile), "unread_notifications": unread, "mode": config.MODE, "version": config.APP_VERSION})


def forgot_password(body: dict, ctx: dict):
    email = (body.get("email") or "").strip().lower()
    if not valid_email(email):
        return _res(400, {"error": "Please enter a valid email address."})
    profile = data_store.find_one("profiles", lambda p: p["email"] == email)
    response = {"ok": True, "message": "If that email is registered, a reset link is on its way."}
    if profile:
        token = __import__("secrets").token_urlsafe(24)
        data_store.insert("password_resets", {
            "token": token,
            "user_id": profile["id"],
            "expires_at": data_store.now_iso(),
            "used": False,
        })
        data_store.audit(profile["id"], "auth.forgot_requested", ip=ctx.get("ip", ""))
        if config.MODE == "demo":
            # Demo mode only: no mail server, so the reset link is returned directly.
            response["demo_reset_token"] = token
        else:
            # Live mode: email the link when SMTP is configured; otherwise the
            # token stays request-only (an admin can still reset from the UI).
            import mailer
            base = f"http://{ctx.get('ip', '127.0.0.1')}:8787"  # replaced by deployed origin in live cutover
            delivery = mailer.send_reset_email(email, f"{base}/#/reset?token={token}")
            response["delivery"] = delivery.get("delivery", "email")
    else:
        data_store.audit(None, "auth.forgot_unknown_email", target=email, ip=ctx.get("ip", ""))
    return _res(200, response)


def reset_password(body: dict, ctx: dict):
    token = body.get("token") or ""
    password = body.get("password") or ""
    problem = password_problem(password)
    if problem:
        return _res(400, {"error": problem})
    reset = data_store.find_one("password_resets", lambda r: r["token"] == token and not r.get("used"))
    if not reset:
        return _res(400, {"error": "This reset link is invalid or has expired."})
    data_store.update("profiles", lambda p: p["id"] == reset["user_id"],
                      {"password_hash": hash_password(password)})
    data_store.update("password_resets", lambda r: r["token"] == token, {"used": True})
    sessions.revoke_all_for_user(reset["user_id"])
    data_store.audit(reset["user_id"], "auth.password_reset", ip=ctx.get("ip", ""))
    return _res(200, {"ok": True, "message": "Password updated. You can sign in now."})


def demo_accounts(body: dict, ctx: dict):
    if not config.DEMO_ACCOUNTS:
        return _res(404, {"error": "Not found"})
    accounts = []
    for email in ("admin@vigil.demo", "supervisor@vigil.demo", "medic@vigil.demo", "priya@vigil.demo", "rohan@vigil.demo", "aarav@vigil.demo"):
        p = data_store.find_one("profiles", lambda x: x["email"] == email)
        if p:
            accounts.append({"email": p["email"], "role": p["role"], "full_name": p["full_name"], "password": "Vigil#2024"})
    return _res(200, {"accounts": accounts})
