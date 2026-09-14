# Thread-safe JSON-file persistence for the demo mode data store.
import json
import os
import threading

_lock = threading.RLock()


def load(path: str, default):
    with _lock:
        if not os.path.exists(path):
            return default
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (json.JSONDecodeError, OSError):
            return default


def save(path: str, value) -> None:
    with _lock:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(value, fh, indent=2, default=str)
        os.replace(tmp, path)
