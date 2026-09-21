"""Intelligence & privacy layer API — forecast, interventions, wellbeing, roster.

Routing glue only: the logic lives in forecast.py, interventions.py,
wellbeing.py and roster.py. Every route is session-authenticated here; the
supervisor roster routes carry a real role check (not just a hidden UI), and
the anomaly route enforces data minimization server-side.
"""
from __future__ import annotations

import forecast
import interventions
import roster
import wellbeing
from auth_api import current_profile


def _res(status, payload, headers=None):
    return status, payload, headers or {}


def _no_match():
    return None, None, None


def _is_supervisor(profile) -> bool:
    return profile.get("role") in ("supervisor", "admin")


def handle(method: str, path: str, ctx: dict):
    if not path.startswith("/api/intelligence") and not path.startswith("/api/wellbeing"):
        return _no_match()
    profile = current_profile(ctx)
    if not profile:
        return _res(401, {"error": "Please sign in to continue."})

    routes = {
        # Fatigue forecast (own data only).
        ("GET", "/api/intelligence/forecast"): lambda: _res(200, forecast.compute(profile["id"])),

        # Closed-loop interventions (own record only).
        ("GET", "/api/intelligence/interventions"): lambda: _res(200, interventions.my_view(profile["id"])),
        ("POST", "/api/intelligence/interventions"): lambda: _engage(profile, ctx.get("body") or {}),
        ("POST", "/api/intelligence/interventions/followup"): lambda: _followup(profile, ctx.get("body") or {}),

        # Anomaly events — minimal result upload only (server enforces the whitelist).
        ("POST", "/api/intelligence/anomalies"): lambda: _anomaly(profile, ctx.get("body") or {}),
        ("GET", "/api/intelligence/anomalies"): lambda: _res(200, wellbeing.my_anomalies(profile["id"])),

        # Anonymized intervention efficacy (aggregate-only; admin/supervisor).
        ("GET", "/api/intelligence/efficacy"): lambda: _efficacy(profile),

        # Supervisor: aggregate-only team picture + roster balancer.
        ("GET", "/api/intelligence/team"): lambda: _team(profile),
        ("GET", "/api/intelligence/team/roster"): lambda: _roster_overview(profile),
        ("POST", "/api/intelligence/roster/simulate"): lambda: _simulate(profile, ctx.get("body") or {}),
        ("GET", "/api/intelligence/roster/scenarios"): lambda: _scenarios(profile),
        ("POST", "/api/intelligence/roster/scenarios"): lambda: _save_scenario(profile, ctx.get("body") or {}),

        # Weekly wellbeing check-in (separate from Recovery Score).
        ("GET", "/api/wellbeing/checkins"): lambda: _res(200, _checkins_get(profile["id"])),
        ("POST", "/api/wellbeing/checkin"): lambda: _checkin(profile, ctx.get("body") or {}),
    }
    fn = routes.get((method, path))
    if fn is None:
        return _no_match()
    return fn()


def _engage(profile, body):
    status, payload = interventions.record_engagement(
        profile["id"], str(body.get("intervention_id") or ""),
        source=str(body.get("source") or "dashboard"))
    return _res(status or 200, payload)


def _followup(profile, body):
    status, payload = interventions.record_followup(
        profile["id"], str(body.get("event_id") or ""), body.get("helpfulness"))
    return _res(status or 200, payload)


def _anomaly(profile, body):
    status, payload = wellbeing.record_anomaly(profile, body)
    return _res(status or 200, payload)


def _efficacy(profile):
    if not _is_supervisor(profile):
        return _res(403, {"error": "Aggregate intervention insights are available to supervisors and administrators only."})
    return _res(200, interventions.efficacy())


def _team(profile):
    if not _is_supervisor(profile):
        return _res(403, {"error": "Team intelligence is available to supervisors and administrators only."})
    return _res(200, roster.team_fatigue_metrics(profile["id"]))


def _roster_overview(profile):
    if not _is_supervisor(profile):
        return _res(403, {"error": "The roster planner is available to supervisors and administrators only."})
    return _res(200, roster.roster_overview(profile["id"]))


def _simulate(profile, body):
    if not _is_supervisor(profile):
        return _res(403, {"error": "The roster planner is available to supervisors and administrators only."})
    status, payload = roster.scenario_simulate(profile["id"], body)
    return _res(status or 200, payload)


def _scenarios(profile):
    if not _is_supervisor(profile):
        return _res(403, {"error": "The roster planner is available to supervisors and administrators only."})
    return _res(200, roster.list_scenarios(profile["id"]))


def _save_scenario(profile, body):
    if not _is_supervisor(profile):
        return _res(403, {"error": "The roster planner is available to supervisors and administrators only."})
    status, payload = roster.save_scenario(profile["id"], body)
    return _res(status or 200, payload)


def _checkins_get(uid):
    view = wellbeing.weekly_trend(uid)
    view["questions"] = wellbeing.QUESTIONS
    return view


def _checkin(profile, body):
    status, payload = wellbeing.submit_checkin(profile, body)
    return _res(status or 200, payload)
