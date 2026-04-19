# Kit v1.0 — Implementation Plan

Produced 2026-04-19. Covers the conversational-interface v1.0 of Kit described in [kit_specification.md](kit_specification.md).

The plan is executed in two stages:

1. **Stage A — Pre-implementation setup** (done by the user + assistant working together, *before* any ralph-loop run). This covers backup, git init + push, code cleanup, spec fixes, and ralph scaffolding. It is **not** run inside ralph-loop because it needs user-visible git remote setup.
2. **Stage B — Ralph-loop implementation** (phased build, each phase green before the next). Run via `/ralph-loop` with prompt in [ralph-prompt.md](ralph-prompt.md). Completion marker: `KIT_V1_COMPLETE`.

---

## Answered design decisions (locked in)

| # | Decision |
|---|---|
| 1 | No mobile app in v1.0. Expo app moves to [old/](../old/). |
| 2 | FR numbering renumbered cleanly in the spec (no duplicate FR-08, no phantom FR-13). |
| 3 | §5.9 capture pipeline text added (daemon → `/incoming-message` → router → capture → ContextBinder). |
| 4 | Git: `git init` + initial commit + push to `https://github.com/tannage888/kit` (empty remote). |
| 5 | [People/](../People/) is **not** committed (personal data). A `People.template/` directory with empty example files is committed instead. |
| 6 | Slash commands implemented as Claude Code `.claude/commands/*.md` for v1.0. Migration to MCP prompts is a documented follow-up (see [future-work.md](future-work.md)). |
| 7 | FR-04 drafting: `/kit-draft` returns structured context; Claude composes the draft in-chat. No server-side Anthropic call for drafting. |
| 8 | No push notifications. Birthdays, drift, energy reminders all surface through `/kit-checkin`. |
| 9 | Dedicated `claude_whatsapp_integration` daemon instance for Kit — own port, own `auth_state/kit/`. |
| 10 | Frontmatter field `whatsapp_capture: enabled \| disabled`, default `disabled` (opt-in per contact). |
| 11 | Ralph completion promise: `KIT_V1_COMPLETE`. |
| 12 | `People/` backed up to `People.backup-2026-04-19/` before any code change. Gitignored. |
| 13 | Expo/Jest artefacts moved (not deleted) to [old/](../old/). Gateway stays, slimmed per migration doc. |

---

## Stage A — Pre-implementation setup (outside ralph)

These steps are irreversible or need user-visible operations (git remote push). Done once, by hand, before ralph runs.

### A0. Backup People folder
- `cp -r People People.backup-2026-04-19`
- Verify file counts match
- Add `People.backup-*` to `.gitignore`

### A1. Spec cleanup (edit [kit_specification.md](kit_specification.md))
- Renumber FRs: FR-00, FR-01, FR-02 (Prep), FR-03 (Draft), FR-04 (Drift), FR-05 (Update), FR-06 (WhatsApp), FR-07 (Reconnection), FR-08 (Debrief), FR-09 (Follow-up), FR-10 (Occasion), FR-11 (Safety indicator). Keep slash command names unchanged where they already map (`/kit-checkin`, `/kit-prep` etc.), just fix header numbers.
- Fill §5.9 with the agreed text.
- Update §2.1 / §7.1 to reflect "Claude Code slash commands for v1.0, MCP prompts as future work."
- Add a **Contact record** row: `whatsapp_capture: enum` (enabled, disabled — default disabled).

### A2. Move Expo app to old/
- `mkdir -p old/expo-app`
- Move: [src/](../src/), [app/](../app/), [scripts/seed.ts](../scripts/seed.ts), [app.json](../app.json), [babel.config.js](../babel.config.js), root [package.json](../package.json), [assets/](../assets/), [tsconfig.json](../tsconfig.json), [tsconfig.seed.json](../tsconfig.seed.json) into `old/expo-app/`
- Move [project.yaml](../project.yaml) and [recipe-transcriber-eval-review.html](../recipe-transcriber-eval-review.html), [recipe-transcriber.skill](../recipe-transcriber.skill) into `old/` (unrelated to Kit v1.0)
- Keep: [gateway/](../gateway/), [People/](../People/), [docs/](../docs/), [CLAUDE.md](../CLAUDE.md), [README.md](../README.md)

### A3. Gateway cleanup (per [kit-migration.md](../../claude_whatsapp_integration/docs/kit-migration.md))
- Delete: `gateway/src/services/whatsapp.ts`, `gateway/src/services/message-store.ts`, `gateway/auth_state/`
- `npm uninstall @whiskeysockets/baileys qrcode-terminal @types/qrcode-terminal` in `gateway/`
- Remove `AUTH_STATE_PATH`, `WHATSAPP_PHONE` from [config.ts](../gateway/src/config.ts). Add `EXTERNAL_GATEWAY_URL` (default `http://127.0.0.1:3142`).

Note: the dedicated Kit daemon runs on port **3142** (main `claude_whatsapp_integration` uses 3100). Kit gateway stays on **3141**.

### A4. Create People.template/
- `People.template/1 - Inner Circle/Example Contact.md` — one file showing all YAML fields with placeholder values and a comment explaining each
- Same for tiers 2 and 3
- Commit

### A5. Write ralph scaffolding files
- [docs/ralph-prompt.md](ralph-prompt.md) — operative prompt for each ralph iteration
- [docs/future-work.md](future-work.md) — MCP migration path, multi-product daemon sharing, mobile v2.0
- `RESUME_NOTES.md` at repo root — scratchpad ralph writes to each iteration (starts empty except for a one-line marker "Iteration 0 — not yet started")

### A6. Update [CLAUDE.md](../CLAUDE.md)
- Remove Expo/mobile app references
- Replace the "Kit is two sub-projects" line with "Kit v1.0 is a conversational-interface CRM: Claude Code slash commands → Kit gateway MCP tools → Supabase + Open Brain. A dedicated `claude_whatsapp_integration` daemon handles WhatsApp."
- Update architecture notes for the REST-client gateway

### A7. Git init + initial commit + push
- `git init`
- Create [.gitignore](../.gitignore) — includes `node_modules/`, `auth_state/`, `People/`, `People.backup-*/`, `.env`, `dist/`, `*.log`, `old/`
- `git add .` then `git commit -m "chore: initial commit — kit v1.0 conversational interface"`
- `git remote add origin https://github.com/tannage888/kit.git`
- `git branch -M main`
- `git push -u origin main`

*(A7 is the only step that mutates a shared resource. The user should confirm the remote is empty before I push.)*

### A8. User reviews plan
- User reads this document + the ralph prompt
- User confirms the remote is empty and wants to push
- User says "begin"
- Assistant invokes `/ralph-loop` with `--completion-promise "KIT_V1_COMPLETE"`

---

## Stage B — Ralph-loop phases

Each phase lists **goal**, **deliverables**, and **completion criteria** (a green test suite). A phase is done when its tests pass. Ralph advances one phase per iteration (or more if it can land multiple phases cleanly). All phases live in [kit/gateway/](../gateway/) except where noted.

### Phase 1 — Gateway REST-client refactor

**Goal:** Gateway no longer embeds Baileys; it's a REST client of the dedicated daemon.

**Deliverables:**
- Refactor [history-fetcher.ts](../gateway/src/services/history-fetcher.ts) to accept a `gatewayUrl` and fetch messages via `GET /api/chats/:jid/messages?from=<iso>` (per migration doc)
- Refactor [sweep-scheduler.ts](../gateway/src/services/sweep-scheduler.ts) to check daemon `/api/status` instead of `wa.getStatus()`
- Rewrite [routes/api.ts](../gateway/src/routes/api.ts): drop `/auth/status`, `/send`, `/debug/store`; add `POST /api/incoming-message`; update `GET /api/status` to proxy daemon connection state
- Rewrite [index.ts](../gateway/src/index.ts) boot sequence (no Baileys init)

**Tests (green before phase done):**
- [history-fetcher.test.ts](../gateway/src/services/history-fetcher.test.ts) — mock `fetch`, verify REST call shape, thread grouping unchanged
- [sweep-scheduler.test.ts](../gateway/src/services/sweep-scheduler.test.ts) — mock daemon status, verify sweep skips when `connection: "unavailable"`
- New `src/routes/api.test.ts` — `POST /api/incoming-message` validates schema, invokes router; `GET /api/status` aggregates daemon status
- `npx tsc --noEmit` clean

### Phase 2 — Markdown schema + parser updates

**Goal:** New frontmatter fields supported end-to-end: `social_battery_cost`, `origin_story`, `special_interests`, `sensitive_topics`, `preferred_channel`, `birthday`, `whatsapp_capture`.

**Deliverables:**
- Update the contact parser in [sync.ts](../gateway/src/services/sync.ts) (`parseContactFile()`) to read the new fields
- Update the markdown writer (Supabase → markdown direction in sync.ts) to write them back
- Update [contacts.ts](../gateway/src/services/contacts.ts) in-memory `TrackedContact` type
- Supabase migration in `gateway/supabase/migrations/` adding columns to `kit.contacts`:
  - `social_battery_cost` text (check: Low/Medium/High)
  - `origin_story` text, `special_interests` text, `sensitive_topics` text
  - `preferred_channel` text, `birthday` date
  - `whatsapp_capture` text default `'disabled'` (check: enabled/disabled)

**Tests:**
- Extend existing [sync.test.ts](../gateway/src/services/sync.test.ts) with round-trip: write MD → upsert → read row → write MD, new fields preserved
- Parser tolerates legacy markdown missing the new fields (default values applied)

### Phase 3 — Energy state + /kit-energy

**Goal:** FR-00 working end-to-end.

**Deliverables:**
- Supabase table `kit.energy_state` (`day date primary key, level text check in ('high','medium','low')`)
- New service `gateway/src/services/energy.ts` with `setEnergy(level)`, `getEnergyForToday()` (returns null if not set, resets at midnight local)
- MCP tool `kit_set_energy` in [tools.ts](../gateway/src/mcp/tools.ts)
- `.claude/commands/kit-energy.md` — calls the MCP tool, reports back

**Tests:**
- `energy.test.ts` — set/get round-trip, midnight reset, invalid values rejected
- `tools.test.ts` (new) — `kit_set_energy` maps args correctly

### Phase 4 — Drift + safety + occasion pure functions

**Goal:** The logic for FR-04 (drift meter), FR-11 (safety indicator), FR-10 (occasions) is pure-functional and unit-tested.

**Deliverables:**
- `gateway/src/services/relationship-status.ts`:
  - `computeDriftStatus(last_contact, frequency, today): "green" | "yellow" | "red" | "black"`
  - `computeSafetyIndicator(drift): { status, copy }` (per §4 FR-11 table)
  - `computeOccasions(contact, today): OccasionTrigger[]` (birthday ±2 days, life-event hooks from notes)

**Tests:**
- `relationship-status.test.ts` — table-driven tests covering every threshold

### Phase 5 — /kit-checkin (FR-01)

**Goal:** Daily check-in produces the right contact list based on current energy, surfacing drift, occasions, and safety copy.

**Deliverables:**
- MCP tool `kit_daily_checkin`:
  - Reads energy_state for today (prompts user to set if null)
  - Loads all contacts, computes drift + safety + occasions
  - Filters by energy: High = all overdue + due + due-next-7-days; Medium = up to 7, 1×High + rest Med/Low; Low = up to 3, max Med preferably Low
  - Returns structured JSON: `{ energy, contacts: [{name, tier, last_contact, drift, safety, occasion?}], reconnection_suggestions, followup_count }`
- `.claude/commands/kit-checkin.md`

**Tests:**
- `checkin.test.ts` with a seeded contact set — each energy level returns the correct slice

### Phase 6 — /kit-prep, /kit-draft (FR-02, FR-03)

**Goal:** Conversation prep card + message drafting context.

**Deliverables:**
- MCP tool `kit_prep_card(contact_name)` — returns contact record + last 5 Open Brain thoughts (via `ContextBinder.getContext`) + open follow-ups + 2–3 suggested questions (generated by Claude in-chat using the returned data, not server-side)
- MCP tool `kit_draft_context(contact_name, intent)` — returns origin_story, special_interests, sensitive_topics, last 3 INTERACTION thoughts, open NEXT_ACTIONs, tier, time-since-last-contact. Decision 7: no server-side Anthropic call.
- `.claude/commands/kit-prep.md` and `.claude/commands/kit-draft.md`

**Tests:**
- `prep.test.ts` — correct context assembly, follow-ups sorted, missing fields handled
- `draft-context.test.ts` — all fields present in response shape

### Phase 7 — /kit-update, /kit-followup (FR-05, FR-08, FR-09)

**Goal:** Log interactions, manage follow-ups.

**Deliverables:**
- MCP tool `kit_log_interaction(contact_name, summary, topics?, followups?, sentiment?, channel?, date?)`:
  - Inserts into `kit.interaction_log`
  - Updates `contacts.last_contact` and recomputes `next_action`
  - Calls `ContextBinder.capture()` with `source: "kit-manual"`
  - Writes summary line to markdown under `## Interaction Log`
- MCP tools: `kit_list_followups(contact_name?)`, `kit_add_followup`, `kit_complete_followup`
- `.claude/commands/kit-update.md`, `.claude/commands/kit-followup.md`

**Tests:**
- `log-interaction.test.ts` — all four side effects fire; sync loop-guard prevents echo
- `followups.test.ts` — CRUD + surface in prep card

### Phase 8 — /kit-reconnect (FR-07)

**Goal:** Reconnection scripts for dormant contacts.

**Deliverables:**
- MCP tool `kit_reconnect_context(contact_name)`:
  - Computes gap duration in human terms ("4 months")
  - Returns tier, origin_story, last topics, notes, suggested opener style
  - Claude composes the script in-chat (decision 7)
- `.claude/commands/kit-reconnect.md`
- `kit_daily_checkin` includes `reconnection_suggestions` array for any Black-tier contacts

**Tests:**
- `reconnect.test.ts` — context shape, gap formatting

### Phase 9 — WhatsApp capture wiring (FR-06)

**Goal:** Incoming message hook works end-to-end with the dedicated daemon.

**Deliverables:**
- `POST /api/incoming-message` endpoint (done in Phase 1, verify wired to MessageRouter)
- ContactRegistry respects `whatsapp_capture` flag: messages for `disabled` contacts are dropped at the router (never enter capture pipeline)
- CapturePipeline review card flow: `processAndCommit` vs `process()` already exist — add a `kit_pending_captures` MCP tool + `kit_confirm_capture(id)` + `kit_dismiss_capture(id)` for user review via `/kit-captures`
- `.claude/commands/kit-captures.md`
- Setup docs: `docs/whatsapp-daemon-setup.md` — how to run a dedicated `claude_whatsapp_integration` instance on port 3142 with `WA_INCOMING_HOOK_URL=http://127.0.0.1:3141/api/incoming-message`

**Tests:**
- `message-router.test.ts` — messages for `whatsapp_capture: disabled` contacts are ignored
- `capture.test.ts` (extend) — confirm/dismiss flow; dismiss writes nothing to Open Brain

### Phase 10 — End-to-end smoke test + completion

**Goal:** Prove the whole thing works without a real WhatsApp or Supabase connection.

**Deliverables:**
- `gateway/test/e2e.test.ts` — single Vitest spec that:
  1. Stands up in-memory stubs for Supabase + Open Brain
  2. Sets energy to High
  3. Seeds 3 contacts at different drift states + one with `whatsapp_capture: enabled`
  4. Simulates an incoming message via the `/api/incoming-message` route
  5. Forces inactivity → capture pipeline → review card
  6. Confirms capture → verifies interaction_log insert + ContextBinder call + markdown append + drift recomputation
  7. Runs `kit_daily_checkin` → expects the 3 seeded contacts in the correct slice
  8. Runs `kit_prep_card` for one contact → expects follow-ups surfaced
- `docs/manual-test-plan.md` — checklist for a live run against the real daemon + Supabase (human verification)
- `README.md` updated with the v1.0 install flow

**Completion criteria:**
- `npm test` green in `gateway/`
- `npx tsc --noEmit` clean
- `docs/manual-test-plan.md` exists
- `RESUME_NOTES.md` notes all 10 phases complete
- Ralph emits `<promise>KIT_V1_COMPLETE</promise>`

---

## Test strategy

- **Unit tests** — every pure function (drift, safety, energy reset, thread grouping) has a dedicated `*.test.ts`
- **Service tests** — each gateway service is tested with in-memory Supabase / Open Brain / fetch stubs
- **E2E** — one Phase-10 Vitest spec exercises the full chain without external dependencies
- **Manual test plan** — a human checklist for anything Vitest cannot prove (real Baileys pairing, real Claude conversation, real markdown on disk with file watcher)
- No mocks allowed for pure-functional code; stubs only for IO boundaries

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Ralph emits completion promise prematurely | Explicit rule in [ralph-prompt.md](ralph-prompt.md): "Never emit `KIT_V1_COMPLETE` until `npm test` green AND Phase 10 e2e passes AND RESUME_NOTES marks all phases done" |
| Incoming-message hook not yet implemented in daemon | [kit-migration.md](../../claude_whatsapp_integration/docs/kit-migration.md) notes this. Phase 9 covers it on the Kit side; daemon-side hook implementation is flagged as a follow-up if not already done. Sweep-based capture works without it. |
| Personal data in `People/` leaks via git | [.gitignore](../.gitignore) excludes `People/`. Backup `People.backup-*/` also excluded. Only `People.template/` is committed. |
| Open Brain thoughts written to wrong instance | Tests verify `ContextBinder` is constructed with `OPEN_BRAIN_URL`, never `SUPABASE_URL`. CLAUDE.md already documents this invariant. |
| Ralph introduces scope creep | Phases are small, test-gated. The prompt says "stay strictly on the current phase." |

---

## Out of scope (explicitly v2.0)

- Mobile app (Expo/React Native)
- True push notifications
- Message sending via Kit (v1.0 is user-initiated via WhatsApp direct)
- MCP server for Claude Desktop (v1.0 uses Claude Code slash commands — see [future-work.md](future-work.md))
- Multi-user / multi-tenant
- Sharing a daemon with other WhatsApp-integrated products
