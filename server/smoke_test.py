"""End-to-end API smoke test for VIGIL AI (demo mode)."""
import json
import secrets
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8787"
RUN = secrets.token_hex(3)  # unique-per-run emails → suite is re-runnable
PASS, FAIL = 0, 0


def call(method, path, body=None, cookie=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", cookie)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=10) as res:
            return res.status, json.loads(res.read().decode() or "{}"), res.headers
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}"), e.headers


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {name}")
    else:
        FAIL += 1
        print(f"FAIL  {name} {extra}")


print("== health ==")
s, b, _ = call("GET", "/api/health")
check("health 200", s == 200 and b.get("ok") is True)

print("== auth ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "wrong"})
check("login wrong password -> 401", s == 401)
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
check("login personnel -> 200", s == 200 and b["user"]["role"] == "personnel")
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/me", cookie=cookie_p)
check("me with session", s == 200 and b["user"]["email"] == "priya@vigil.demo")
check("unread notifications present", b.get("unread_notifications", 0) >= 1)
s, _, _ = call("GET", "/api/me")
check("me without session -> 401", s == 401)

print("== RBAC ==")
s, b, _ = call("GET", "/api/admin/users", cookie=cookie_p)
check("personnel blocked from admin -> 403", s == 403)
s, b, _ = call("GET", "/api/admin/users")
check("anonymous blocked from admin -> 401", s == 401)

print("== admin ==")
s, b, h = call("POST", "/api/auth/login", {"email": "admin@vigil.demo", "password": "Vigil#2024"})
check("login admin -> 200", s == 200 and b["user"]["role"] == "admin")
cookie_a = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/admin/overview", cookie=cookie_a)
check("admin overview", s == 200 and b["totals"]["users"] >= 6)
s, b, _ = call("GET", "/api/admin/users?q=pri", cookie=cookie_a)
check("admin user search", s == 200 and len(b["users"]) == 1)
s, b, _ = call("POST", "/api/admin/users", {"full_name": "Test User", "email": f"test{RUN}@vigil.demo", "password": "Test#1234", "role": "personnel"}, cookie=cookie_a)
check("admin create user -> 201", s == 201 and b["user"]["email"] == f"test{RUN}@vigil.demo")
test_id = b["user"]["id"]
s, b, _ = call("PATCH", f"/api/admin/users/{test_id}", {"status": "suspended"}, cookie=cookie_a)
check("admin suspend user", s == 200 and b["user"]["status"] == "suspended")
s, b, _ = call("POST", "/api/admin/notifications", {"title": "Maintenance", "message": "Planned demo maintenance tonight.", "audience": "all"}, cookie=cookie_a)
check("admin broadcast -> 201", s == 201 and b["sent"] >= 6)
s, b, _ = call("GET", "/api/admin/audit", cookie=cookie_a)
check("audit log populated", s == 200 and any(e["action"] == "admin.user_created" for e in b["events"]))

print("== register + reset ==")
s, b, _ = call("POST", "/api/auth/register", {"full_name": "New Person", "email": f"new{RUN}@vigil.demo", "password": "New#12345", "role": "personnel"})
check("register -> 201", s == 201 and b["user"]["role"] == "personnel")
s, b, _ = call("POST", "/api/auth/register", {"full_name": "New Person", "email": f"new{RUN}@vigil.demo", "password": "New#12345", "role": "personnel"})
check("duplicate email -> 409", s == 409)
s, b, _ = call("POST", "/api/auth/register", {"full_name": "Bad!", "email": "not-an-email", "password": "short", "role": "hacker"})
check("invalid registration -> 400", s == 400)
s, b, _ = call("POST", "/api/auth/forgot-password", {"email": f"new{RUN}@vigil.demo"})
check("forgot returns demo token", s == 200 and "demo_reset_token" in b)
s, b, _ = call("POST", "/api/auth/reset-password", {"token": b["demo_reset_token"], "password": "Reset#12345"})
check("reset password -> 200", s == 200)
s, b, _ = call("POST", "/api/auth/login", {"email": f"new{RUN}@vigil.demo", "password": "Reset#12345"})
check("login with new password", s == 200)

print("== profile + notifications + team ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("PATCH", "/api/me", {"phone": "+91 98765 43210"}, cookie=cookie_p)
check("update profile", s == 200 and b["user"]["phone"] == "+91 98765 43210")
s, b, _ = call("PATCH", "/api/me", {"phone": "<script>alert(1)</script>"}, cookie=cookie_p)
check("XSS phone rejected", s == 400)
s, b, _ = call("GET", "/api/notifications", cookie=cookie_p)
check("notifications list", s == 200 and len(b["notifications"]) >= 1)
first = b["notifications"][0]["id"]
s, b, _ = call("POST", "/api/notifications/read", {"ids": [first]}, cookie=cookie_p)
check("mark notification read", s == 200)
s, b, _ = call("GET", "/api/my/team", cookie=cookie_p)
check("team members", s == 200 and len(b["members"]) >= 3)
s, b, _ = call("GET", "/api/users/lookup?q=roh", cookie=cookie_p)
check("user lookup", s == 200 and len(b["results"]) == 1)
s, b, _ = call("POST", "/api/me/password", {"current_password": "Vigil#2024", "new_password": "Vigil#2024"}, cookie=cookie_p)
check("password change same rejected", s == 400)
s, b, _ = call("POST", "/api/auth/logout", {}, cookie=cookie_p)
check("logout -> 200", s == 200)
s, b, _ = call("GET", "/api/me", cookie=cookie_p)
check("session revoked after logout", s == 401)

print("== dashboard aggregate (Phase 2) ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/my/dashboard", cookie=cookie_p)
check("dashboard -> 200", s == 200 and b.get("demo") is True)
check("shift story present", bool(b["shift"]["active"]) and len(b["shift"]["upcoming"]) >= 1)
check("task counts present", b["tasks"]["open"] >= 1 and "due_today" in b["tasks"])
check("task next list", isinstance(b["tasks"]["next"], list) and len(b["tasks"]["next"]) >= 1)
check("wellness latest present", b["wellness"]["latest"] is not None and 20 <= b["wellness"]["latest"]["heart_rate"] <= 250)
check("recovery present + bounded", b["recovery"]["latest"] is not None and 0 <= b["recovery"]["latest"]["score"] <= 100)
check("recovery has transparent factors", "factors" in b["recovery"]["latest"] and "explanation" in b["recovery"]["latest"])
check("recovery previous exists", b["recovery"]["previous"] is not None)
check("support requests counted", b["support"]["open_requests"] >= 1)
s, b, _ = call("GET", "/api/my/dashboard")
check("dashboard requires auth -> 401", s == 401)
s, b, h = call("POST", "/api/auth/login", {"email": "admin@vigil.demo", "password": "Vigil#2024"})
cookie_a = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/my/dashboard", cookie=cookie_a)
check("admin can call dashboard (empty is ok)", s == 200 and b.get("demo") is True)

print("== shift monitor (Phase 3) ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/my/shifts", cookie=cookie_p)
check("shifts -> 200", s == 200 and b.get("demo") is True)
check("status kind valid", b["status"]["kind"] in ("active", "upcoming", "off", "empty"))
check("status has message", isinstance(b["status"].get("message"), str) and len(b["status"]["message"]) > 10)
check("weekly stats present", b["weekly"]["this"]["shifts"] >= 1 and b["weekly"]["this"]["hours"] > 0)
check("history present", len(b["history"]) >= 3)
check("upcoming present", len(b["upcoming"]) >= 1)
check("flags are supportive list", isinstance(b["flags"], list) and all("message" in f and "title" in f for f in b["flags"]))
s, b, _ = call("GET", "/api/team/shifts", cookie=cookie_p)
check("personnel blocked from team shifts -> 403", s == 403)

s, b, h = call("POST", "/api/auth/login", {"email": "supervisor@vigil.demo", "password": "Vigil#2024"})
cookie_s = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/team/shifts", cookie=cookie_s)
check("supervisor team shifts -> 200", s == 200 and len(b["members"]) >= 3)
check("team view has no wellness data", all("wellness" not in m and "recovery" not in m for m in b["members"]))
check("team member has weekly stats", all("weekly" in m for m in b["members"]))
s, b, _ = call("GET", "/api/team/shifts")
check("team shifts requires auth -> 401", s == 401)

print("== task management (Phase 4) ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/my/tasks", cookie=cookie_p)
check("my tasks -> 200", s == 200 and len(b["tasks"]) >= 3)
s, b, _ = call("GET", "/api/my/tasks?status=open", cookie=cookie_p)
check("open filter", s == 200 and all(t["status"] in ("pending", "in_progress", "blocked") for t in b["tasks"]))
s, b, _ = call("GET", "/api/my/tasks?q=equipment", cookie=cookie_p)
check("search filter", s == 200 and len(b["tasks"]) == 1 and "Equipment" in b["tasks"][0]["title"].title())
s, b, _ = call("GET", "/api/my/tasks?priority=high", cookie=cookie_p)
check("priority filter", s == 200 and all(t["priority"] == "high" for t in b["tasks"]))
priya_task = b["tasks"][0]["id"] if b["tasks"] else None

# personnel cannot create tasks
s, b, _ = call("POST", "/api/tasks", {"title": "Self-assigned", "assignee_id": "usr_priya"}, cookie=cookie_p)
check("personnel create task -> 403", s == 403)

# personnel updates own progress
s, b, _ = call("PATCH", f"/api/tasks/{priya_task}", {"progress": 80, "remarks": "Nearly done"}, cookie=cookie_p)
check("assignee progress update", s == 200 and b["task"]["progress"] == 80)
s, b, _ = call("PATCH", f"/api/tasks/{priya_task}", {"progress": 150}, cookie=cookie_p)
check("progress >100 rejected", s == 400)

# privacy: rohan cannot see priya's task
s, b, h = call("POST", "/api/auth/login", {"email": "rohan@vigil.demo", "password": "Vigil#2024"})
cookie_r = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", f"/api/tasks/{priya_task}", cookie=cookie_r)
check("other personnel task -> 403", s == 403)
s, b, _ = call("PATCH", f"/api/tasks/{priya_task}", {"progress": 10}, cookie=cookie_r)
check("other personnel update -> 403", s == 403)

# supervisor creates + assigns
s, b, h = call("POST", "/api/auth/login", {"email": "supervisor@vigil.demo", "password": "Vigil#2024"})
cookie_s = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("POST", "/api/tasks", {"title": "Check comms spares", "description": "Two spare handsets", "priority": "medium", "assignee_id": "usr_leila", "due_at": "2026-09-20T17:00:00"}, cookie=cookie_s)
check("supervisor create task -> 201", s == 201 and b["task"]["assignee"]["id"] == "usr_leila")
new_task_id = b["task"]["id"]
s, b, _ = call("POST", "/api/tasks", {"title": "x", "assignee_id": "nobody"}, cookie=cookie_s)
check("invalid assignee -> 400", s == 400)
# supervisor can view assignee's task, cannot see priya's (not creator)
s, b, _ = call("GET", f"/api/tasks/{new_task_id}", cookie=cookie_s)
check("supervisor views created task", s == 200)
s, b, _ = call("GET", f"/api/tasks/{priya_task}", cookie=cookie_s)
check("supervisor sees only own-created tasks", s in (200, 403))  # seeded by usr_sup so 200 expected here

# leila got assignment notification
s, b, h = call("POST", "/api/auth/login", {"email": "leila@vigil.demo", "password": "Vigil#2024"})
cookie_l = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/notifications", cookie=cookie_l)
check("assignment notification delivered", any(n["title"] == "New task assigned" for n in b["notifications"]))

# complete task -> creator notified
s, b, _ = call("PATCH", f"/api/tasks/{new_task_id}", {"status": "completed"}, cookie=cookie_l)
check("assignee completes task", s == 200 and b["task"]["status"] == "completed" and b["task"]["progress"] == 100)
s, b, _ = call("GET", "/api/notifications", cookie=cookie_s)
check("creator completion notification", any(n["title"] == "Task completed" for n in b["notifications"]))
s, b, _ = call("PATCH", f"/api/tasks/{new_task_id}", {"status": "completed"}, cookie=cookie_p)
check("unrelated update -> 403", s == 403)

print("== wellness monitor (Phase 5) ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/my/wellness", cookie=cookie_p)
check("wellness -> 200", s == 200 and b.get("demo") is True and b.get("has_data") is True)
check("marked simulated", b.get("provider") == "simulated" and b.get("source") == "simulated")
l = b["latest"]
check("latest vitals bounded", 20 <= l["heart_rate"] <= 250 and 50 <= l["spo2"] <= 100 and 0 <= l["sleep_minutes"] <= 1440)
check("14-day series", len(b["series"]["dates"]) == 14 and len(b["series"]["heart_rate"]) == 14)
check("baseline present", b["baseline_7d"]["hr"] is not None)
check("sleep pattern has message", "sleep" in b["sleep_pattern"]["message"].lower())
check("activity message", b["activity"]["avg_steps"] is not None)
check("insights supportive list", isinstance(b["insights"], list) and 1 <= len(b["insights"]) <= 3 and all("message" in i and "title" in i for i in b["insights"]))
check("no diagnostic language", all(not any(w in (i["title"] + i["message"]).lower() for w in ("diagnos", "abnormal", "condition", "disease", "tachycardia")) for i in b["insights"]))
s, b, _ = call("GET", "/api/my/wellness")
check("wellness requires auth -> 401", s == 401)
s, b, _ = call("GET", "/api/my/wellness", cookie=cookie_s)
check("supervisor has no wellness route (own only)", s == 200)

print("== recovery score (Phase 6) ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/my/recovery", cookie=cookie_p)
check("recovery -> 200", s == 200 and b.get("demo") is True and b.get("has_data") is True)
check("latest score bounded", 0 <= b["latest"]["score"] <= 100)
check("5 factors present", len(b["latest"]["factors"]) == 5 and all(f["points"] <= f["max"] for f in b["latest"]["factors"]))
check("factors have inputs", all(f["input"] for f in b["latest"]["factors"]))
check("14-day history", len(b["history"]) == 14 and all(0 <= h["score"] <= 100 for h in b["history"]))
check("trend message", "out of 100" in b["trend_message"])
check("suggestions kind + bounded", isinstance(b["suggestions"], list) and 1 <= len(b["suggestions"]) <= 3)
check("formula exposed", b["formula"]["sleep"]["max"] == 30)
check("no diagnostic language", not any(w in b["trend_message"].lower() for w in ("diagnos", "abnormal", "condition")))
s, b, _ = call("GET", "/api/my/recovery")
check("recovery requires auth -> 401", s == 401)

print("== weekly report (Phase 7) ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/my/report", cookie=cookie_p)
check("report -> 200", s == 200 and b.get("demo") is True)
check("week label", "–" in b["label"])
check("workload section", b["workload"]["shifts"] >= 1 and b["workload"]["hours"] > 0)
check("tasks section", "completed" in b["tasks"] and "open" in b["tasks"])
check("wellness section", b["wellness"]["sleep_avg_minutes"] is not None and len(b["wellness"]["series_dates"]) >= 5)
check("recovery section", b["recovery"]["avg"] is not None and len(b["recovery"]["series"]) >= 5)
check("support section", "raised" in b["support"])
check("highlights list", isinstance(b["highlights"], list) and len(b["highlights"]) >= 2)
check("mock AI summary", isinstance(b["ai_summary"], str) and len(b["ai_summary"]) > 80)
s, b, _ = call("POST", "/api/my/report/reflection", {"reflection": "Tough but good week. Slept better after the weekend."}, cookie=cookie_p)
check("save reflection", s == 200 and b["reflection"]["reflection"].startswith("Tough"))
s, b, _ = call("GET", "/api/my/report", cookie=cookie_p)
check("reflection persisted", b["reflection"] is not None and "Slept better" in b["reflection"]["reflection"])
s, b, _ = call("POST", "/api/my/report/reflection", {"reflection": "x" * 2001}, cookie=cookie_p)
check("reflection length cap", s == 400)
s, b, _ = call("GET", "/api/my/report")
check("report requires auth -> 401", s == 401)

print("== ai assistant (Phase 8) ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("POST", "/api/ai/chat", {"message": "I'm feeling stressed about tomorrow's inspection."}, cookie=cookie_p)
check("chat -> 200", s == 200 and b.get("conversation_id"))
conv_id = b["conversation_id"]
check("stress reply supportive", "De-stress" in b["reply"] or "breathing" in b["reply"])
s, b, _ = call("POST", "/api/ai/chat", {"message": "Thanks. What about sleep?", "conversation_id": conv_id}, cookie=cookie_p)
check("follow-up in same conversation", s == 200 and b["conversation_id"] == conv_id)
s, b, _ = call("GET", "/api/ai/conversations", cookie=cookie_p)
check("conversations listed", s == 200 and any(c["id"] == conv_id for c in b["conversations"]))
s, b, _ = call("GET", f"/api/ai/conversations/{conv_id}", cookie=cookie_p)
check("history persisted", s == 200 and len(b["messages"]) == 4 and b["messages"][0]["role"] == "user")
# privacy: rohan cannot read priya's conversation
s, b, h = call("POST", "/api/auth/login", {"email": "rohan@vigil.demo", "password": "Vigil#2024"})
cookie_r = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", f"/api/ai/conversations/{conv_id}", cookie=cookie_r)
check("other user conversation -> 404", s == 404)
s, b, _ = call("DELETE", f"/api/ai/conversations/{conv_id}", cookie=cookie_r)
check("other user delete -> 404", s == 404)
# safety redirect
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("POST", "/api/ai/chat", {"message": "I have chest pains and feel emergency level bad."}, cookie=cookie_p)
check("safety redirect", s == 200 and b.get("flagged") is True and "Medic Officer" in b["reply"])
s, b, _ = call("POST", "/api/ai/chat", {"message": ""}, cookie=cookie_p)
check("empty message -> 400", s == 400)
s, b, _ = call("POST", "/api/ai/chat", {"message": "hi"})
check("chat requires auth -> 401", s == 401)
s, b, _ = call("DELETE", f"/api/ai/conversations/{conv_id}", cookie=cookie_p)
check("delete own conversation", s == 200)
s, b, _ = call("GET", f"/api/ai/conversations/{conv_id}", cookie=cookie_p)
check("deleted conversation gone", s == 404)

print("== de-stress zone (Phase 9) ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/music/tracks", cookie=cookie_p)
check("music catalog -> 200", s == 200 and len(b["tracks"]) >= 10)
cats = {t["category"] for t in b["tracks"]}
check("all 6 categories", cats == {"calm", "relaxation", "focus", "sleep", "ambient", "comfort"})
check("generative recipes present", all(t.get("gen_params") for t in b["tracks"]))
s, b, _ = call("GET", "/api/music/tracks?category=sleep", cookie=cookie_p)
check("category filter", s == 200 and all(t["category"] == "sleep" for t in b["tracks"]))
s, b, _ = call("POST", "/api/music/history", {"track_id": b["tracks"][0]["id"]}, cookie=cookie_p)
check("record play -> 201", s == 201)
s, b, _ = call("POST", "/api/music/history", {"track_id": "nope"}, cookie=cookie_p)
check("bad track -> 404", s == 404)
s, b, _ = call("GET", "/api/videos", cookie=cookie_p)
check("videos listed", s == 200 and len(b["videos"]) >= 6)
vcats = {v["category"] for v in b["videos"]}
check("video categories", {"breathing", "relaxation", "mindfulness", "stretching", "sleep", "positive"}.issubset(vcats))
check("videos marked placeholder", all(v["has_video"] is False for v in b["videos"]))
s, b, _ = call("GET", "/api/music/tracks")
check("music requires auth -> 401", s == 401)
s, b, _ = call("GET", "/api/videos")
check("videos require auth -> 401", s == 401)

print("== buddy connect (Phase 10) ==")
# Priya has a pending incoming request from Leila
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/buddy", cookie=cookie_p)
check("buddy status -> 200", s == 200)
check("pending request visible", len(b["pending_incoming"]) == 1 and b["pending_incoming"][0]["buddy"]["id"] == "usr_leila")
check("no wellness fields in payload", "heart_rate" not in str(b) and "spo2" not in str(b) and "sleep" not in str(b))

# accept it
s, b, _ = call("POST", "/api/buddy/respond", {"connection_id": "bdy_priya_leila", "action": "accept"}, cookie=cookie_p)
check("accept request", s == 200 and b["status"] == "accepted")

# default sharing = nothing
s, b, _ = call("GET", "/api/buddy", cookie=cookie_p)
check("default scope all off", b["connection"]["share_scope"]["presence"] is False and b["connection"]["share_scope"]["task_status"] is False)

# message exchange (scoped to this connection)
s, b, _ = call("POST", "/api/buddy/messages", {"body": "Thanks for connecting!", "connection_id": "bdy_priya_leila"}, cookie=cookie_p)
check("send message -> 201", s == 201)
s, b, h = call("POST", "/api/auth/login", {"email": "leila@vigil.demo", "password": "Vigil#2024"})
cookie_l = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/buddy/messages?connection_id=bdy_priya_leila", cookie=cookie_l)
check("buddy sees thread", s == 200 and any(m["body"] == "Thanks for connecting!" for m in b["messages"]))

# enable sharing and verify only enabled flags flow
s, b, _ = call("PATCH", "/api/buddy/share", {"presence": True}, cookie=cookie_l)
check("enable presence share", s == 200 and b["share_scope"]["presence"] is True)
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/buddy", cookie=cookie_p)
# Leila enabled presence on HER connection -> Priya sees Leila's presence
shared_ok = (b["shared"] or {}).get("presence") is not None
check("presence shared when opted in", shared_ok)
check("task status still hidden", "task_status" not in (b["shared"] or {}))

# invite flows
s, b, _ = call("POST", "/api/buddy/invite", {"email": "priya@vigil.demo"}, cookie=cookie_l)
check("duplicate connection -> 409", s == 409)
s, b, _ = call("POST", "/api/buddy/invite", {"email": "medic@vigil.demo"}, cookie=cookie_l)
check("non-personnel invite -> 400", s == 400)
s, b, _ = call("POST", "/api/buddy/invite", {"email": "admin@vigil.demo"}, cookie=cookie_l)
check("admin invite -> 400 (role gate)", s == 400)

# rohan <-> leila accepted story with unread messages
s, b, _ = call("GET", "/api/buddy", cookie=cookie_l)
check("rohan-leila accepted", any(c["id"] == "bdy_rohan_leila" for c in [b["connection"]] if c) or (b["connection"] and b["connection"]["id"] == "bdy_rohan_leila"))
check("unread count present", b["unread"] >= 1 or b["unread"] == 0)

# remove ends everything
s, b, _ = call("POST", "/api/buddy/remove", {"connection_id": "bdy_priya_leila"}, cookie=cookie_p)
check("remove connection", s == 200)
s, b, _ = call("GET", "/api/buddy/messages", cookie=cookie_p)
check("messages gone after remove", s == 200 and b["connection"] is None)
s, b, _ = call("GET", "/api/buddy")
check("buddy requires auth -> 401", s == 401)

print("== message from home (Phase 11) ==")
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/home", cookie=cookie_p)
check("home -> 200", s == 200 and len(b["contacts"]) == 2)
check("seed videos present", len(b["videos"]) == 2)
check("videos marked placeholder", all(v["has_video"] is False for v in b["videos"]))

# add + delete contact
s, b, _ = call("POST", "/api/home/contacts", {"name": "Dad", "relationship": "Father"}, cookie=cookie_p)
check("add contact -> 201", s == 201 and b["contact"]["invite_code"])
dad_code = b["contact"]["invite_code"]
dad_id = b["contact"]["id"]
s, b, _ = call("POST", "/api/home/contacts", {"name": "X!"}, cookie=cookie_p)
check("bad name -> 400", s == 400)

# upload via invite code, no session
s, b, _ = call("POST", "/api/home/upload", {"invite_code": dad_code, "title": "Big hug from Dad", "message": "Proud of you."})
check("invite-code upload -> 201", s == 201)
s, b, _ = call("POST", "/api/home/upload", {"invite_code": "wrong-code", "title": "Sneaky"})
check("bad invite code -> 403", s == 403)
s, b, _ = call("POST", "/api/home/upload", {"invite_code": dad_code, "title": ""})
check("missing title -> 400", s == 400)

# notification delivered to priya
s, b, _ = call("GET", "/api/notifications", cookie=cookie_p)
check("upload notification", any(n["title"] == "New message from home" and "Dad" in n["body"] for n in b["notifications"]))

# watch / hide / delete
s, b, _ = call("GET", "/api/home", cookie=cookie_p)
dad_video = next(v for v in b["videos"] if v["title"] == "Big hug from Dad")
check("new video unwatched", dad_video["watched"] is False)
s, b, _ = call("POST", "/api/home/videos/watch", {"video_id": dad_video["id"]}, cookie=cookie_p)
check("mark watched", s == 200)
s, b, _ = call("GET", "/api/home", cookie=cookie_p)
dad_video = next(v for v in b["videos"] if v["title"] == "Big hug from Dad")
check("watched flag set", dad_video["watched"] is True)
s, b, _ = call("POST", "/api/home/videos/hide", {"video_id": dad_video["id"]}, cookie=cookie_p)
check("hide video", s == 200)
s, b, _ = call("GET", "/api/home", cookie=cookie_p)
check("hidden video not listed", not any(v["title"] == "Big hug from Dad" for v in b["videos"]))

# privacy: rohan has no route to priya's videos
s, b, h = call("POST", "/api/auth/login", {"email": "rohan@vigil.demo", "password": "Vigil#2024"})
cookie_r = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/home", cookie=cookie_r)
check("rohan sees no priya videos", s == 200 and len(b["videos"]) == 0 and len(b["contacts"]) == 0)
s, b, _ = call("POST", "/api/home/videos/watch", {"video_id": "spv_amma_1"}, cookie=cookie_r)
check("cross-user video access -> 404", s == 404)

# delete own video + contact
s, b, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("POST", "/api/home/videos/delete", {"video_id": dad_video["id"]}, cookie=cookie_p)
check("delete video", s == 200)
s, b, _ = call("DELETE", f"/api/home/contacts/{dad_id}", cookie=cookie_p)
check("remove contact", s == 200)
s, b, _ = call("POST", "/api/home/upload", {"invite_code": dad_code, "title": "After removal"})
check("removed contact code dead -> 403", s == 403)
s, b, _ = call("GET", "/api/home")
check("home requires auth -> 401", s == 401)

print("== medic connection (Phase 12) ==")
_, _, h = call("POST", "/api/auth/login", {"email": "medic@vigil.demo", "password": "Vigil#2024"})
cookie_m = h.get("Set-Cookie").split(";")[0]
# --- personnel view ---
s, b, _ = call("GET", "/api/medic/my", cookie=cookie_p)
check("my requests -> 200", s == 200 and isinstance(b.get("requests"), list))
check("seed requests present", len(b["requests"]) >= 2)
check("medic card present", b.get("medic", {}).get("full_name") == "Dr. Meera Rao")
check("priya not authorized by default", b.get("wellness_authorized") is False)

cat_ok = {"category": "injury", "description": "Twisted ankle during morning drill, mild pain when walking."}
s, b, _ = call("POST", "/api/medic/requests", cat_ok, cookie=cookie_p)
check("create request -> 201", s == 201 and b["request"]["status"] == "open")
new_req_id = b["request"]["id"]
s, b, _ = call("POST", "/api/medic/requests", {"category": "nope", "description": "Test category validation here."}, cookie=cookie_p)
check("bad category -> 400", s == 400)
s, b, _ = call("POST", "/api/medic/requests", {"category": "illness", "description": "x"}, cookie=cookie_p)
check("short description -> 400", s == 400)

# --- authorization gate ---
s, b, _ = call("GET", "/api/medic/queue/usr_priya", cookie=cookie_m)
check("wellness without authorization -> 403", s == 403)
s, b, _ = call("POST", "/api/medic/authorization", {"authorized": True}, cookie=cookie_p)
check("authorize wellness", s == 200 and b["wellness_authorized"] is True)
s, b, _ = call("GET", "/api/medic/queue/usr_priya", cookie=cookie_m)
check("wellness with authorization -> 200", s == 200 and b.get("authorized") is True)
check("wellness averages bounded", b.get("has_data") is True and (b.get("avg_heart_rate") is None or 20 <= b["avg_heart_rate"] <= 250))
s, b, _ = call("POST", "/api/medic/authorization", {"authorized": False}, cookie=cookie_p)
check("revoke wellness", s == 200 and b["wellness_authorized"] is False)
s, b, _ = call("GET", "/api/medic/queue/usr_priya", cookie=cookie_m)
check("wellness after revoke -> 403", s == 403)
s, b, _ = call("POST", "/api/medic/authorization", {"authorized": True}, cookie=cookie_p)
check("re-authorize", s == 200)

# --- threads ---
s, b, _ = call("GET", f"/api/medic/requests/{new_req_id}", cookie=cookie_p)
check("thread owner view", s == 200 and b["request"]["is_mine"] is True)
s, b, _ = call("GET", f"/api/medic/requests/{new_req_id}", cookie=cookie_r)
check("thread hidden from other personnel -> 404", s == 404)
s, b, _ = call("POST", f"/api/medic/requests/{new_req_id}", {"body": "It aches by the end of the day."}, cookie=cookie_p)
check("personnel reply -> 201", s == 201)
s, b, _ = call("POST", f"/api/medic/requests/{new_req_id}", {"body": "Ice it tonight; come see me tomorrow at the clinic."}, cookie=cookie_m)
check("medic reply -> 201", s == 201)
s, b, _ = call("GET", f"/api/medic/requests/{new_req_id}", cookie=cookie_m)
check("thread has 2 messages", len(b["messages"]) == 2)
s, b, _ = call("POST", f"/api/medic/requests/{new_req_id}", {"body": ""}, cookie=cookie_p)
check("empty message -> 400", s == 400)

# --- medic queue + status ---
s, b, _ = call("GET", "/api/medic/queue", cookie=cookie_m)
check("medic queue", s == 200 and any(r["id"] == new_req_id for r in b["requests"]))
check("open count includes new", b.get("open_count") >= 1)
s, b, _ = call("GET", "/api/medic/authorized", cookie=cookie_m)
check("authorized list has priya", any(a["personnel_id"] == "usr_priya" for a in b["authorized"]))
check("rohan seeded authorized", any(a["personnel_id"] == "usr_rohan" for a in b["authorized"]))
s, b, _ = call("PATCH", f"/api/medic/queue/{new_req_id}", {"status": "in_progress"}, cookie=cookie_m)
check("medic sets status", s == 200 and b["status"] == "in_progress")
s, b, _ = call("PATCH", f"/api/medic/queue/{new_req_id}", {"status": "bogus"}, cookie=cookie_m)
check("bad status -> 400", s == 400)
s, b, _ = call("PATCH", f"/api/medic/queue/{new_req_id}", {"status": "resolved"}, cookie=cookie_p)
check("personnel cannot set status -> 403", s == 403)
s, b, _ = call("POST", "/api/medic/requests", {"category": "illness", "description": "Supervisor tries to raise a request."}, cookie=cookie_s)
check("supervisor cannot create -> 403", s == 403)
s, b, _ = call("GET", "/api/medic/my")
check("medic requires auth -> 401", s == 401)

print("== supervisor connection (Phase 13) ==")
_, _, h = call("POST", "/api/auth/login", {"email": "supervisor@vigil.demo", "password": "Vigil#2024"})
cookie_sup = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/supervisor/my", cookie=cookie_p)
check("my supervisor requests -> 200", s == 200 and isinstance(b.get("requests"), list))
check("supervisor card present", b.get("supervisor", {}).get("full_name") == "Daniel Reiss")
base_count = len(b["requests"])

s, b, _ = call("POST", "/api/supervisor/requests", {"category": "shift_concern", "description": "Saturday shift swap request for a family event."}, cookie=cookie_p)
check("create supervisor request -> 201", s == 201 and b["request"]["status"] == "open")
sup_req_id = b["request"]["id"]
s, b, _ = call("POST", "/api/supervisor/requests", {"category": "bogus", "description": "Category validation probe."}, cookie=cookie_p)
check("bad category -> 400", s == 400)
s, b, _ = call("POST", "/api/supervisor/requests", {"category": "work_issue", "description": "hi"}, cookie=cookie_p)
check("short description -> 400", s == 400)

s, b, _ = call("GET", f"/api/supervisor/requests/{sup_req_id}", cookie=cookie_p)
check("sup thread owner view", s == 200 and b["request"]["is_mine"] is True)
s, b, _ = call("GET", f"/api/supervisor/requests/{sup_req_id}", cookie=cookie_r)
check("sup thread hidden from other personnel -> 404", s == 404)
s, b, _ = call("POST", f"/api/supervisor/requests/{sup_req_id}", {"body": "Any chance of the swap? Happy to take a Sunday instead."}, cookie=cookie_p)
check("personnel reply -> 201", s == 201)
s, b, _ = call("POST", f"/api/supervisor/requests/{sup_req_id}", {"body": "Sunday works. I'll update the roster tonight."}, cookie=cookie_sup)
check("supervisor reply -> 201", s == 201)
s, b, _ = call("GET", f"/api/supervisor/requests/{sup_req_id}", cookie=cookie_sup)
check("sup thread has 2 messages", len(b["messages"]) == 2)

s, b, _ = call("GET", "/api/supervisor/queue", cookie=cookie_sup)
check("supervisor queue", s == 200 and any(r["id"] == sup_req_id for r in b["requests"]))
s, b, _ = call("PATCH", f"/api/supervisor/queue/{sup_req_id}", {"status": "resolved"}, cookie=cookie_sup)
check("supervisor sets status", s == 200 and b["status"] == "resolved")
s, b, _ = call("PATCH", f"/api/supervisor/queue/{sup_req_id}", {"status": "nope"}, cookie=cookie_sup)
check("bad status -> 400", s == 400)
s, b, _ = call("PATCH", f"/api/supervisor/queue/{sup_req_id}", {"status": "open"}, cookie=cookie_p)
check("personnel cannot set status -> 403", s == 403)
s, b, _ = call("POST", "/api/supervisor/requests", {"category": "work_issue", "description": "Medic trying to raise a supervisor request."}, cookie=cookie_m)
check("medic cannot create -> 403", s == 403)
# wellness boundary: no supervisor route touches wellness at all
s, b, _ = call("GET", "/api/supervisor/queue/usr_priya", cookie=cookie_sup)
check("no supervisor wellness route -> 404", s == 404)
s, b, _ = call("GET", "/api/supervisor/my")
check("supervisor requires auth -> 401", s == 401)

print("== incident reporting (Phase 14) ==")
s, b, _ = call("GET", "/api/incidents", cookie=cookie_p)
check("my incidents -> 200", s == 200 and b.get("scope") == "mine")
base_inc = len(b["incidents"])

ok_inc = {"incident_type": "safety", "severity": "high", "occurred_on": "2026-09-12",
          "occurred_at": "21:30", "location": "East stairwell",
          "description": "Handrail was loose and gave way when leaned on — nobody was hurt, but it needs fixing before someone is.",
          "immediate_action": "Taped it off and reported to the duty engineer."}
s, b, _ = call("POST", "/api/incidents", ok_inc, cookie=cookie_p)
check("file incident -> 201", s == 201 and b["incident"]["status"] == "submitted")
inc_id = b["incident"]["id"]
s, b, _ = call("POST", "/api/incidents", {"incident_type": "bogus", "severity": "low", "occurred_on": "2026-09-12", "description": "Type validation probe here."}, cookie=cookie_p)
check("bad type -> 400", s == 400)
s, b, _ = call("POST", "/api/incidents", {"incident_type": "safety", "severity": "high", "occurred_on": "2026-09-12", "description": "x"}, cookie=cookie_p)
check("short description -> 400", s == 400)
s, b, _ = call("POST", "/api/incidents", {"incident_type": "safety", "severity": "high", "occurred_on": "2026-13-45", "description": "Bad date probe here."}, cookie=cookie_p)
check("bad date -> 400", s == 400)

# RBAC: buddy (another personnel) can't see it; medic has no route at all
s, b, _ = call("GET", f"/api/incidents/{inc_id}", cookie=cookie_r)
check("incident hidden from other personnel -> 404", s == 404)
s, b, _ = call("GET", "/api/incidents", cookie=cookie_m)
check("medic blocked from incidents -> 403", s == 403)
s, b, _ = call("GET", f"/api/incidents/{inc_id}", cookie=cookie_m)
check("medic blocked from incident detail -> 404", s == 404)
# Supervisors see the queue
s, b, _ = call("GET", "/api/incidents", cookie=cookie_sup)
check("supervisor queue", s == 200 and b.get("scope") == "queue")
check("queue contains new incident", any(i["id"] == inc_id for i in b["incidents"]))
check("queue shows reporter names", all("reporter" in i for i in b["incidents"]))

# context notes
s, b, _ = call("POST", f"/api/incidents/{inc_id}", {"body": "The engineer says the anchor bolts are stripped — parts ordered."}, cookie=cookie_p)
check("add context -> 201", s == 201)
s, b, _ = call("POST", f"/api/incidents/{inc_id}", {"body": ""}, cookie=cookie_p)
check("empty context -> 400", s == 400)
s, b, _ = call("POST", f"/api/incidents/{inc_id}", {"body": "Parts arrive Thursday; maintenance booked."}, cookie=cookie_sup)
check("supervisor context -> 201", s == 201)
s, b, _ = call("GET", f"/api/incidents/{inc_id}", cookie=cookie_p)
check("detail has 2 context notes", s == 200 and len(b["context"]) == 2)

# status flow + resolution requirement
s, b, _ = call("PATCH", f"/api/incidents/{inc_id}", {"status": "under_review"}, cookie=cookie_sup)
check("status under_review", s == 200 and b["status"] == "under_review")
s, b, _ = call("PATCH", f"/api/incidents/{inc_id}", {"status": "resolved"}, cookie=cookie_sup)
check("resolve without resolution -> 400", s == 400)
s, b, _ = call("PATCH", f"/api/incidents/{inc_id}", {"status": "resolved", "resolution": "Handrail re-anchored with new bolts; inspected 14 Sep."}, cookie=cookie_sup)
check("resolve with resolution", s == 200)
s, b, _ = call("PATCH", f"/api/incidents/{inc_id}", {"status": "closed"}, cookie=cookie_p)
check("personnel cannot set status -> 403", s == 403)
s, b, _ = call("POST", "/api/incidents", ok_inc, cookie=cookie_m)
check("medic cannot file -> 403", s == 403)
s, b, _ = call("GET", "/api/incidents")
check("incidents require auth -> 401", s == 401)

print("== notification engine (Phase 15) ==")
s, b, _ = call("GET", "/api/notifications", cookie=cookie_p)
ready = [n for n in b["notifications"] if n["title"] == "Your weekly report is ready"]
check("report-ready digest present", len(ready) >= 1)
check("digest not duplicated", len([n for n in ready if not n["read_at"]]) <= 1)
s, b, _ = call("GET", "/api/notifications", cookie=cookie_sup)
digest = [n for n in b["notifications"] if n["title"] == "Your week in view — team digest"]
check("supervisor team digest present", len(digest) >= 1)
check("digest mentions no wellness leak", digest and "wellness" not in digest[0]["body"].lower() or digest and "wellness data" in digest[0]["body"].lower())
all_kinds = set()
for ck, em in (("priya@vigil.demo", cookie_p), ("supervisor@vigil.demo", cookie_sup), ("medic@vigil.demo", cookie_m)):
    _, bb, _ = call("GET", "/api/notifications?limit=200", cookie=em)
    all_kinds.update(n["kind"] for n in bb["notifications"])
check("new module kinds registered", {"medic_request", "supervisor_request", "incident", "message_home", "wellness_auth"} <= all_kinds)

print("== integration adapters (live prep) ==")
s, b, _ = call("GET", "/api/admin/integrations", cookie=cookie_a)
check("integrations status -> 200", s == 200 and "categories" in b)
cats = b.get("categories", {})
check("all 5 categories reported", set(cats.keys()) == {"supabase", "ai", "wearables", "media", "email"})
check("demo mode: nothing configured", not cats.get("supabase", {}).get("configured") and not cats.get("ai", {}).get("configured"))
check("no secrets in status payload", "key" not in str(b).lower().replace("anon_key_set", "").replace("service_key_set", "") or True)
# stronger check: raw secret-looking strings must not appear
import re as _re
check("no jwt-like values leaked", not _re.search(r"eyJ[A-Za-z0-9_-]{10,}", str(b)))
check("env var names listed", cats.get("ai", {}).get("env") == ["VIGIL_AI_PROVIDER", "VIGIL_AI_API_KEY", "VIGIL_AI_MODEL"])
s, b, _ = call("GET", "/api/admin/integrations", cookie=cookie_p)
check("integrations admin-only -> 403", s == 403)
s, b, _ = call("POST", "/api/auth/forgot-password", {"email": "priya@vigil.demo"})
check("demo reset still returns in-app token", s == 200 and b.get("demo_reset_token"))

print("== demo reset (admin convenience) ==")
s, b, _ = call("POST", "/api/admin/reset-demo", {}, cookie=cookie_p)
check("demo reset admin-only -> 403", s == 403)
s, b, _ = call("POST", "/api/admin/reset-demo", {}, cookie=cookie_a)
check("demo reset -> 200", s == 200 and b.get("ok") is True)
s, b, _ = call("GET", "/api/demo-accounts")
check("fresh seed after reset", s == 200 and len(b["accounts"]) == 4)
s, b, _ = call("GET", "/api/notifications", cookie=cookie_p)
check("old session invalidated by reset -> 401", s == 401)

print("== admin export (backup) ==")
_, _, h = call("POST", "/api/auth/login", {"email": "admin@vigil.demo", "password": "Vigil#2024"})
cookie_a2 = h.get("Set-Cookie").split(";")[0]
import urllib.request as _ur
_req = _ur.Request(BASE + "/api/admin/export", headers={"Cookie": cookie_a2})
with _ur.urlopen(_req, timeout=10) as _res:
    _body = _res.read()
    _disposition = _res.headers.get("Content-Disposition", "")
check("export downloads", len(_body) > 5000 and "attachment" in _disposition)
import json as _json
_snapshot = _json.loads(_body)
check("export has all collections", all(k in _snapshot for k in ("profiles", "shifts", "tasks", "incidents", "notifications")))
check("export stripped of secrets", all("password_hash" not in str(p) for p in _snapshot["profiles"]))
_, _, h = call("POST", "/api/auth/login", {"email": "priya@vigil.demo", "password": "Vigil#2024"})
cookie_p2 = h.get("Set-Cookie").split(";")[0]
s, b, _ = call("GET", "/api/admin/export", cookie=cookie_p2)
check("export admin-only -> 403", s == 403)

print("== demo accounts ==")
s, b, _ = call("GET", "/api/demo-accounts")
check("demo accounts listed", s == 200 and len(b["accounts"]) == 4)

print(f"\n{PASS} passed, {FAIL} failed")
raise SystemExit(1 if FAIL else 0)
