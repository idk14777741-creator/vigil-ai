"""Media API for VIGIL AI — Phase 9 (De-stress Zone).

Demo mode serves a catalog of generated ambient tracks. Each track row
carries `gen_params` — a recipe the browser's Web Audio engine uses to
synthesize the soundscape locally. No copyrighted audio is ever shipped;
a live deployment can replace `gen_params` with real `storage_path` files
(hosted in a private bucket) without touching the UI.
"""
from __future__ import annotations

import data_store


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def pub_track(t):
    return {
        "id": t["id"], "title": t["title"], "artist": t.get("artist", "VIGIL AI"),
        "category": t["category"], "duration_sec": t["duration_sec"],
        "gen_params": t.get("gen_params"), "storage_path": t.get("storage_path"),
    }


def handle(method: str, path: str, ctx: dict):
    from auth_api import current_profile

    if not path.startswith(("/api/music", "/api/videos")):
        return _no_match()
    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Please sign in to continue."})

    if method == "GET" and path == "/api/music/tracks":
        return list_tracks(ctx.get("query", {}))
    if method == "POST" and path == "/api/music/history":
        return record_play(profile, ctx.get("body") or {})
    if method == "GET" and path == "/api/music/history":
        return my_history(profile)
    if method == "GET" and path == "/api/videos":
        return list_videos(ctx.get("query", {}))
    return _no_match()


def list_tracks(query):
    category = query.get("category", "")
    rows = [t for t in data_store.find("music_tracks", lambda t: t.get("is_active", True))
            if not category or t["category"] == category]
    rows.sort(key=lambda t: (t["category"], t["title"]))
    return _res(200, {"tracks": [pub_track(t) for t in rows]})


def record_play(profile, body):
    track_id = body.get("track_id") or ""
    track = data_store.find_one("music_tracks", lambda t: t["id"] == track_id)
    if not track:
        return _res(404, {"error": "Track not found."})
    data_store.insert("music_history", {
        "id": data_store.new_id("mhs"),
        "user_id": profile["id"],
        "track_id": track_id,
        "played_at": data_store.now_iso(),
    })
    return _res(201, {"ok": True})


def my_history(profile):
    rows = data_store.find("music_history", lambda h: h["user_id"] == profile["id"])
    rows.sort(key=lambda h: h["played_at"], reverse=True)
    seen, out = set(), []
    for h in rows:
        if h["track_id"] in seen:
            continue
        seen.add(h["track_id"])
        track = data_store.find_one("music_tracks", lambda t: t["id"] == h["track_id"])
        if track:
            out.append({**pub_track(track), "played_at": h["played_at"]})
        if len(out) >= 8:
            break
    return _res(200, {"history": out})


def list_videos(query):
    category = query.get("category", "")
    rows = [v for v in data_store.find("destress_videos", lambda v: v.get("is_active", True))
            if not category or v["category"] == category]
    rows.sort(key=lambda v: (v["category"], v["title"]))
    return _res(200, {"videos": [{
        "id": v["id"], "title": v["title"], "category": v["category"],
        "duration_sec": v["duration_sec"], "description": v.get("description", ""),
        "has_video": bool(v.get("storage_path")),
    } for v in rows]})
