"""Grounded replies for the VIGIL AI Assistant — SIU phase 10.

The assistant is an assistance layer across the platform, not a generic
chatbot. For questions about the user's own operational context, answers
are computed deterministically from their permitted VIGIL data — same
inputs, same answer, every time (a judge can verify against the pages).
For everything else, the request falls through to the configured AI
provider exactly as before.

Support routing: when someone says "I need support", the reply carries
structured options (buddy / medic / supervisor / de-stress) the UI
renders as one-tap links. Reaching out early is framed as a strength.

Privacy: only the signed-in user's own data is ever used. Nothing here
reads other people's wellness, AI conversations, or incident details.
"""
from __future__ import annotations

import insights

SUPPORT_ACTIONS = [
    {"icon": "⇄", "title": "Buddy Connect", "desc": "A trusted person to talk to", "path": "/buddy"},
    {"icon": "✚", "title": "Medic Officer", "desc": "Private wellbeing follow-up", "path": "/medic"},
    {"icon": "⚑", "title": "Supervisor Connection", "desc": "Shift or task load concerns", "path": "/supervisor"},
    {"icon": "♪", "title": "De-stress Zone", "desc": "A two-minute reset, right now", "path": "/destress"},
]


def grounded_reply(uid: str, text: str) -> dict | None:
    """Return {'reply', 'support'} when the platform can answer from data."""
    lower = text.lower()

    if _any(lower, ("i need support", "need support", "struggling", "not okay", "not ok",
                    "talk to someone", "need someone", "feeling low", "feeling down",
                    "overwhelmed", "can't cope", "cant cope", "i'm not doing well", "having a hard time")):
        ctx = insights.compute(uid)
        load = ctx["load"]
        opener = ("Reaching out is a strength, not a setback. " if load["band"] != "steady"
                  else "Glad you said something — support is exactly what this platform is for. ")
        body = ("Here are your options, in the order that usually helps. Your Medic Officer and Supervisor "
                "threads are private; your buddy sees only what you explicitly share. If anything feels urgent, "
                "your Medic Officer is the right first call.")
        return {"reply": opener + body, "support": SUPPORT_ACTIONS}

    # Relaxation/wind-down requests are human moments — the configured
    # provider's supportive replies handle them; no data answer needed.
    if _any(lower, ("unwind", "relax", "calm", "destress", "de-stress", "breathe", "breat", "music", "sleep mix")):
        return None

    if _any(lower, ("forecast", "projection", "heading", "next 24", "next 48",
                    "how will i", "how will recovery", "fatigue forecast", "tired tomorrow")):
        import forecast
        fc = forecast.compute(uid)
        if not fc.get("has_data"):
            return {"reply": fc.get("message", "Your first forecast appears after a day of data."), "support": None}
        reply = (f"Here's your fatigue forecast — an estimate with uncertainty, never a guarantee "
                 f"(confidence: {fc['confidence']}). You're at {fc['current']} now; "
                 f"24h projects to {fc['h24']['projected']} ± {fc['h24']['pm']}, "
                 f"48h to {fc['h48']['projected']} ± {fc['h48']['pm']}.")
        contribs = fc.get("contributors") or []
        if contribs:
            reply += " Main contributors: " + "; ".join(
                f"{c['label'].lower()} ({'−' if c['direction'] == 'down' else '+'}{abs(c['points'])})"
                for c in contribs[:3]) + "."
        if fc["h24"]["change"] <= -4:
            reply += (" If the trend holds, the support options below are one tap away — engaging one "
                      "starts a gentle follow-up, never a judgement.")
        else:
            reply += " Nothing alarming — keep the rhythm that's working."
        return {"reply": reply, "support": SUPPORT_ACTIONS if fc["h24"]["change"] <= -4 else None}

    if _any(lower, ("what helped", "support worked", "intervention", "have i used", "did my support")):
        import interventions
        iv = interventions.my_view(uid)
        history = iv.get("history") or []
        open_ev = iv.get("open") or []
        if not history and not open_ev:
            return {"reply": "You haven't engaged any support options through the loop yet. When you do — "
                             "De-Stress, Buddy, Medic — VIGIL observes how your recovery trends afterwards "
                             "and shows it back to you, honestly and without claiming cause.", "support": None}
        bits = ["Here's your support loop, from your own record:"]
        for o in open_ev[:2]:
            bits.append(f"• Open: {o['label']} engaged {o['created_at'][:10]}"
                        + (f" — recovery has moved {o['change_so_far']:+d} since" if o.get("change_so_far") is not None else "") + ".")
        for h in history[:3]:
            fu = h.get("followup") or {}
            ch = fu.get("observed_change")
            bits.append(f"• {h['label']}: recovery {h['recovery_before']} → {fu.get('recovery_after')}"
                        + (f" (observed change {ch:+d})" if ch is not None else "") + ".")
        bits.append("These are observed trends around your support engagements — not proof of cause, and never a diagnosis.")
        return {"reply": "\n".join(bits), "support": None}

    if _any(lower, ("week", "summar", "overview", "how have i been", "how's it going", "hows it going")):
        return _week_reply(uid)

    if _any(lower, ("why", "change", "drop", "dropped", "lower", "fell")) and _any(lower, ("recovery", "score")):
        change = insights.score_change_explanation(uid)
        if not change:
            return {"reply": "Your Recovery Score becomes explainable from the second day — "
                             "after tomorrow morning's score, I can walk you through every change factor by factor.",
                    "support": None}
        if change["direction"] == "steady":
            reply = (f"Your score held at {change['score']} — the factors barely moved. "
                     "The Recovery page breaks each factor down with its exact points.")
        else:
            word = "up" if change["direction"] == "up" else "down"
            lead = change["factors"][0] if change["factors"] else None
            reply = (f"Your score moved {word} {abs(change['total_change'])} points since yesterday "
                     f"({change['previous_score']} → {change['score']}).")
            if lead:
                reply += (f" The biggest driver was {lead['label'].lower()}: "
                          f"{lead['input_prev']} → {lead['input_now']} ({lead['delta']:+d} pts).")
            reply += " The full factor-by-factor explanation is on the Recovery page — same numbers, nothing hidden."
        return {"reply": reply, "support": None}

    if _any(lower, ("recovery", "score")):
        ctx = insights.compute(uid)
        rest = ctx["rest"]
        if rest.get("recovery_score") is None:
            return {"reply": "Your first Recovery Score arrives after a day of shifts and rest. "
                             "It's a transparent 0–100 built from sleep, rest, weekly load, activity and self-reported stress.",
                    "support": None}
        prev = rest.get("recovery_prev")
        reply = (f"Your Recovery Score is {rest['recovery_score']} out of 100"
                 + (f" — {('up' if rest['recovery_score'] > prev else 'down')} {abs(rest['recovery_score'] - prev)} from yesterday" if prev is not None else "")
                 + ". It comes from five transparent factors: sleep, rest between shifts, weekly load, activity, and your self-reported stress.")
        drop = rest.get("sleep_drop_minutes")
        if drop is not None and drop >= 60:
            reply += f" Worth knowing: your sleep is about {round(drop / 60, 1)}h under your weekly average — usually the biggest lever."
        return {"reply": reply, "support": None}

    if _any(lower, ("shift", "schedule", "duty", "rota", "roster")):
        ctx = insights.compute(uid)
        s = ctx["shift"]
        parts = []
        if s["active"]:
            parts.append("You're on shift right now.")
        else:
            parts.append("You're off shift at the moment.")
        parts.append(f"This week: {s['week_hours']}h across {s['shift_count_this_week']} shifts"
                     + (f" (last week: {s['prev_week_hours']}h)" if s["prev_week_hours"] else "") + ".")
        ext = s.get("scheduled_vs_actual")
        if ext:
            parts.append(f"Your last shift ran {ext['actual_h']}h against a {ext['scheduled_h']}h plan — "
                         "the Shift Monitor has the details, and your supervisor can help rebalance if it's becoming a pattern.")
        return {"reply": " ".join(parts), "support": None}

    if _any(lower, ("task", "workload", "deadline", "due", "todo", "to-do")):
        ctx = insights.compute(uid)
        t = ctx["tasks"]
        reply = (f"You have {t['open']} open task{'s' if t['open'] != 1 else ''}"
                 + (f", {t['overdue']} past due" if t["overdue"] else ", none past due")
                 + (f" and {t['high_priority']} high priority" if t["high_priority"] else "") + ". ")
        reply += ("If the list looks heavy, your supervisor can rebalance it — that's what the Supervisor Connection is for. "
                  "One small win now builds momentum." if t["open"] else "All clear — a good moment for a proper break.")
        return {"reply": reply, "support": None}

    if _any(lower, ("load", "busy", "pressure", "stress level")):
        ctx = insights.compute(uid)
        load = ctx["load"]
        if not load["reasons"]:
            return {"reply": "Your operational load is steady — shifts, tasks and rest are all in their usual rhythm. "
                             "Whatever is on your mind, it isn't coming from the workload. Want to talk it through with someone?",
                    "support": SUPPORT_ACTIONS}
        reply = (f"Your operational load reads {load['band']} ({load['score']}/100), mainly from: "
                 + "; ".join(load["reasons"]) + ". ")
        reply += ("Higher operational workload may contribute to reduced recovery — the support options below can help, "
                  "and your supervisor can rebalance shifts or tasks." if load["band"] != "steady"
                  else "Nothing alarming — keep the rhythm that's working.")
        return {"reply": reply, "support": SUPPORT_ACTIONS if load["band"] != "steady" else None}

    return None  # fall through to the AI provider


# ---------- week summary ----------

def _week_reply(uid: str) -> dict:
    import weekly_report
    week = weekly_report.compute(uid)
    w = week["workload"]
    t = week["tasks"]
    r = week["recovery"]
    sup = week["support"]
    bits = ["Here's your week so far, from your own VIGIL data:"]
    if w["hours"]:
        bits.append(f"• Shifts: {w['hours']}h across {w['shifts']} shifts"
                    + (f", including {w['extended_shifts']} extended shift" if w["extended_shifts"] else "") + ".")
    else:
        bits.append("• Shifts: none recorded this week.")
    if t["completed"] or t["open"]:
        bits.append(f"• Tasks: {t['completed']} completed"
                    + (f", {t['open']} open" if t["open"] else "")
                    + (f" ({t['overdue']} past due)" if t["overdue"] else "") + ".")
    if r["avg"] is not None:
        bits.append(f"• Recovery: averaged {r['avg']}/100"
                    + (f", latest {r['latest']}" if r["latest"] is not None else "") + ".")
    wel = week["wellness"]
    if wel.get("sleep_avg_minutes") is not None:
        h, m = divmod(wel["sleep_avg_minutes"], 60)
        bits.append(f"• Sleep: averaged {int(h)}h {int(m)}m a night.")
    if sup["raised"]:
        bits.append(f"• Support: {sup['raised']} request{'s' if sup['raised'] != 1 else ''} raised"
                    + (f", {sup['resolved_in_week']} resolved" if sup["resolved_in_week"] else "") + ".")
    bits.append("The Weekly Report page shows all of this with trends — and a private reflection space.")
    return {"reply": "\n".join(bits), "support": None}


def _any(text, keys):
    return any(k in text for k in keys)
