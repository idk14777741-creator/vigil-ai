"""Email sending for VIGIL AI — password resets (Category 5).

SMTP details come from the environment. With no SMTP configured (demo),
`send_reset_email` returns the link so the auth flow can show it in-app —
the current behaviour, unchanged.
"""
from __future__ import annotations

import smtplib
from email.message import EmailMessage

import config


def smtp_configured() -> bool:
    i = config.INTEGRATIONS
    return bool(i["smtp_host"] and i["smtp_user"])


def send_reset_email(to_email: str, reset_url: str, expires_hours: int = 2) -> dict:
    """Send the password-reset email. Returns {sent, delivery} — never the password."""
    if not smtp_configured():
        return {"sent": False, "delivery": "in-app", "reset_url": reset_url}

    i = config.INTEGRATIONS
    msg = EmailMessage()
    msg["Subject"] = "Reset your VIGIL AI password"
    msg["From"] = i["smtp_from"]
    msg["To"] = to_email
    msg.set_content(
        f"Hello,\n\nWe received a request to reset your VIGIL AI password.\n\n"
        f"Open this link within {expires_hours} hours:\n{reset_url}\n\n"
        f"If you didn't request this, you can ignore this email — your password stays as it was.\n\n"
        f"— VIGIL AI")
    try:
        with smtplib.SMTP(i["smtp_host"], i["smtp_port"], timeout=15) as server:
            server.starttls()
            server.login(i["smtp_user"], i["smtp_password"])
            server.send_message(msg)
        return {"sent": True, "delivery": "email"}
    except (smtplib.SMTPException, OSError):
        # Never leak SMTP errors to the client; fall back to in-app link.
        return {"sent": False, "delivery": "in-app-fallback", "reset_url": reset_url}
