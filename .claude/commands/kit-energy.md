---
description: Set or check today's social energy level (high/medium/low)
---

Set or check your social energy level for today.

Usage:
- `/kit-energy high` — full capacity, surface all overdue contacts
- `/kit-energy medium` — selective, surface up to 7 contacts
- `/kit-energy low` — minimal, surface up to 3 low-cost contacts
- `/kit-energy` — check today's current level

$ARGUMENTS

If an argument was given (high, medium, or low), call the `kit_set_energy` MCP tool with that level and confirm back.

If no argument was given, call the `kit_get_energy` MCP tool and report the result. If no level is set yet, prompt the user to set one.
