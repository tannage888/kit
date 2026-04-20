# Ralph Loop Prompt — Kit v1.0

You are building Kit v1.0 — a conversational-interface relationship-management tool for neurodivergent users. The full specification is in [docs/kit_specification.md](kit_specification.md) and the phased implementation plan is in [docs/implementation-plan.md](implementation-plan.md). **Read both on every iteration before doing anything else.**

You are running inside the ralph-loop plugin. The same prompt is fed back to you between iterations. All your prior work persists on disk. Use that.

---

## On every iteration, do this in order

1. **Read [docs/kit_specification.md](kit_specification.md)** — the source of truth for requirements.
2. **Read [docs/implementation-plan.md](implementation-plan.md)** — the phased plan.
3. **Read `RESUME_NOTES.md`** at the repo root. If it doesn't exist, Stage A setup hasn't run — STOP and emit a text error (do not emit the completion promise).
4. **Run `npm test`** in `gateway/` and capture the output. Phases 1+ require green tests.
5. **Run `npx tsc --noEmit`** in `gateway/`. Must pass.
6. **Identify the current phase** from RESUME_NOTES plus by checking which phases have completion criteria already met.
7. **Do work on the current phase only.** Do not skip ahead. Do not refactor earlier phases unless their tests are red.
8. **Update `RESUME_NOTES.md`** at end of iteration with:
   - Current phase number and name
   - What you did this iteration
   - Test status (green/red, with failing test names if red)
   - What the next iteration should focus on
9. **Check completion**: emit `<promise>KIT_V1_COMPLETE</promise>` ONLY when all 10 phases have green tests, the Phase 10 e2e spec passes, and RESUME_NOTES documents every phase done.

---

## The 10 phases (summary — full detail in [implementation-plan.md](implementation-plan.md) Stage B)

| Phase | Name | Done when |
|---|---|---|
| 1 | Gateway REST-client refactor | Baileys removed, `/api/incoming-message` works, existing tests still green |
| 2 | Markdown schema + parser updates | New fields round-trip MD ↔ Supabase, legacy MD tolerated |
| 3 | Energy state + `/kit-energy` | `kit.energy_state` table, MCP tool, slash command, tests |
| 4 | Drift + safety + occasion logic | Pure functions in `relationship-status.ts` with table-driven tests |
| 5 | `/kit-checkin` | `kit-daily-checkin` returns correct slice per energy level |
| 6 | `/kit-prep`, `/kit-draft` | Context-return tools (no server-side drafting) |
| 7 | `/kit-update`, `/kit-followup` | Interaction logging + follow-up CRUD, 4 side effects verified |
| 8 | `/kit-reconnect` | Dormant-contact context assembly + gap formatting |
| 9 | WhatsApp capture wiring | Router respects `whatsapp_capture` flag, review card flow, dedicated daemon setup docs |
| 10 | E2E smoke test + completion | One Vitest spec exercises end-to-end chain with stubs |

---

## Critical rules

- **Never emit `<promise>KIT_V1_COMPLETE</promise>` until every phase is done and all tests are green.** If blocked, document it in `RESUME_NOTES.md` under `## Blockers` and continue. The completion promise is the only honest signal that the project is done — do not fake it.
- **Stay strictly on the current phase.** If an earlier phase's tests are red, fix them first.
- **Tests are the contract.** Every phase's "Done when" is a green test suite. Code without tests is not done. Tests that don't exercise the requirement are not done.
- **Decision 7 — no server-side drafting.** FR-04 (`/kit-draft`) and FR-07 (`/kit-reconnect`) return structured context; Claude composes the message in-chat. Do not call the Anthropic API from inside these tools.
- **Decision 10 — `whatsapp_capture` defaults to `disabled`.** Messages for disabled contacts MUST be dropped at the router. Silent storage is a bug.
- **Open Brain writes go through `ContextBinder`.** Never insert into `thoughts` directly. See [CLAUDE.md](../CLAUDE.md).
- **Kit schema, not public.** Every Supabase query on Kit tables must chain `.schema('kit')` — see CLAUDE.md.
- **No Baileys anywhere in Kit.** The gateway is a REST client of the external `claude_whatsapp_integration` daemon on port 3142.
- **No scope creep.** No push notifications, no mobile-app code, no MCP server (that's v2.0 per [docs/future-work.md](future-work.md)), no Message-send tool.
- **Mock external services in tests.** In-memory stubs for Supabase and Open Brain. Never hit real endpoints in automated tests.
- **Write the minimum code that passes the tests for the current phase.** If you find yourself writing speculative helpers, stop.

---

## Stop conditions

Emit `<promise>KIT_V1_COMPLETE</promise>` when, and only when, all of the following are true:

- `npm test` (in `gateway/`) passes with zero failures.
- `npx tsc --noEmit` (in `gateway/`) passes with zero errors.
- Phase 10 e2e spec (`gateway/test/e2e.test.ts`) exists and passes.
- `docs/manual-test-plan.md` exists.
- `RESUME_NOTES.md` documents that all 10 phases are complete.

If blocked — a test you cannot make pass, an external API behaving differently than the plan assumed, an unresolvable type error — document it precisely in `RESUME_NOTES.md` under a `## Blockers` section and continue iterating on other phases or alternative approaches. Do NOT emit the completion promise to escape a blocker.

---

## Output format

End each iteration with a brief status line:

```
📍 Phase {N} — {short status}. Tests: {X passed, Y failed}. Next: {what to do next iteration}.
```
