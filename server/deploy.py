#!/usr/bin/env python3
"""VIGIL AI launcher — loads .env, validates configuration, starts the server.

Usage:
    python3 server/deploy.py            # demo or live, per .env / environment
    python3 server/deploy.py --check    # print configuration summary and exit

.env is read from the project root if present (KEY=VALUE lines, # comments).
Real environment variables always win over .env values.
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "server")
sys.path.insert(0, SERVER)


def load_env() -> int:
    """Load .env into os.environ (without overriding real env vars)."""
    path = os.path.join(ROOT, ".env")
    loaded = 0
    if not os.path.exists(path):
        return loaded
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip("'\"")
            if key and key not in os.environ:
                os.environ[key] = value
                loaded += 1
    return loaded


def summary() -> dict:
    import config
    import integrations
    rep = integrations.status()
    ready = [k for k, v in rep["categories"].items() if v["configured"]]
    return {
        "mode": config.MODE,
        "host": config.HOST,
        "port": config.PORT,
        "ready_categories": ready,
        "pending": [k for k, v in rep["categories"].items() if not v["configured"]],
    }


def main() -> int:
    loaded = load_env()
    info = summary()
    print(f"VIGIL AI deploy: mode={info['mode']} addr={info['host']}:{info['port']}")
    print(f"  .env values loaded: {loaded}")
    print(f"  ready: {', '.join(info['ready_categories']) or 'none (demo data only)'}")
    if info["mode"] == "live" and "supabase" not in info["ready_categories"]:
        print("  WARNING: VIGIL_MODE=live without Supabase configured — live data paths disabled, demo store in use.")
    if "--check" in sys.argv:
        return 0
    import vigil_server
    vigil_server.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
