# Resume Notes — Kit v1.0

Scratchpad for the ralph-loop. Each iteration must update this file.

---

## Phase history

- Phase 1 ✅ — Gateway REST-client refactor (84 tests)
- Phase 2 ✅ — Markdown schema (88 tests)
- Phase 3 ✅ — Energy state + /kit-energy (98 tests)
- Phase 4 ✅ — Drift/safety/occasion pure functions (135 tests, 2026-04-19)

---

## Current status: Phase 4 complete — Beginning Phase 5

### Phase 5 — /kit-checkin (FR-01)

**Goal:** `kit_daily_checkin` MCP tool + `/kit-checkin` slash command.

**File to add:** `gateway/src/mcp/tools.ts` — `dailyCheckin()` function

**Logic:**

```
1. Read energy_state for today (via kitClient().from("energy_state")...)
2. If null → return "No energy set. Run /kit-energy high|medium|low first."
3. Load all active contacts from kit.contacts (need: id, name, tier, frequency_days, last_contact, next_action, social_battery_cost, birthday, whatsapp_capture)
4. For each contact:
   - computeDriftStatus(last_contact, frequency_days, today)
   - computeSafetyIndicator(drift)
   - computeOccasions(birthday, today)
5. Filter by energy level:
   - high:   all contacts with drift != "green" (overdue + due)
             + contacts due in next 7 days (next_action <= today+7)
   - medium: up to 7 contacts; prefer Low battery_cost contacts; exclude green
   - low:    up to 3 contacts; only Low battery_cost; exclude green
6. Sort: black first, then red, yellow; within same color sort by tier (1 first)
7. Return structured JSON as a markdown summary string
```

**Return shape (as formatted markdown string):**
```
## Daily Check-in

Energy: medium

### Needs attention (3)

- **Alice** (Inner Circle) — black drift ⚫ | "It's been a long time..."
  Last contact: 2026-01-15 | Next action was: 2026-02-15
  🎂 Birthday tomorrow!

- **Bob** (Active) — red drift 🔴 | "It's been a while..."
  ...

### Follow-ups (2 open)
- Alice: Send the article
- Bob: Book table

### Reconnection suggestions
- Dormant contacts: Dave, Carol (use /kit-reconnect <name>)
```

**Test file:** `gateway/src/mcp/checkin.test.ts`

Tests:
- high energy: returns all overdue contacts
- medium energy: caps at 7, prefers low battery cost
- low energy: caps at 3, only low battery cost
- no energy set: returns prompt
- occasions surfaced in output
- reconnection suggestions for black-tier contacts
- no contacts at all: graceful empty response

**Slash command:** `.claude/commands/kit-checkin.md`

Don't emit `<promise>KIT_V1_COMPLETE</promise>` until all 10 phases are green.
