# Resume Notes — Kit v1.0

Scratchpad for the ralph-loop. Each iteration must update this file.

---

## Current status: Phase 3 complete — Beginning Phase 4

### Phase 1 ✅ — Gateway REST-client refactor
### Phase 2 ✅ — Markdown schema + parser (88 tests)
### Phase 3 ✅ — Energy state + /kit-energy (98 tests, 2026-04-19)

Phase 3 delivered:
- `kit.energy_state` table migration
- `EnergyService.setEnergy()` / `getEnergyForToday()`
- `kit_set_energy` + `kit_get_energy` MCP tools
- `.claude/commands/kit-energy.md` slash command
- 10 tests in `energy.test.ts`

---

## Phase 4 — Drift + safety + occasion pure functions

**Goal:** FR-04 (drift), FR-11 (safety indicator), FR-10 (occasions) as pure-functional, unit-tested logic.

**File to create:** `gateway/src/services/relationship-status.ts`

### computeDriftStatus(last_contact, frequency_days, today)

Threshold table (days since last contact vs frequency_days):
- green  → within frequency window (overdue ≤ 0 days)
- yellow → 1–0.5× overdue (e.g. 30-day frequency: 1–15 days past due)
- red    → 0.5–1× overdue (15–30 days past due for Monthly)
- black  → more than 1× the frequency overdue

Example: Monthly (30 days):
- green  if days_since ≤ 30
- yellow if days_since 31–45
- red    if days_since 46–60
- black  if days_since > 60

### computeSafetyIndicator(drift)

Per spec FR-11:
- green  → "All good 🟢"
- yellow → "Check in soon 🟡"
- red    → "Reaching out recommended 🔴"
- black  → "Relationship at risk ⚫"

### computeOccasions(contact, today): OccasionTrigger[]

Types:
- birthday: if contact.birthday, trigger when today is within 2 days before or on the birthday (year-agnostic)
- no other triggers needed for Phase 4

### Tests

`gateway/src/services/relationship-status.test.ts`
- table-driven tests for all drift thresholds (green/yellow/red/black)
- safety indicator maps drift to correct copy
- birthday occasion triggers ±2 days
- no birthday → empty occasions array

Don't emit `<promise>KIT_V1_COMPLETE</promise>` until all 10 phases are green.
