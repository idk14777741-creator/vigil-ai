"""Demo seed data for VIGIL AI — Phase 1.

Creates the demo organisation, accounts for every role, unit assignments,
welcome notifications and an initial audit event. Runs only when the store is
empty, so restarting the server never duplicates data.
"""
from datetime import datetime, timedelta

import data_store
from security import hash_password


def _iso(minutes_ago: int) -> str:
    from datetime import datetime, timezone
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat(timespec="seconds")


DEMO_PASSWORD = "Vigil#2024"


def seed_if_empty() -> None:
    if data_store.all_rows("profiles"):
        return

    data_store.db()["units"].append({
        "id": "unit_alpha", "name": "Alpha Unit",
        "description": "Operations support unit — Phase 1 demo organisation.",
        "created_at": _iso(60 * 24 * 30),
    })

    def user(uid, email, name, role, color, minutes_ago):
        return {
            "id": uid, "email": email, "password_hash": hash_password(DEMO_PASSWORD),
            "full_name": name, "role": role, "unit_id": "unit_alpha" if role != "admin" else None,
            "phone": "", "avatar_color": color, "status": "active",
            "created_at": _iso(minutes_ago), "last_login_at": None,
        }

    profiles = [
        user("usr_admin", "admin@vigil.demo", "Arun Mehta", "admin", "violet", 60 * 24 * 30),
        user("usr_sup", "supervisor@vigil.demo", "Daniel Reiss", "supervisor", "amber", 60 * 24 * 29),
        user("usr_medic", "medic@vigil.demo", "Dr. Meera Rao", "medic", "rose", 60 * 24 * 29),
        user("usr_priya", "priya@vigil.demo", "Priya Nair", "personnel", "teal", 60 * 24 * 28),
        user("usr_rohan", "rohan@vigil.demo", "Rohan Gupta", "personnel", "blue", 60 * 24 * 27),
        user("usr_leila", "leila@vigil.demo", "Leila Khan", "personnel", "green", 60 * 24 * 26),
        # SIU demo persona A — the steady contrast (normal load, healthy recovery).
        user("usr_aarav", "aarav@vigil.demo", "Aarav Sharma", "personnel", "violet", 60 * 24 * 25),
    ]
    for p in profiles:
        data_store.db()["profiles"].append(p)

    for uid in ("usr_priya", "usr_rohan", "usr_leila", "usr_aarav", "usr_sup", "usr_medic"):
        data_store.db()["unit_members"].append({"unit_id": "unit_alpha", "user_id": uid, "added_at": _iso(60 * 24 * 25)})

    notifications = [
        ("usr_priya", "system", "Welcome to VIGIL AI", "Your account is ready. Start from the dashboard — your shifts, tasks and wellness overview live there.", "dashboard", 55),
        ("usr_priya", "shift", "Shift reminder", "Your next shift starts soon. Check the Shift Monitor for timings and break plan.", "shifts", 180),
        ("usr_priya", "support", "Medic Officer available", "Dr. Meera Rao is your assigned Medic Officer. You can reach her any time from the dashboard.", "support", 60 * 24),
        ("usr_rohan", "system", "Welcome to VIGIL AI", "Your account is ready. Start from the dashboard to see your overview.", "dashboard", 50),
        ("usr_aarav", "system", "Welcome to VIGIL AI", "Your account is ready. Start from the dashboard to see your overview.", "dashboard", 44),
        ("usr_leila", "system", "Welcome to VIGIL AI", "Your account is ready. Start from the dashboard to see your overview.", "dashboard", 45),
        ("usr_sup", "system", "Team ready", "Alpha Unit members are onboarded. Task assignment and shift views arrive in upcoming phases.", "team", 40),
        ("usr_medic", "system", "Assigned personnel", "You are the assigned Medic Officer for Alpha Unit personnel.", "support", 35),
        ("usr_admin", "system", "Platform ready", "Demo environment seeded. User management, content and audit logs are available in Admin.", "admin", 30),
    ]
    for uid, kind, title, body, link, mins in notifications:
        data_store.db()["notifications"].append({
            "id": data_store.new_id("ntf"), "user_id": uid, "kind": kind, "title": title,
            "body": body, "link": link, "read_at": None, "created_at": _iso(mins),
        })

    # ---- Phase 2: tasks (assigned by supervisor) ----
    from datetime import datetime, timedelta

    def due(days_ahead, hour=17):
        return (datetime.now() + timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()

    def created(days_ago, hour=9):
        return (datetime.now() - timedelta(days=days_ago)).replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()

    tasks = [
        # Priya — mixed statuses incl. one due today and one overdue
        ("usr_priya", "Complete weekly equipment inspection", "Check comms kit, first-aid pouch and torch against the manifest. Log anything missing.", "high", "in_progress", 65, due(0, 17), created(2)),
        ("usr_priya", "Submit Q3 readiness self-assessment", "Short self-assessment covering drills and contact cards.", "medium", "pending", 0, due(-1, 18), created(4)),
        ("usr_priya", "Review updated patrol route map", "Mark the two changed segments and confirm access notes.", "low", "completed", 100, due(-2, 16), created(6)),
        ("usr_priya", "Prep handover notes for Tuesday", "Bullet the open items so the next crew starts clean.", "medium", "pending", 0, due(2, 9), created(1)),
        # Rohan — recovering from extended duty, fewer tasks
        ("usr_rohan", "Restock vehicle med pouch", "Replace the two used tourniquet packs; log batch numbers.", "high", "pending", 0, due(1, 15), created(2)),
        ("usr_rohan", "File after-action summary", "Two paragraphs is plenty — what happened, what helped.", "medium", "pending", 0, due(3, 17), created(1)),
        # Leila — night crew
        ("usr_leila", "Verify night-watch check-in log", "All hourly check-ins present for the weekend pair.", "medium", "in_progress", 40, due(1, 20), created(3)),
        ("usr_leila", "Return loaned radio handsets", "Three handsets to stores; get the counter-signature.", "low", "completed", 100, due(-3, 12), created(8)),
    ]
    for assignee, title, desc, priority, status, progress, due_at, created_at in tasks:
        data_store.db()["tasks"].append({
            "id": data_store.new_id("tsk"), "title": title, "description": desc,
            "assignee_id": assignee, "created_by": "usr_sup", "unit_id": "unit_alpha",
            "priority": priority, "status": status, "progress": progress,
            "due_at": due_at, "remarks": "", "created_at": created_at, "updated_at": created_at,
        })

    # ---- Phase 2: support requests (mixed statuses for history) ----
    def req(rid, uid, mid, sid, category, desc, status, created_ago_h, updated_ago_h=None):
        return {
            "id": rid, "user_id": uid,
            "medic_id": mid, "supervisor_id": sid,
            "category": category, "description": desc, "status": status,
            "created_at": _iso(int(created_ago_h * 60)),
            "updated_at": _iso(int((updated_ago_h if updated_ago_h is not None else created_ago_h) * 60)),
        }

    requests = [
        req("mreq_priya_old", "usr_priya", "usr_medic", None, "illness",
            "Mild fever last week — asked about safe duty adjustments while it cleared.", "resolved", 24 * 9),
        req("mreq_priya_open", "usr_priya", "usr_medic", None, "follow_up",
            "Brief follow-up about hydration during long outdoor drills — a nurse suggested reviewing options.", "acknowledged", 26),
        req("sreq_priya_old", "usr_priya", None, "usr_sup", "shift_concern",
            "Asked about swapping a Saturday shift to attend a family event.", "resolved", 24 * 6),
        req("mreq_rohan", "usr_rohan", "usr_medic", None, "follow_up",
            "Follow-up on the extended duty night — checking in on fatigue levels.", "acknowledged", 20),
        req("sreq_rohan", "usr_rohan", None, "usr_sup", "work_issue",
            "Comms kit battery pack draining quickly; requested a replacement.", "in_progress", 30),
        req("sreq_leila", "usr_leila", None, "usr_sup", "general_support",
            "Requested a lighter block after the weekend night pair.", "open", 6),
    ]
    for r in requests:
        data_store.db()["medic_requests"].append(r) if r["medic_id"] else data_store.db()["supervisor_requests"].append(r)

    # ---- Phase 11: Message From Home demo story ----
    data_store.db()["support_contacts"].extend([
        {"id": "ctc_amma", "personnel_id": "usr_priya", "name": "Amma", "relationship": "Mother",
         "invite_code": "demo-invite-amma-0001", "status": "active", "created_at": _iso(60 * 24 * 15)},
        {"id": "ctc_vikram", "personnel_id": "usr_priya", "name": "Vikram", "relationship": "Partner",
         "invite_code": "demo-invite-vikram-0002", "status": "active", "created_at": _iso(60 * 24 * 12)},
    ])
    data_store.db()["support_videos"].extend([
        {"id": "spv_amma_1", "contact_id": "ctc_amma", "personnel_id": "usr_priya",
         "title": "Your favourite curry is waiting", "message": "Eat properly, beta. The house is too quiet without your laughing. We are so proud of you.",
         "storage_path": None, "duration_sec": 42, "watched_at": None, "hidden_at": None,
         "created_at": _iso(60 * 30)},
        {"id": "spv_vikram_1", "contact_id": "ctc_vikram", "personnel_id": "usr_priya",
         "title": "Rocky says hi (loudly)", "message": "The dog misses you more than I do. Somehow. Take your break today — that's an order from home. Love you.",
         "storage_path": None, "duration_sec": 38, "watched_at": None, "hidden_at": None,
         "created_at": _iso(60 * 6)},
    ])
    data_store.db()["notifications"].append({
        "id": "ntf_home_vikram", "user_id": "usr_priya", "kind": "message_home",
        "title": "New message from home",
        "body": "Vikram sent you: Rocky says hi (loudly)",
        "link": "/home", "read_at": None, "created_at": _iso(60 * 6),
    })

    # ---- Phase 10 + SIU phase 8: buddy demo story ----
    # Leila shares presence + recovery score with Rohan — a lived-in example
    # of consent-controlled sharing the judge can toggle live.
    data_store.db()["buddy_connections"].append({
        "id": "bdy_rohan_leila",
        "requester_id": "usr_rohan", "addressee_id": "usr_leila",
        "status": "accepted",
        "share_scope": {"presence": True, "task_status": False, "shift_info": False,
                        "recovery_score": True, "sleep": False, "wellness_trends": False},
        "created_at": _iso(60 * 24 * 10), "updated_at": _iso(60 * 24 * 10),
    })
    for i, (sender, text, mins) in enumerate([
        ("usr_rohan", "Hey — long week. Thinking of doing the coastal walk Sunday if the weather holds. In?", 60 * 26),
        ("usr_leila", "In. I finish the night pair Saturday morning, so Sunday afternoon works best for me.", 60 * 25),
        ("usr_rohan", "Afternoon it is. Bring the good thermos.", 60 * 24),
    ]):
        data_store.db()["buddy_messages"].append({
            "id": f"bms_seed_{i}", "connection_id": "bdy_rohan_leila",
            "sender_id": sender, "body": text, "read_at": None,
            "created_at": _iso(mins),
        })
    data_store.db()["buddy_connections"].append({
        "id": "bdy_priya_leila",
        "requester_id": "usr_leila", "addressee_id": "usr_priya",
        "status": "pending",
        "share_scope": {"presence": False, "task_status": False},
        "created_at": _iso(90), "updated_at": _iso(90),
    })
    data_store.db()["notifications"].append({
        "id": "ntf_buddy_priya", "user_id": "usr_priya", "kind": "buddy",
        "title": "Buddy request",
        "body": "Leila Khan would like to connect as your buddy.",
        "link": "/buddy", "read_at": None, "created_at": _iso(90),
    })

    # ---- Phase 9: music catalog (generative recipes — no copyrighted audio) ----
    def track(title, category, dur, gen):
        return {
            "id": "trk_" + title.lower().replace(" ", "_")[:20],
            "title": title, "artist": "VIGIL AI Studio", "category": category,
            "storage_path": None, "duration_sec": dur, "is_active": True,
            "uploaded_by": "usr_admin", "created_at": _iso(60 * 24 * 20), "gen_params": gen,
        }

    tracks = [
        track("Slow Harbour", "calm", 240, {"base": 174, "pad": "warm", "texture": "waves", "tempo": 40}),
        track("Morning Here", "calm", 210, {"base": 196, "pad": "warm", "texture": "breeze", "tempo": 48}),
        track("Low Tide Rest", "relaxation", 260, {"base": 146, "pad": "soft", "texture": "waves", "tempo": 34}),
        track("Shoulders Down", "relaxation", 230, {"base": 130, "pad": "soft", "texture": "rain", "tempo": 30}),
        track("Steady Focus", "focus", 300, {"base": 220, "pad": "airy", "texture": "none", "tempo": 60}),
        track("One Clear Thing", "focus", 280, {"base": 246, "pad": "airy", "texture": "breeze", "tempo": 56}),
        track("Night Window", "sleep", 320, {"base": 110, "pad": "dark", "texture": "rain", "tempo": 26}),
        track("Safe and Still", "sleep", 340, {"base": 98, "pad": "dark", "texture": "waves", "tempo": 22}),
        track("Wide Open", "ambient", 300, {"base": 164, "pad": "airy", "texture": "wind", "tempo": 36}),
        track("Signal Drift", "ambient", 280, {"base": 155, "pad": "airy", "texture": "none", "tempo": 32}),
        track("Someone Waiting", "comfort", 250, {"base": 138, "pad": "warm", "texture": "breeze", "tempo": 44}),
        track("Warm Room", "comfort", 260, {"base": 120, "pad": "warm", "texture": "rain", "tempo": 38}),
    ]
    for t in tracks:
        data_store.db()["music_tracks"].append(t)

    # ---- Phase 9: de-stress videos (demo placeholders) ----
    def video(vid, title, category, dur, desc):
        return {
            "id": vid, "title": title, "category": category,
            "storage_path": None, "duration_sec": dur, "description": desc,
            "is_active": True, "created_at": _iso(60 * 24 * 20),
        }

    videos = [
        video("vid_breath_446", "Box breathing, guided", "breathing", 180,
              "Four counts in, four held, four out, four held. A steady reset you can do anywhere, even in uniform."),
        video("vid_breath_478", "Long exhale calm-down", "breathing", 150,
              "Exhaling longer than you inhale nudges the body toward rest. Great after a hard call."),
        video("vid_relax_scan", "Full-body release scan", "relaxation", 420,
              "A slow head-to-toe scan that lets tension go piece by piece."),
        video("vid_mind_3min", "Three-minute pause", "mindfulness", 180,
              "A short, kind reset between tasks — no experience needed."),
        video("vid_stretch_shift", "After-shift stretch", "stretching", 360,
              "Gentle stretches for neck, shoulders and back after long hours on your feet."),
        video("vid_sleep_winddown", "Wind-down for sleep", "sleep", 540,
              "Dim-light guidance to slow the evening and prepare for deep rest."),
        video("vid_pos_home", "Messages of encouragement", "positive", 240,
              "A short montage of reminders: you're allowed to rest, and you're not alone."),
    ]
    for v in videos:
        data_store.db()["destress_videos"].append(v)

    # ---- Phase 12: Medic Connection demo story ----
    # Rohan has authorized Dr. Rao to see his wellness; Priya has not (yet).
    data_store.db()["medic_request_messages"].extend([
        {"id": "mrm_1", "request_id": "mreq_priya_open", "sender_id": "usr_medic",
         "body": "Happy to help with this. Drink something with electrolytes before long drills — even a small bottle helps more than you'd think.",
         "created_at": _iso(24 * 60)},
        {"id": "mrm_2", "request_id": "mreq_rohan", "sender_id": "usr_medic",
         "body": "Thanks for flagging the long night. Nothing alarming there — but keep an eye on how you sleep this week and tell me if it stays rough.",
         "created_at": _iso(18 * 60)},
        {"id": "mrm_3", "request_id": "mreq_rohan", "sender_id": "usr_rohan",
         "body": "Will do. Slept better last night actually.",
         "created_at": _iso(16 * 60)},
    ])
    data_store.db()["wellness_authorizations"].append({
        "id": "wla_rohan", "personnel_id": "usr_rohan", "medic_id": "usr_medic",
        "authorized": True, "updated_at": _iso(20 * 60),
    })
    # Supervisor thread already in motion on Leila's open request.
    data_store.db()["supervisor_request_messages"].extend([
        {"id": "srm_1", "request_id": "sreq_leila", "sender_id": "usr_sup",
         "body": "Thanks for flagging this early — that's exactly the right move. Let me look at the roster and come back to you tomorrow.",
         "created_at": _iso(4 * 60)},
    ])

    # ---- Phase 14: Incident Reporting demo story ----
    from datetime import datetime, timezone
    data_store.db()["incidents"].extend([
        {"id": "inc_rohan_near", "reporter_id": "usr_rohan", "incident_type": "near_miss",
         "occurred_on": (datetime.now(timezone.utc) - timedelta(days=4)).date().isoformat(),
         "occurred_at": "02:40", "location": "North gate, perimeter patrol",
         "description": "While repositioning a barricade during the night patrol it slipped before the base locked in. No one was hurt — flagging so the procedure or the lighting can be reviewed.",
         "people_involved": "Just me", "severity": "medium",
         "immediate_action": "Re-did the placement with a second person steadying it.",
         "status": "escalated", "assigned_to": "usr_sup", "resolution": None,
         "created_at": _iso(3 * 24 * 60), "updated_at": _iso(1 * 24 * 60)},
        {"id": "inc_priya_old", "reporter_id": "usr_priya", "incident_type": "operational",
         "occurred_on": (datetime.now(timezone.utc) - timedelta(days=12)).date().isoformat(),
         "occurred_at": "16:15", "location": "Comms room",
         "description": "Brief radio outage during the afternoon handover; fallback protocol worked as intended and the outage was logged with the vendor.",
         "people_involved": "Priya Nair, duty engineer", "severity": "low",
         "immediate_action": "Switched to backup handset for the remainder of the shift.",
         "status": "closed", "resolution": "Vendor replaced the faulty antenna splitter; retested across three shifts with no recurrence.",
         "created_at": _iso(12 * 24 * 60), "updated_at": _iso(8 * 24 * 60)},
    ])
    data_store.db()["incident_updates"].extend([
        {"id": "inu_1", "incident_id": "inc_rohan_near", "author_id": "usr_sup",
         "body": "Thanks for reporting this the same night — that's exactly what the process is for. Reviewing the lighting levels at the north gate this week.",
         "created_at": _iso(2 * 24 * 60)},
        {"id": "inu_2", "incident_id": "inc_rohan_near", "author_id": "usr_sup",
         "body": "Escalated to the site facilities lead: two more near-misses at the north gate this quarter. Lighting survey is booked; interim cones placed and a buddy rule applies after dark.",
         "created_at": _iso(1 * 24 * 60)},
    ])

    # ---- anchor demo time-series data to the seed moment ----
    import demo_data
    demo_data.build_all()

    # ---- Intelligence layer seed (runs AFTER the time-series exists so the
    # intervention history can reference real seeded Recovery Scores) ----
    from datetime import datetime as _dt, timedelta as _td

    # Weekly Wellbeing Check-in — Priya on a gentle upward trend (matches her
    # recovery story: load easing, support working). One row per week (upsert key).
    _wb_seed = [
        ("usr_priya", 54, 4), ("usr_priya", 58, 3), ("usr_priya", 61, 2),
        ("usr_priya", 64, 1), ("usr_priya", 67, 0),
        ("usr_rohan", 62, 2), ("usr_rohan", 60, 1), ("usr_rohan", 58, 0),
        ("usr_leila", 70, 3), ("usr_leila", 72, 2),
        ("usr_aarav", 74, 4), ("usr_aarav", 76, 3), ("usr_aarav", 75, 2), ("usr_aarav", 78, 1),
    ]
    for uid, score, weeks_ago in _wb_seed:
        week_start = (_dt.now() - _td(days=_dt.now().weekday() + 7 * weeks_ago))
        ws = week_start.date().isoformat()
        data_store.db()["wellbeing_checkins"].append({
            "id": data_store.new_id("wbc"), "user_id": uid, "week_start": ws,
            "answers": {}, "score": score,
            "created_at": week_start.isoformat(timespec="seconds"),
            "updated_at": week_start.isoformat(timespec="seconds"),
        })

    # Intervention history — every engagement/follow-up is DERIVED from the
    # seeded Recovery Score rows (before = score that day, after = score two
    # rows later), so the efficacy aggregates are real arithmetic over demo
    # data, never invented percentages. Rare supports stay below the minimum
    # sample on purpose — the UI then honestly shows "Insufficient data".
    _pattern = {
        "usr_priya": ["destress_zone", "buddy_connect", "destress_zone", "wellbeing_checkin"],
        "usr_rohan": ["destress_zone", "breathing", "destress_zone", "medic_connection", "destress_zone"],
        "usr_leila": ["buddy_connect", "destress_zone", "buddy_connect", "destress_zone", "buddy_connect"],
        "usr_aarav": ["destress_zone", "wellbeing_checkin"],
    }
    for uid, pattern in _pattern.items():
        rows = sorted([r for r in data_store.db()["recovery_scores"] if r["user_id"] == uid],
                      key=lambda r: r["computed_at"])
        # Older rows only — Priya's last-3-day story is seeded live below.
        usable = rows[:-3] if uid == "usr_priya" else rows[:-2]
        for i, r in enumerate(usable):
            if i % 2 != 0 or i + 2 >= len(rows):
                continue  # roughly every other day, and only where a follow-up exists
            after_row = rows[i + 2]
            iv_id = pattern[i % len(pattern)]
            evt_id = f"ive_seed_{uid}_{i}"
            change = after_row["score"] - r["score"]
            if change >= 6:
                st = "Observed recovery trend improving since this support."
            elif change <= -6:
                st = "Observed recovery trend lower since this support — it may need more than one step, and that's okay."
            else:
                st = "Observed recovery change is small so far — trends need a few days."
            data_store.db()["intervention_events"].append({
                "id": evt_id, "user_id": uid, "intervention_id": iv_id,
                "source": ["insight", "recovery", "forecast"][i % 3],
                "recovery_before": r["score"], "recovery_before_at": r["computed_at"],
                "created_at": r["computed_at"]})
            data_store.db()["intervention_followups"].append({
                "id": f"ivf_seed_{uid}_{i}", "event_id": evt_id, "user_id": uid,
                "recovery_after": after_row["score"], "recovery_after_at": after_row["computed_at"],
                "observed_change": change, "helpfulness": 3 + (i % 3),
                "status": st, "created_at": after_row["computed_at"]})

    # Priya's live demo loop: a closed De-Stress engagement the evening the
    # heavy stretch began (before = the dip-day score, after = today)...
    _prows = sorted([r for r in data_store.db()["recovery_scores"] if r["user_id"] == "usr_priya"],
                    key=lambda r: r["computed_at"])
    _demo_at = _iso(60 * 23)  # the morning after the first heavy night — the dip day
    _before = None
    for r in _prows:
        if r["computed_at"] <= _demo_at:
            _before = r["score"]
    _after = _prows[-1]["score"] if _prows else None
    _change = (_after - _before) if (_after is not None and _before is not None) else None
    if _change is None:
        _status = "No Recovery Score comparison available yet — check back after your next score."
    elif _change >= 6:
        _status = "Observed recovery trend improving since this support."
    elif _change <= -6:
        _status = "Observed recovery trend lower since this support — it may need more than one step, and that's okay."
    else:
        _status = "Observed recovery change is small so far — trends need a few days."
    data_store.db()["intervention_events"].append({
        "id": "ive_demo_priya", "user_id": "usr_priya", "intervention_id": "destress_zone",
        "source": "recovery", "recovery_before": _before, "recovery_before_at": _demo_at,
        "created_at": _demo_at})
    data_store.db()["intervention_followups"].append({
        "id": "ivf_demo_priya", "event_id": "ive_demo_priya", "user_id": "usr_priya",
        "recovery_after": _after, "recovery_after_at": _iso(0),
        "observed_change": _change, "helpfulness": 4, "status": _status,
        "created_at": _iso(60 * 2),
    })
    # ...and one OPEN Buddy engagement later that day so the follow-up panel
    # has a live "check in now" card in the demo.
    _y = _iso(60 * 20)
    _b_before = None
    for r in _prows:
        if r["computed_at"] <= _y:
            _b_before = r["score"]
    data_store.db()["intervention_events"].append({
        "id": "ive_demo_priya_buddy", "user_id": "usr_priya", "intervention_id": "buddy_connect",
        "source": "insight", "recovery_before": _b_before, "recovery_before_at": _y,
        "created_at": _y})

    # A couple of on-device anomaly results (minimal payload — as stored).
    data_store.db()["anomaly_events"].append({
        "id": "ano_demo_priya", "user_id": "usr_priya", "status": "elevated_fatigue_pattern",
        "confidence": 0.81, "model": "on_device_heuristic_v1",
        "detected_at": _iso(60 * 26), "demo": True})
    data_store.db()["anomaly_events"].append({
        "id": "ano_demo_aarav", "user_id": "usr_aarav", "status": "steady_pattern",
        "confidence": 0.92, "model": "on_device_heuristic_v1",
        "detected_at": _iso(60 * 30), "demo": True})

    data_store.audit("usr_admin", "system.seed", target="demo environment", detail={"profiles": len(profiles)})
    data_store.save()
    print(f"Seeded demo data: {len(profiles)} accounts, unit 'Alpha Unit', {len(tasks)} tasks, {len(requests)} support requests, {len(tracks)} tracks, {len(videos)} videos.")
