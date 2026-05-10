# Kit — Design

Slim record of the load-bearing architectural choices. Detail lives in
[kit_specification.md](kit_specification.md), [implementation-plan.md](implementation-plan.md),
and [consolidated-plan.md](consolidated-plan.md). This file exists so an agent
can grasp the shape of the system in 60 seconds.

## The shape

```
Claude Code
    │  slash commands (.claude/commands/kit-*.md)
    │  + MCP tools (gateway/src/mcp/server.ts)
    ▼
Kit gateway (Express, :3141)  ── REST ──►  WhatsApp daemon (:3142)
    │                                              │
    │                                              └── Baileys ──► WhatsApp
    ├──► Supabase (kit schema)
    ├──► Open Brain (via ContextBinder only)
    └──► People/*.md (chokidar file watcher + sync.ts)
```

## Load-bearing decisions

1. **Conversational-only interface.** No mobile UI in v1.0. All interaction is
   via Claude Code slash commands or MCP tools. Migration to portable MCP
   prompts (Claude Desktop) is documented as v1.1 in [future-work.md](future-work.md).

2. **No Baileys in Kit.** The Kit gateway is a REST client of the dedicated
   `claude_whatsapp_integration` daemon. The daemon owns auth state, the WA
   connection, and the message store. This decoupling is what lets Kit
   restart freely without losing the WA session. See [kit-migration.md](kit-migration.md)
   for the full before/after.

3. **Markdown is the source of truth for contacts.** `People/*.md` files,
   not Supabase rows, are the canonical record. The sync service round-trips
   in both directions with a 3-second loop-prevention guard. People/ is
   gitignored — personal data never leaves the local machine.

4. **Open Brain is write-via-binder-only.** All thought writes go through
   `ContextBinder.capture()`. Never `.from('thoughts')` directly. This keeps
   the entity-tagging contract stable and isolates Kit thoughts from other
   contexts in the shared Open Brain instance.

5. **Privacy by default for WhatsApp capture.** `whatsapp_capture: disabled`
   is the per-contact default. Messages for disabled contacts are dropped at
   the `MessageRouter` and never enter the capture pipeline. Silent storage
   is a bug, not a feature.

6. **Two capture commit paths, by design.**
   - **Live / ZIP import** → `CapturePipeline.process()` → queues for review
     in `/kit-captures`. Nothing written until user confirms.
   - **Scheduled sweep** → `CapturePipeline.processAndCommit()` → writes
     directly to interaction_log + Open Brain + markdown. The user opted into
     the schedule; that's the consent.

7. **No server-side Anthropic calls in `/kit-draft` or `/kit-reconnect`.**
   These tools return structured *context*. Claude composes the message
   in-chat. Keeps the user in the loop and avoids per-call API costs.

8. **Kit schema, not public.** Every Supabase JS query must chain
   `.schema('kit')` before `.from()`. Kit tables: contacts, interaction_log,
   follow_ups, kit_meta, wa_sweep_state, energy_state.

## Capture pipeline trace

The trickiest path in the system. Both live messages and ZIP imports flow
through the same `MessageRouter → CapturePipeline` core, but enter and exit
differently.

```
Live message:
  daemon → POST /api/incoming-message → MessageRouter.handleMessage
    → buffer per-JID → inactivity timer (30 min default)
    → CapturePipeline.process → review queue → /kit-captures confirm
    → commit (interaction_log + ContextBinder + markdown + last_contact)

ZIP import (Phase 11):
  daemon detects self-sent ZIP → POST /api/zip-import-complete
    → ImportIngestor.ingest → fetches full transcript from daemon
    → routes each msg through MessageRouter.handleMessage
    → MessageRouter.triggerCapture(contactId, {source: "zip-import"})
    → bypasses inactivity timer (transcript is complete by definition)
    → CapturePipeline.process → review queue → /kit-captures confirm
    → commit (same as live)

Sweep:
  cron (every 3h) → SweepScheduler.runSweep → for each enabled contact
    → HistoryFetcher.fetchSince(jid, watermark) → daemon REST
    → CapturePipeline.processAndCommit → writes directly (no queue)
    → wa_sweep_state watermark advanced
```

## Where the bodies are buried

- **Watermark drift between sweep and live.** `wa_sweep_state.last_message_ts`
  is per-contact. If sweep ran at T1 and a message arrived at T0 < T1 (e.g.
  daemon was lagging), the live `/api/incoming-message` push will still be
  captured because the router doesn't consult the sweep watermark — they're
  independent paths.

- **`processAndCommit` vs `process` confusion.** A user running `/kit-sweep`
  manually expects captures to appear in `/kit-captures`. They don't. Sweep
  writes directly. This is by design (decision 6) but trips people up.

- **Markdown→Supabase loop guard is 3 seconds.** Edit a People/*.md file,
  watcher fires, upsert happens, Supabase realtime fires back, sync service
  ignores the echo for 3s. Edit it again within 3s and you may lose the
  second edit. Hasn't bitten anyone yet.

- **`createContact` in MCP runs in MCP server process, not the REST gateway.**
  `/kit-add-contact` therefore writes markdown directly and trusts the
  watcher to upsert. A REST wrapper is on the future-work list.

## What is explicitly NOT here

See [future-work.md](future-work.md) for the full list. The big ones:

- Mobile app (v2.0 — Expo code preserved in `old/expo-app/`)
- Push notifications (everything surfaces via `/kit-checkin`)
- Message *sending* via Kit (v1.0 is user-initiated in WhatsApp directly)
- MCP server for Claude Desktop (v1.1 — currently Claude Code only)
- Sharing the daemon with other WhatsApp products
