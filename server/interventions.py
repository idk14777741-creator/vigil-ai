"""Closed-loop intervention tracking for VIGIL AI — intelligence phase 3.

Detect → Explain → Recommend Support → Engage → Follow up → Measure trend.

Strictly observational: VIGIL records what happened around a support
engagement — it never claims causation. Every follow-up view says
"observed recovery change following intervention", never "the intervention
caused the improvement".

Efficacy aggregates are honest: below the minimum sample they show
"Insufficient data" instead of a fabricated percentage, and they are
anonymized (never per-person, never with user ids).
"""
from __future__ import annotations

from datetime import datetime, timedelta

import data_store

# Minimum engagements before a percentage may be shown at all.
MIN_SAMPLE = 5

# Support surfaces VIGIL can route to. `path` links to the module the
# person actually uses — the loop closes through real features, not a
# separate tracking silo.
CATALOG = [
    {"id": "destress_zone", "label": "De-Stress Zone", "icon": "♪", "path": "/destress", "kind": "self_care"},
    {"id": "breathing", "label": "Breathing activity", "icon": "◌", "path": "/destress", "kind": "self_care"},
    {"id": "buddy_connect", "label": "Buddy Connect", "icon": "⇄", "path": "/buddy", "kind": "connection"},
    {"id": "medic_connection", "label": "Medic Connection", "icon": "✚", "path": "/medic", "kind": "professional"},
    {"id": "supervisor_load", "label": "Supervisor load conversation", "icon": "⚑", "path": "/supervisor", "kind": "operational"},
    {"id": "rest_break", "label": "Planned rest / recovery break", "icon": "◐", "path": "/shifts", "kind": "self_care"},
    {"id": "wellbeing_checkin", "label": "Weekly Wellbeing Check-in", "icon": "▤", "path": "/wellbeing", "kind": "self_care"},
]

DEDUPE_HOURS = 4  # re-clicking the same support within 4h reuses the event


def _parse(iso):
    return datetime.fromisoformat(iso)


def catalog_view() -> list:
    return CATALOG


def catalog_item(item_id: str):
    return next((c for c in CATALOG if c["id"] == item_id), None)


def _latest_recovery(uid: str):
    rows = sorted(data_store.find("recovery_scores", lambda r: r["user_id"] == uid),
                  key=lambda r: r["computed_at"])
    return (rows[-1]["score"], rows[-1]["computed_at"]) if rows else (None, None)


# ---------- event lifecycle ----------

def record_engagement(uid: str, intervention_id: str, source: str = "dashboard") -> dict:
    """Detect→Recommend→Engage: the user tapped a support option.

    Re-taps within the dedupe window return the existing open event instead
    of inflating efficacy numbers.
    """
    item = catalog_item(intervention_id)
    if not item:
        return {"error": "Unknown support option."}
    cutoff = (datetime.now() - timedelta(hours=DEDUPE_HOURS)).isoformat(timespec="seconds")
    open_same = data_store.find_one("intervention_events", lambda e: e["user_id"] == uid
                                    and e["intervention_id"] == intervention_id
                                    and e["created_at"] >= cutoff)
    if open_same:
        return {"event": open_same, "reused": True}

    score, at = _latest_recovery(uid)
    event = {
        "id": data_store.new_id("ive"), "user_id": uid,
        "intervention_id": intervention_id,
        "source": source if source in ("dashboard", "recovery", "forecast", "insight", "assistant", "offline") else "dashboard",
        "recovery_before": score,
        "recovery_before_at": at,
        "created_at": data_store.now_iso(),
    }
    data_store.insert("intervention_events", event)
    data_store.audit(uid, "intervention.engaged", target=intervention_id,
                     detail={"source": event["source"]})
    return {"event": event, "reused": False}


def record_followup(uid: str, event_id: str, helpfulness=None) -> dict:
    """Follow up: observe the trend, invite a self-reported rating.

    The change is observational — recorded as 'observed change', with the
    status message phrased as a trend, never a causal claim.
    """
    event = data_store.find_one("intervention_events", lambda e: e["id"] == event_id)
    if not event or event["user_id"] != uid:
        return {"error": "That support follow-up is not on your record."}
    if data_store.find_one("intervention_followups", lambda f: f["event_id"] == event_id):
        return {"error": "This engagement already has a follow-up."}

    score, at = _latest_recovery(uid)
    if helpfulness is not None:
        try:
            helpfulness = int(helpfulness)
        except (TypeError, ValueError):
            return {"error": "Helpfulness rating must be 1–5."}
        if not 1 <= helpfulness <= 5:
            return {"error": "Helpfulness rating must be 1–5."}
    before = event.get("recovery_before")
    change = (score - before) if (score is not None and before is not None) else None
    if change is None:
        status = "No Recovery Score comparison available yet — check back after your next score."
    elif change >= 6:
        status = "Observed recovery trend improving since this support."
    elif change <= -6:
        status = "Observed recovery trend lower since this support — it may need more than one step, and that's okay."
    else:
        status = "Observed recovery change is small so far — trends need a few days."
    row = {
        "id": data_store.new_id("ivf"), "event_id": event_id, "user_id": uid,
        "recovery_after": score, "recovery_after_at": at,
        "observed_change": change,
        "helpfulness": helpfulness,
        "status": status,
        "created_at": data_store.now_iso(),
    }
    data_store.insert("intervention_followups", row)
    data_store.audit(uid, "intervention.followup", target=event["intervention_id"],
                     detail={"observed_change": change})
    return {"followup": row, "event": event}


def my_view(uid: str) -> dict:
    events = sorted(data_store.find("intervention_events", lambda e: e["user_id"] == uid),
                    key=lambda e: e["created_at"], reverse=True)
    followups = {f["event_id"]: f for f in data_store.find("intervention_followups",
                                                            lambda f: f["user_id"] == uid)}
    open_events, history = [], []
    for e in events[:40]:
        item = catalog_item(e["intervention_id"]) or {"label": e["intervention_id"], "icon": "✦", "path": "/dashboard"}
        fu = followups.get(e["id"])
        view = {
            "id": e["id"], "intervention_id": e["intervention_id"],
            "label": item["label"], "icon": item["icon"], "path": item["path"],
            "created_at": e["created_at"], "recovery_before": e.get("recovery_before"),
            "followup": None,
        }
        if fu:
            view["followup"] = {
                "recovery_after": fu.get("recovery_after"),
                "observed_change": fu.get("observed_change"),
                "status": fu.get("status"),
                "helpfulness": fu.get("helpfulness"),
                "created_at": fu["created_at"],
            }
            history.append(view)
        else:
            open_events.append(view)
    current_score, _ = _latest_recovery(uid)
    for v in open_events:
        if v["recovery_before"] is not None and current_score is not None:
            v["change_so_far"] = current_score - v["recovery_before"]
    return {"catalog": catalog_view(), "open": open_events[:5], "history": history[:12],
            "observational": ("These are observed trends around your support engagements — "
                              "not proof of cause, and never a diagnosis."), "demo": True}


# ---------- anonymized efficacy ----------

def efficacy() -> dict:
    """Aggregate insight across all engagements — anonymized by construction.

    No user ids, no per-person rows. Percentages appear only once the sample
    reaches MIN_SAMPLE; below that the UI is told to show "Insufficient data".
    """
    events = data_store.all_rows("intervention_events")
    followups = {f["event_id"]: f for f in data_store.all_rows("intervention_followups")}
    out = []
    for item in CATALOG:
        evs = [e for e in events if e["intervention_id"] == item["id"]]
        n = len(evs)
        changes = [followups[e["id"]]["observed_change"] for e in evs
                   if e["id"] in followups and followups[e["id"]].get("observed_change") is not None]
        helpful = [followups[e["id"]]["helpfulness"] for e in evs
                   if e["id"] in followups and followups[e["id"]].get("helpfulness") is not None]
        enough = n >= MIN_SAMPLE
        out.append({
            "intervention_id": item["id"], "label": item["label"], "icon": item["icon"],
            "engagements": n,
            "followups": len(changes),
            "positive_trend_pct": (round(100 * len([c for c in changes if c > 0]) / len(changes))
                                   if enough and changes else None),
            "avg_observed_change": (round(sum(changes) / len(changes), 1) if changes else None),
            "self_reported_helpful_avg": (round(sum(helpful) / len(helpful), 1) if helpful else None),
            "insufficient_data": not enough,
        })
    out.sort(key=lambda r: (r["insufficient_data"], -r["engagements"]))
    return {
        "rows": out,
        "min_sample": MIN_SAMPLE,
        "anonymized": True,
        "note": ("Aggregate, anonymized engagement patterns — observed trends only, "
                 "not causal evidence and never individual health data."),
        "demo": True,
    }
