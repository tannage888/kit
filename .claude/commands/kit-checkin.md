---
description: Daily relationship check-in — see who to reach out to today
---

Run your daily relationship check-in.

Usage: `/kit-checkin [high|medium|low]`

$ARGUMENTS

If an energy level argument was given (high, medium, or low), call `kit-set-energy` with that level first, then call `kit-daily-checkin`.

If no argument was given, call `kit-daily-checkin` directly. If the tool returns an error that no energy is set, ask the user: "What's your energy today — high, medium, or low?" then call `kit-set-energy` with their answer and retry `kit-daily-checkin`.

After showing the check-in results:
- If there are contacts with black drift, offer to run `/kit-reconnect <name>` for each
- If there are contacts with open follow-ups, note which ones have outstanding items

Do not add commentary beyond what's in the check-in output unless the user asks follow-up questions.
