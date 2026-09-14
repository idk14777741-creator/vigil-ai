"""VIGIL AI — demo-mode backend server.

Python stdlib only. Implements the same API contract the live-mode Supabase
adapter will serve, so the frontend never needs rewriting during integration.
"""
import json
import mimetypes
import os
import posixpath
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import api_routes
import auth_api
import config
import data_store
from security import RateLimiter

PUBLIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
limiter = RateLimiter()
MAX_BODY = config.MAX_BODY_BYTES


class VigilHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "VigilAI/0.1"

    # ---------- helpers ----------

    def log_message(self, fmt, *args):  # quieter console, keep errors
        pass

    def _client_ip(self) -> str:
        return self.client_address[0] if self.client_address else "unknown"

    def _send_json(self, status: int, payload, extra_headers=None) -> None:
        if isinstance(payload, (bytes, bytearray)):
            body = bytes(payload)  # pre-encoded payloads (e.g. file downloads)
        else:
            body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("Request body too large")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _session_token(self) -> str:
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            if part.strip().startswith("vigil_session="):
                return urllib.parse.unquote(part.split("=", 1)[1].strip())
        return ""

    def _session_cookie(self, token: str = "", clear: bool = False) -> str:
        if clear or not token:
            return "vigil_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
        return f"vigil_session={urllib.parse.quote(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age={config.SESSION_TTL_HOURS * 3600}"

    # ---------- static ----------

    def _serve_static(self, path: str) -> None:
        clean = urllib.parse.unquote(posixpath.normpath(path)).lstrip("/")
        if clean in ("", "index.html"):
            clean = "index.html"
        full = os.path.realpath(os.path.join(PUBLIC_DIR, clean))
        if not full.startswith(os.path.realpath(PUBLIC_DIR) + os.sep) and full != os.path.realpath(os.path.join(PUBLIC_DIR, "index.html")):
            self._send_json(403, {"error": "Forbidden"})
            return
        if not os.path.isfile(full):
            # SPA fallback: unknown non-asset paths go to the shell
            if "." not in os.path.basename(clean):
                full = os.path.join(PUBLIC_DIR, "index.html")
            else:
                self._send_json(404, {"error": "Not found"})
                return
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8" if ctype.startswith("text/") else ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.end_headers()
        self.wfile.write(body)

    # ---------- routing ----------

    def _route(self, method: str) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        route_ctx = {
            "method": method,
            "path": path,
            "query": {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()},
            "session_token": self._session_token(),
            "ip": self._client_ip(),
            "origin": self.headers.get("Origin", ""),
        }

        # Security headers for every response
        if method == "OPTIONS":
            self.send_response(204)
            self.send_header("Allow", "GET, POST, PATCH, DELETE, OPTIONS")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        try:
            if path.startswith("/api/"):
                # Basic per-IP rate limit on auth endpoints
                if path.startswith("/api/auth/"):
                    if not limiter.allow("auth", route_ctx["ip"], limit=config.AUTH_RATE_LIMIT, window_seconds=60):
                        self._send_json(429, {"error": "Too many attempts. Please wait a minute."})
                        return
                if method in ("POST", "PATCH", "PUT", "DELETE"):
                    ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                    if ctype and ctype != "application/json":
                        self._send_json(415, {"error": "Expected application/json."})
                        return
                    route_ctx["body"] = self._read_body()
                status, payload, headers = api_routes.handle(method, path, route_ctx)
                if headers is None:
                    status, payload, headers = auth_api.handle(method, path, route_ctx)
                if headers is None:
                    self._send_json(404, {"error": "Unknown API route"})
                    return
                if status == 204:
                    self.send_response(204)
                    self.send_header("Content-Length", "0")
                    for k, v in (headers or {}).items():
                        self.send_header(k, v)
                    self.end_headers()
                    return
                self._send_json(status, payload, headers)
                return

            if method != "GET":
                self._send_json(405, {"error": "Method not allowed"})
                return
            self._serve_static(path)
        except ValueError as exc:
            self._send_json(413, {"error": str(exc)})
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON body"})
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001 — final guard, log server-side only
            import traceback
            traceback.print_exc()
            self._send_json(500, {"error": "Something went wrong on our side. Please try again."})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PATCH(self):
        self._route("PATCH")

    def do_DELETE(self):
        self._route("DELETE")

    def do_OPTIONS(self):
        self._route("OPTIONS")


def main() -> None:
    data_store.init()
    if config.SEED_DEMO:
        import seed_data
        seed_data.seed_if_empty()
        import demo_data
        demo_data.refresh_if_stale()
        try:
            import notification_engine
            counts = notification_engine.run_all()
            if counts.get("digests") or counts.get("reminders"):
                print(f"[notifications] {counts['digests']} digest(s), {counts['reminders']} reminder(s)")
        except Exception as exc:
            print(f"[notifications] skipped: {exc}")
    server = ThreadingHTTPServer((config.HOST, config.PORT), VigilHandler)
    print(f"VIGIL AI {config.APP_VERSION} — demo mode")
    print(f"Serving {PUBLIC_DIR}")
    print(f"Ready: http://{config.HOST}:{config.PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down. Demo data saved.")


if __name__ == "__main__":
    main()
