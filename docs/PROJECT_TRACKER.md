---
project: kit
display_name: Kit
owner: mark
status: active
priority: 3
created: 2026-05-04
last_reviewed: 2026-05-04
permissions: acceptEdits
max_concurrent_agents: 1
shared_resources:
  - whatsapp_daemon
  - port_3141
  - port_3142

current_stage: cleanup_phase11

stages:
  cleanup_phase11:
    model: sonnet
    loop: single
    prompt: |
      Phase 11 (ZIP transcript ingestion) shipped 2026-05-02 but two production
      fixes are uncommitted, with debug 📥 console.log statements still in the
      code. Three new untracked files also need committing.

      Read RESUME_NOTES.md §"Bug fixes found during live test" first for the
      context behind each fix.

      Job:
      1. Read gateway/src/services/import-ingestor.ts and
         gateway/src/services/message-router.ts. Remove only the console.log /
         console.warn lines that contain the 📥 emoji. Do not touch any other
         code.
      2. Run `cd gateway && npm test`. It must remain at 212 passing tests
         across 13 files. If anything goes red, the log was load-bearing — stop
         and escalate.
      3. Run `npx tsc --noEmit` from gateway/. Must be clean (existing 6
         pre-existing errors in e2e.test.ts are acceptable; no NEW errors).
      4. Commit in two logical chunks:
         - `fix: strip Phase 11 debug logs from import-ingestor and message-router`
           (the two modified files)
         - `feat: kit-add-contact and kit-sweep slash commands`
           (gateway/src/services/contact-creator.ts,
            .claude/commands/kit-add-contact.md,
            .claude/commands/kit-sweep.md)
      5. Do NOT commit:
         - People/ contents (gitignored — personal data)
         - RESUME_NOTES.md (working scratchpad)
         - docs/PROJECT_TRACKER.md (this file)
         - .claude/settings.json (local settings)
         - daemon-side files (different repo)
      6. Confirm `git status --porcelain` shows no remaining entries for the
         two fixed files.

      Use HEREDOC for commit messages. Do not push.
    success_criteria: |
      `cd gateway && npm test` exits 0 AND
      `grep -l '📥' gateway/src/services/import-ingestor.ts gateway/src/services/message-router.ts`
      returns no matches AND
      `git status --porcelain gateway/src/services/import-ingestor.ts gateway/src/services/message-router.ts`
      is empty
    needs_human_for:
      - any test going red after log removal
      - merge conflicts or unexpected git state
      - new untracked files appearing that aren't in the known list

  verify_contact_sync:
    model: haiku
    loop: single
    prompt: |
      Four contacts were added to People/ on 2026-05-02 but their Supabase
      sync via SyncService hasn't been verified. Confirm each one has a row
      in kit.contacts via the gateway's REST API.

      Contact IDs to verify:
      - say_keat_ooi   (People/2 - Active/Say Keat Ooi.md)
      - teng_chew_ooi  (People/2 - Active/Teng Chew Ooi.md)
      - peter_tan      (People/1 - Inner Circle/Peter Tan.md)
      - kat_osman      (People/1 - Inner Circle/Kat Osman.md)

      Method:
      1. Confirm Kit gateway is up: `curl -fs http://127.0.0.1:3141/api/status`.
         If not, stop and escalate.
      2. Fetch contacts list: `curl -fs http://127.0.0.1:3141/api/contacts`.
      3. Verify all 4 IDs appear in the response.
      4. If any are missing: do NOT manually insert them. Escalate — most
         likely the chokidar watcher missed the create, or frontmatter is
         malformed. The fix is to investigate sync.ts logs, not bypass it.

      No code modifications under any circumstances.
    success_criteria: |
      `curl -fs http://127.0.0.1:3141/api/contacts | grep -oE '(say_keat_ooi|teng_chew_ooi|peter_tan|kat_osman)' | sort -u | wc -l`
      returns 4
    needs_human_for:
      - gateway not running on 127.0.0.1:3141
      - any of the 4 contact IDs missing from the response

next_actions: []
blockers: []
last_dispatch:
  stage: null
  agent_id: null
  started_at: null
  completed_at: null
  outcome: null
history: []
---

# Kit — Project Tracker

## What this project is

Kit is a conversational-only relationship-management tool for neurodivergent
(autism / ADHD) users. All interaction happens through Claude Code slash
commands (`/kit-*`) calling the Kit gateway. No mobile app in v1.0.

Full context: [consolidated-plan.md](consolidated-plan.md). Original spec:
[kit_specification.md](kit_specification.md).

## Headline status (2026-05-04)

- **All 11 phases complete.** `KIT_V1_COMPLETE` was emitted 2026-05-02.
- **212 tests passing** across 13 test files in `gateway/`.
- **Phase 11 (ZIP transcript ingestion) shipped and validated in production**
  with a real 221-message Samir Patel chat.
- **Production fixes from that live test are uncommitted** and carry debug
  logs that need stripping — this is the active stage.

## Stage rationale

**`cleanup_phase11` (current_stage)** — concrete mechanical work with a clear
finish line. Strip 📥 debug logs from two files, verify tests stay green,
commit two logical chunks. Sonnet because it needs to read each line and
distinguish debug logs from functional logging without breaking anything.

**`verify_contact_sync`** — pure verification. Haiku is enough: hit one
endpoint, grep for 4 IDs. The interesting work happens only on failure, which
is escalated rather than auto-resolved.

After both stages clear, the project sits at a clean v1.0 checkpoint. Future
work (v1.1 portable MCP prompts, REST wrapper for `createContact`, daemon-side
incoming-message hook) requires design discussion before being turned into
agent stages — see §"Future work needing design".

## Shared resources

- **`whatsapp_daemon`** — the dedicated `claude_whatsapp_integration` process
  on port 3142, with `auth_state/kit/`. Only one consumer at a time.
- **`port_3141`** — Kit gateway. Only one instance can listen.
- **`port_3142`** — WhatsApp daemon. Only one instance can listen.

Locking matters because two agents simultaneously running `npm run dev` would
collide on port 3141, and a sweep firing while another agent restarts the
daemon would skip with `whatsapp_disconnected`.

## Future work needing design (do NOT auto-dispatch)

These need a human conversation before becoming stages with concrete success
criteria:

- **MCP prompts migration (v1.1)** — port the 10 `.claude/commands/kit-*.md`
  files to MCP prompts in `gateway/src/mcp/server.ts` so Kit works in Claude
  Desktop. Open questions: keep both surfaces or drop the command files,
  prompt-vs-tool naming convention, distribution as npm package.
  TODO(mark): decide before queueing as a stage.

- **REST wrapper for `createContact`** — currently the MCP `create-contact`
  tool runs in the MCP server process, so the `/kit-add-contact` slash
  command falls back to writing markdown directly and lets SyncService
  upsert. A REST endpoint wrapper would let the slash command call straight
  through. Small but worth confirming the approach.
  TODO(mark): confirm desired behaviour.

- **Daemon-side incoming-message hook** — lives in the separate
  `claude_whatsapp_integration` repo. Until it lands, live capture relies on
  the 3-hourly sweep. Out of scope for an agent operating only inside this
  folder.

- **Phase 11 e2e coverage** — the e2e test in `gateway/src/e2e.test.ts` only
  covers Phases 3–9 pure-function layer. The ZIP import path has been
  validated in production but not in CI.
  TODO(mark): decide if this is worth building now or after the next
  Phase 11 bug.

## Conventions reminders for any agent working here

- Supabase queries on Kit tables MUST chain `.schema('kit')` — Kit tables
  live in the `kit` schema, never `public`.
- Open Brain writes go through `ContextBinder.capture()` — never insert into
  `thoughts` directly.
- `whatsapp_capture` defaults to `disabled` per contact. Silent storage of
  WhatsApp messages is a privacy bug, not a feature.
- `People/` is gitignored — never commit it.
- No Baileys anywhere in Kit. The gateway is a REST client of the dedicated
  daemon on port 3142.
- No mobile-app code, no push notifications, no message-sending tool —
  v1.0 scope is fixed (see [future-work.md](future-work.md)).
