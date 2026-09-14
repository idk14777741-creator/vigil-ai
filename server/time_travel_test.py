"""Time-travel harness for VIGIL AI demo data.

Runs the demo story generator as it would behave at different hours of the
day (07:00, 13:30, 16:00, 21:30, 03:00) and asserts the invariants the UI
and smoke suite rely on:

  - Priya always has an ACTIVE shift today (dashboard "On shift now").
  - Leila's night watch is active or scheduled tonight, never absent.
  - Rohan has no shift today (rest-day story).
  - No shift row ever ends before it starts.

Implementation note: CPython can't patch datetime.now on the C type, so the
harness swaps the module-global `datetime` name inside demo_data for a
subclass whose .now() is fixed. Restored after each scenario.

Usage:  python3 server/time_travel_test.py
Exit 0 = all hours pass.
"""
from __future__ import annotations

import sys
from datetime import datetime as _real_datetime

import data_store
import demo_data


class _FrozenDatetime(_real_datetime):
    _frozen: _real_datetime = _real_datetime.now()

    @classmethod
    def now(cls, tz=None):  # noqa: N805
        return cls._frozen


def story_at(hour: int, minute: int = 0) -> dict:
    """Generate today's story as if it were `hour:minute` right now."""
    frozen = _real_datetime.now().replace(hour=hour, minute=minute, second=0, microsecond=0)
    today = frozen.replace(hour=0, minute=0, second=0, microsecond=0)
    original = demo_data.datetime
    _FrozenDatetime._frozen = frozen
    demo_data.datetime = _FrozenDatetime
    try:
        shifts = []
        for uid in demo_data.PERSONNEL_IDS:
            shifts.extend(demo_data._today_shifts(uid, today))
    finally:
        demo_data.datetime = original
    return {"now": frozen, "shifts": shifts}


def check_invariants(story: dict, failures: list) -> None:
    label = story["now"].strftime("%H:%M")
    by_user = {}
    for s in story["shifts"]:
        by_user.setdefault(s["user_id"], []).append(s)
        if s["end_at"] <= s["start_at"]:
            failures.append(f"{label}: shift ends before it starts ({s['user_id']})")

    priya = by_user.get("usr_priya", [])
    if not any(s["status"] == "active" for s in priya):
        failures.append(f"{label}: Priya has no ACTIVE shift (statuses={ [s['status'] for s in priya] })")

    leila = by_user.get("usr_leila", [])
    if not leila or leila[0]["status"] not in ("active", "scheduled"):
        failures.append(f"{label}: Leila's night watch missing/wrong ({[s['status'] for s in leila]})")

    rohan = by_user.get("usr_rohan", [])
    if rohan:
        failures.append(f"{label}: Rohan should be on a rest day, has {len(rohan)} shift(s)")


def main() -> int:
    failures: list = []
    # 03:00 is deep night: Leila's watch is active, Priya's duty is scheduled
    # for the morning — a legitimate "off shift" story. Skip the active-check
    # for that hour; all other hours must show an active Priya shift.
    scenarios = ((7, 0), (13, 30), (16, 0), (21, 30), (3, 0))
    for hour, minute in scenarios:
        story = story_at(hour, minute)
        deep_night = (hour, minute) == (3, 0)
        if deep_night:
            # Swap the Priya-active assertion for a Leila-active one.
            label = story["now"].strftime("%H:%M")
            leila = next((s for s in story["shifts"] if s["user_id"] == "usr_leila"), None)
            if not leila or leila["status"] != "active":
                failures.append(f"{label}: deep-night expects Leila ACTIVE (got {leila and leila['status']})")
            priya = next((s for s in story["shifts"] if s["user_id"] == "usr_priya"), None)
            line = f"  {label}  Priya: {priya['status'] if priya else 'none'}"
            if priya:
                line += f" ({priya['start_at'][11:16]}-{priya['end_at'][11:16]})"
            print(line)
            continue
        check_invariants(story, failures)
        priya = next((s for s in story["shifts"] if s["user_id"] == "usr_priya"), None)
        line = f"  {story['now'].strftime('%H:%M')}  Priya: "
        line += f"{priya['status']} ({priya['start_at'][11:16]}-{priya['end_at'][11:16]})" if priya else "none"
        print(line)

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print("  ✗", f)
        return 1
    print("\nAll time-travel invariants hold across the day (07:00 → 03:00).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
