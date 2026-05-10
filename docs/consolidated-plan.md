# Kit v1.0 — Consolidated Plan & Progress

Snapshot date: **2026-05-04**. Single-page synthesis of [kit_specification.md](kit_specification.md), [implementation-plan.md](implementation-plan.md), [kit-migration.md](kit-migration.md), [whatsapp-daemon-setup.md](whatsapp-daemon-setup.md), [manual-test-plan.md](manual-test-plan.md), [future-work.md](future-work.md), [ralph-prompt.md](ralph-prompt.md), and the original [Neurodivergent Networking App - Feature Suggestions.md](Neurodivergent%20Networking%20App%20-%20Feature%20Suggestions.md).

---

## 1. What Kit is

A **conversational-only** relationship-management tool for neurodivergent (autism / ADHD) users, built around six pain points that traditional CRMs ignore: knowing what to say, initiating contact without a reason, remembering context, managing social energy, time blindness, and rejection anxiety.

Framing is *tending to relationships* (gardening), not *networking* (transacting). All interaction happens through Claude Code slash commands (`/kit-*`) — no mobile app in v1.0.

---

## 2. Architecture (as built)

```
Claude Code  ── slash commands (.claude/commands/kit-*.md)
     │
     ▼
Kit gateway (Express, :3141)  ── REST ──►  claude_whatsapp_integration daemon (:3142)
     │                                              │
     │                                              └── Baileys ──► WhatsApp
     ├──► Supabase (kit schema)                       (Kit never touches Baileys)
     ├──► Open Brain (via ContextBinder only)
     └──► People/*.md (chokidar file watcher)
```

Key invariants (CLAUDE.md):
- All Supabase queries on Kit tables chain `.schema('kit')` — Kit tables live in the `kit` schema, never `public`.
- All Open Brain writes go through `ContextBinder.capture()` — never insert into `thoughts` directly.
- `People/` is gitignored (personal data). `People.template/` is the committed schema example.
- `whatsapp_capture` defaults to `disabled` per contact — opt-in privacy posture.

---

## 3. Functional requirements (FR-00 → FR-11)

| FR | Feature | Slash command | Status |
|---|---|---|---|
| FR-00 | Set energy level | `/kit-energy` | ✅ Phase 3 |
| FR-01 | Daily check-in | `/kit-checkin` | ✅ Phase 5 |
| FR-02 | Conversation prep card | `/kit-prep` | ✅ Phase 6 |
| FR-03 | Message scaffolding | `/kit-draft` | ✅ Phase 6 |
| FR-04 | Drift meter | (surfaced in checkin) | ✅ Phase 4 |
| FR-05 | Update contact | `/kit-update` | ✅ Phase 7 |
| FR-06 | WhatsApp integration | `/kit-captures`, `/kit-sweep` | ✅ Phase 9 + Phase 11 |
| FR-07 | Reconnection scripts | `/kit-reconnect` | ✅ Phase 8 |
| FR-08 | Post-interaction debrief | `/kit-update` | ✅ Phase 7 |
| FR-09 | Follow-up tracker | `/kit-followup` | ✅ Phase 7 |
| FR-10 | Occasion awareness | (surfaced in checkin) | ✅ Phase 4 |
| FR-11 | "Safe to reach out?" | (surfaced in checkin) | ✅ Phase 4 |

Non-FR additions actually shipped: `/kit-add-contact` (in-session, uncommitted) and `/kit-sweep` (manual sweep trigger).

---

## 4. Phase-by-phase progress

All 11 phases complete. **212 tests passing across 13 test files** as of 2026-05-02.

### ✅ Phase 1 — Gateway REST-client refactor
Removed embedded Baileys; gateway now talks to the dedicated daemon over HTTP. Refactored [history-fetcher.ts](../gateway/src/services/history-fetcher.ts), [sweep-scheduler.ts](../gateway/src/services/sweep-scheduler.ts), [routes/api.ts](../gateway/src/routes/api.ts) (dropped `/auth/status`, `/send`, `/debug/store`; added `POST /api/incoming-message`), boot sequence in [index.ts](../gateway/src/index.ts). 84 tests.

### ✅ Phase 2 — Markdown schema + parser updates
Frontmatter fields added end-to-end: `social_battery_cost`, `origin_story`, `special_interests`, `sensitive_topics`, `preferred_channel`, `birthday`, `whatsapp_capture`. Migration `20260419_phase2_contact_fields.sql`. Sync tolerates legacy markdown. 88 tests.

### ✅ Phase 3 — Energy state + `/kit-energy`
`kit.energy_state` table, [energy.ts](../gateway/src/services/energy.ts) service, MCP tool `kit-set-energy` / `kit-get-energy`, [.claude/commands/kit-energy.md](../.claude/commands/kit-energy.md). Midnight reset, level validation. 98 tests.

### ✅ Phase 4 — Drift / safety / occasion pure functions
[relationship-status.ts](../gateway/src/services/relationship-status.ts) — `computeDriftStatus`, `computeSafetyIndicator`, `computeOccasions`. Table-driven tests across every threshold. 135 tests.

### ✅ Phase 5 — `/kit-checkin`
[checkin.ts](../gateway/src/services/checkin.ts) — `buildCheckinReport` filters by current energy: High = all overdue + due-7d, Medium = up to 7 (1 high + rest med/low), Low = up to 3 (max med, prefer low). MCP `kit-daily-checkin`, [.claude/commands/kit-checkin.md](../.claude/commands/kit-checkin.md). Surfaces drift, safety copy, occasions, reconnection suggestions, follow-up count. 147 tests.

### ✅ Phase 6 — `/kit-prep`, `/kit-draft`
[prep.ts](../gateway/src/services/prep.ts) — `buildPrepCard` (contact + last 5 thoughts + open follow-ups + suggested questions), `buildDraftContext` (origin story, interests, sensitive topics, last 3 INTERACTIONs, open NEXT_ACTIONs, time-since-last-contact). **Decision 7: no server-side Anthropic call** — Claude composes drafts in-chat from returned context. 163 tests.

### ✅ Phase 7 — `/kit-update`, `/kit-followup`
`log-interaction` (4 side effects: interaction_log row, contacts.last_contact + next_action update, ContextBinder INTERACTION write, markdown append under `## Interaction Log`). Follow-ups CRUD (add / list / complete). Sync loop-guard prevents echo.

### ✅ Phase 8 — `/kit-reconnect`
[reconnect.ts](../gateway/src/services/reconnect.ts) — `buildReconnectContext` returns gap in human terms ("4 months"), tier, origin story, last topics, suggested opener style. Decision 7 again — Claude composes in-chat. 174 tests.

### ✅ Phase 9 — WhatsApp capture wiring (FR-06)
`POST /api/incoming-message` route wired to MessageRouter. Router drops messages for `whatsapp_capture: disabled` contacts. CapturePipeline review-card flow: MCP tools `kit-pending-captures` / `kit-confirm-capture` / `kit-dismiss-capture`, [.claude/commands/kit-captures.md](../.claude/commands/kit-captures.md). [docs/whatsapp-daemon-setup.md](whatsapp-daemon-setup.md) added. 179 tests.

**Capture-path nuance:** live capture via `/api/incoming-message` queues for review (no silent storage). Sweep-based capture uses `processAndCommit` and writes directly — by design, since the user opted into the schedule. Confirmed in [capture.ts:85](../gateway/src/services/capture.ts#L85).

### ✅ Phase 10 — E2E smoke test + completion
[src/e2e.test.ts](../gateway/src/e2e.test.ts) — 15 tests covering Phases 3–9 pure-function layer with in-memory Supabase + Open Brain stubs. [docs/manual-test-plan.md](manual-test-plan.md) for live verification. **194 tests total at completion (2026-04-19).**

### ✅ Phase 11 — ZIP transcript ingestion (added 2026-05-02)
Lets the user WhatsApp themselves an "Export Chat" ZIP and have it surface in `/kit-captures` like a live conversation.

- [contacts.ts](../gateway/src/services/contacts.ts) — `findByName` + `jidFor` helpers
- [routes/api.ts](../gateway/src/routes/api.ts) — `POST /api/contacts/resolve-name` (daemon NameResolver hook), `POST /api/zip-import-complete` (import-complete webhook)
- [import-ingestor.ts](../gateway/src/services/import-ingestor.ts) — pulls full transcript from daemon, routes through MessageRouter, drains synchronously via `triggerCapture(contactId, {source: "zip-import"})`, acks watermark
- [capture.ts](../gateway/src/services/capture.ts) — `CaptureOptions { source?: "zip-import" }` threaded through; review-card prefix becomes "Imported WhatsApp transcript with …"
- Daemon-side companion wiring documented in [whatsapp-daemon-setup.md](whatsapp-daemon-setup.md#zip-transcript-ingestion-phase-11)

**Design decisions:**
- *Pull, not push* — daemon webhook is a small JSON envelope; Kit calls back over existing transcript+ack endpoints.
- *Bypass inactivity buffer* — ZIP is complete by definition; ingestor calls `triggerCapture` synchronously instead of waiting for the auto-capture timer.
- *Privacy preserved* — `whatsapp_capture: disabled` short-circuits at the ingestor; `wa_capture: off` drops at MessageRouter, but watermark is still acked so the same import doesn't reappear.

**212 tests.** Validated end-to-end with a real 221-message Samir Patel chat on 2026-05-02.

---

## 5. Currently uncommitted (in-flight as of 2026-05-04)

Live in working tree but not yet committed. Originated from the 2026-05-02 production debug session.

### Bug fixes (Kit side)
| File | Fix |
|---|---|
| [import-ingestor.ts](../gateway/src/services/import-ingestor.ts) | Use `mode=full` instead of `since_last_review` (historical ZIP messages predate the live watermark; `since_last_review` filtered them all out) |
| [message-router.ts](../gateway/src/services/message-router.ts) | `contactToJid()` was not stripping spaces from E.164 numbers (e.g. `"+44 7956 289692"`); fix matches `ContactRegistry.e164ToJid` normalisation |

Both files still carry `📥` debug logs that need stripping before commit.

### Bug fixes (daemon side, separate repo)
| File | Fix |
|---|---|
| `src/services/whatsapp.ts` | `messages.upsert` type gate only allowed `notify`; self-sent messages arrive as `append` (multi-device sync). Allow both. |
| `src/services/phone-export-importer.ts` | Parser only handled iOS `[DD/MM/YYYY, HH:MM:SS]`; Android exports use `DD/MM/YY, HH:MM - ` (no brackets). Dual regex + UK/US date-order fallback + NaN-timestamp rejection. |
| `src/services/read.ts` | Defensive filter for stored NaN-timestamp messages from failed imports |
| `src/index.ts` | Trim verbose `📦` onImport logging |

### New, untracked
- [contact-creator.ts](../gateway/src/services/contact-creator.ts) — service for /kit-add-contact
- [.claude/commands/kit-add-contact.md](../.claude/commands/kit-add-contact.md) — slash command
- [.claude/commands/kit-sweep.md](../.claude/commands/kit-sweep.md) — manual sweep trigger
- 4 new contact files added live on 2026-05-02 (Say Keat Ooi, Teng Chew Ooi, Peter Tan, Kat Osman) — markdown written, Supabase sync depends on SyncService picking them up

### Sweep scheduler tweak (already committed: 2947cdd)
Default sweep cadence changed from every 3 days → every 3 hours.

---

## 6. Slash commands (current set)

| Command | Purpose |
|---|---|
| `/kit-energy [H/M/L]` | Set/check today's social energy |
| `/kit-checkin` | Daily contact list filtered by energy |
| `/kit-prep <name>` | Pre-flight brief for an upcoming conversation |
| `/kit-draft <name> [intent]` | Draft context for a personalised message (Claude composes in-chat) |
| `/kit-update <name> ...` | Log an interaction |
| `/kit-followup` | View / add / complete follow-ups |
| `/kit-reconnect <name>` | Reconnection script for a dormant contact |
| `/kit-captures [confirm/dismiss <id>]` | Review WhatsApp captures queued for confirmation |
| `/kit-sweep [name]` | Trigger a sweep (all contacts or one) |
| `/kit-add-contact` | Create a new contact (markdown + DB row + registry) |

---

## 7. Database schema (kit schema)

| Table | Phase | Purpose |
|---|---|---|
| `contacts` | Pre-existing + Phase 2 additions | Master contact list with all FR-relevant fields |
| `interaction_log` | Pre-existing | One row per logged conversation |
| `follow_ups` | Phase 7 | Per-contact open threads |
| `kit_meta` | Pre-existing | Misc gateway state |
| `wa_sweep_state` | Phase 1 | Watermark per contact for sweep cadence |
| `energy_state` | Phase 3 | One row per day, current energy level |

Migrations in [gateway/supabase/migrations/](../gateway/supabase/migrations/).

---

## 8. Design decisions (locked in)

From [implementation-plan.md](implementation-plan.md) §"Answered design decisions":

1. No mobile app in v1.0; Expo code preserved in `old/expo-app/`.
2. FR numbers cleaned up (no duplicates, no phantom FR-13 originally).
3. §5.9 capture pipeline documented end-to-end.
4. Git: `tannage888/kit` on GitHub; People/ excluded.
5. People/ never committed; `People.template/` is the committed schema example.
6. Slash commands as `.claude/commands/*.md` for v1.0; MCP-prompt migration is documented v1.1.
7. **No server-side Anthropic calls in `/kit-draft` or `/kit-reconnect`** — return structured context, Claude composes in-chat.
8. No push notifications — birthdays, drift, energy reminders all surface through `/kit-checkin`.
9. Dedicated `claude_whatsapp_integration` daemon for Kit (own port 3142, own `auth_state/kit/`).
10. **`whatsapp_capture` defaults to `disabled`** — opt-in per contact. Silent storage is a bug.
11. Ralph completion promise: `KIT_V1_COMPLETE` (already emitted).
12. People/ backed up to `People.backup-2026-04-19/` before code changes.
13. Expo / Jest artefacts moved (not deleted) to `old/`.

---

## 9. Future work (post-v1.0, not yet started)

From [future-work.md](future-work.md):

- **v1.1 — Portable MCP prompts.** Migrate `.claude/commands/*.md` to MCP prompts in [gateway/src/mcp/server.ts](../gateway/src/mcp/server.ts) so Kit works in Claude Desktop and any MCP-capable client. Trigger: ready to share with one other user.
- **v1.2 — Live incoming-message hook in the daemon.** `WA_INCOMING_HOOK_URL` push isn't yet implemented daemon-side. Until then, sweep-based capture (every 3h) is the fallback. No Kit-side changes needed when it lands.
- **v2.0 — Mobile app.** Expo code preserved in `old/expo-app/`. True push notifications would land here.
- **Multi-product daemon sharing.** WhatsApp Web's ~4-linked-devices limit will force this if a second product ships. Refactor daemon to multiplex; consumers stay separate.
- **Productising Kit.** Bundled installer, configurable People folder location, configurable Open Brain instance, licensing decisions.

---

## 10. Known gaps and follow-ups

Beyond uncommitted fixes (§5):

- **`createContact` MCP tool runs in MCP server process, not REST gateway.** The slash command falls back to writing markdown directly; SyncService handles DB sync. Worth adding a REST wrapper so the slash command can call it directly.
- **No formal verification that the 4 new contacts (2026-05-02) synced to Supabase.** Should be confirmed at next session start.
- **Phase 10 e2e covers Phases 3–9 pure-function layer only.** No e2e for Phase 11 (ZIP import path) — production validation on real Samir Patel chat is the only signal so far.
- **Daemon-side companion wiring for ZIP import** is documented in [whatsapp-daemon-setup.md](whatsapp-daemon-setup.md#daemon-side-wiring) but lives in the separate `claude_whatsapp_integration` repo.

---

## 11. Out of scope (explicitly v2.0+)

- Mobile app (Expo / React Native)
- True push notifications
- Message *sending* via Kit (v1.0 is user-initiated via WhatsApp directly)
- MCP server for Claude Desktop (planned v1.1)
- Multi-user / multi-tenant
- Sharing the daemon with other WhatsApp products
