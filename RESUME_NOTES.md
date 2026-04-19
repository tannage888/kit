# Resume Notes — Kit v1.0

Scratchpad for the ralph-loop. Each iteration must update this file.

---

## Phase history

- Phase 1 ✅ — Gateway REST-client refactor (84 tests)
- Phase 2 ✅ — Markdown schema (88 tests)
- Phase 3 ✅ — Energy state + /kit-energy (98 tests)
- Phase 4 ✅ — Drift/safety/occasion pure functions (135 tests)
- Phase 5 ✅ — Daily check-in + /kit-checkin (147 tests, 2026-04-19)

---

## Current status: Phase 5 complete — Beginning Phase 6

### Phase 6 — /kit-prep, /kit-draft (FR-02, FR-03)

**Goal:** Conversation prep card and message drafting context.

**Deliverables:**

1. MCP tool `kit_prep_card(contact_name)` in `tools.ts`
   - Returns: contact record, last 5 Open Brain thoughts, open follow-ups,
     2-3 suggested question themes (assembled by Claude from the data, not server-side)
   - No server-side Anthropic call — return raw context, let Claude draft

2. MCP tool `kit_draft_context(contact_name, intent?)` in `tools.ts`
   - Returns: origin_story, special_interests, sensitive_topics,
     last 3 INTERACTION thoughts, open NEXT_ACTIONs, tier, time-since-last-contact
   - No server-side Anthropic call

3. `.claude/commands/kit-prep.md` and `.claude/commands/kit-draft.md`

4. Tests in `gateway/src/mcp/prep.test.ts` (pure shape tests, no real Supabase)

**Note:** Both tools reuse `getContact()` heavily — kit_prep_card is essentially
`getContact()` formatted for pre-conversation use. Will add a dedicated
`kitPrepCard()` function that returns structured JSON for Claude to present.

Don't emit `<promise>KIT_V1_COMPLETE</promise>` until all 10 phases are green.
