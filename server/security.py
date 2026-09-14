# Security primitives for VIGIL AI: password hashing, sessions, rate limiting, validation.
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import threading
import time

_PBKDF2_ITERATIONS = 120_000


def hash_password(password: str) -> str:
    """PBKDF2-HMAC-SHA256 with a per-user random salt."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, digest_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


class SessionStore:
    """Opaque, server-side session tokens with TTL and optional per-user revocation."""

    def __init__(self, ttl_hours: int = 72):
        self._ttl = ttl_hours * 3600
        self._sessions = {}
        self._lock = threading.RLock()

    def revoke_all(self) -> None:
        """Invalidate every session (e.g. demo reset, security response)."""
        with self._lock:
            self._sessions.clear()

    def create(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._purge()
            self._sessions[token] = {"user_id": user_id, "created": time.time()}
        return token

    def get_user(self, token: str):
        if not token:
            return None
        with self._lock:
            session = self._sessions.get(token)
            if not session or time.time() - session["created"] > self._ttl:
                self._sessions.pop(token, None)
                return None
            return session["user_id"]

    def revoke(self, token: str) -> None:
        with self._lock:
            self._sessions.pop(token, None)

    def revoke_all_for_user(self, user_id: str) -> None:
        with self._lock:
            for token in [t for t, s in self._sessions.items() if s["user_id"] == user_id]:
                self._sessions.pop(token, None)

    def _purge(self) -> None:
        now = time.time()
        expired = [t for t, s in self._sessions.items() if now - s["created"] > self._ttl]
        for token in expired:
            self._sessions.pop(token, None)


class RateLimiter:
    """Simple fixed-window limiter keyed by (bucket, client_id)."""

    def __init__(self):
        self._hits = {}
        self._lock = threading.RLock()

    def allow(self, bucket: str, client_id: str, limit: int, window_seconds: int) -> bool:
        now = time.time()
        key = (bucket, client_id)
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < window_seconds]
            if len(hits) >= limit:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            return True


_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z .'\-]{0,79}$")
_SAFE_TEXT_RE = re.compile(r"^[\w\s.,!?'\"()&:\-/#+@%]*$", re.UNICODE)


def valid_email(value) -> bool:
    return isinstance(value, str) and bool(_EMAIL_RE.match(value.strip())) and len(value) <= 120


def valid_name(value) -> bool:
    return isinstance(value, str) and bool(_NAME_RE.match(value.strip()))


def password_problem(password) -> str | None:
    """Return a human-readable reason the password is weak, or None if acceptable."""
    if not isinstance(password, str) or len(password) < 8:
        return "Password must be at least 8 characters."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Password must include letters and numbers."
    return None


def sanitize_text(value, max_len: int = 500) -> str:
    """Trim, control-char strip and length-limit free-text input."""
    if not isinstance(value, str):
        return ""
    cleaned = "".join(ch for ch in value if ch in "\n\t" or ord(ch) >= 32)
    return cleaned.strip()[:max_len]
