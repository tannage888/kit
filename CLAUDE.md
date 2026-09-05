# CLAUDE.md

Guidance for Claude Code working in this repository.

## What Kit is (v1.0)

Kit is a **conversational-only** relationship-management tool for neurodivergent users. All interaction happens through **Claude Code slash commands** (`/kit-checkin`, `/kit-prep`, …) that call the Kit gateway. No mobile app. Migrating to portable MCP prompts is a documented v1.1 follow-up — see [docs/future-work.md](docs/future-work.md).

Full spec: [docs/kit_specification.md](docs/kit_specification.md). Implementation plan: [docs/implementation-plan.md](docs/implementation-plan.md).

## Architecture

```
Claude Code
    │  slash commands (.claude/commands/kit-*.md)
    ▼
Kit gateway  ── REST ──►  claude_whatsapp_integration (dedicated instance, :3142)
  │                              │
  │                              └── Baileys ──► WhatsApp
  ├─► Supabase (kit schema)       (Kit never touches Baileys directly)
  ├─► Open Brain (public.thoughts, via ContextBinder)
  └─► People/*.md (file watcher)

  Both Supabase arrows currently resolve to the SAME project
  (popxesemindihcbedegy). The schema is what separates them.
```

- **Kit gateway** (`gateway/`) — Express server on `:3141`. Serves the React web UI from `web/dist/` at `/`, and the REST API at `/api`. REST client of the external WhatsApp daemon. Owns: contact registry, capture pipeline, markdown↔Supabase sync, sweep scheduler.
- **Dedicated WhatsApp daemon** — a separate `claude_whatsapp_integration` instance at `C:\dev\claude_whatsapp_integration` (port `:3142`, `auth_state/kit/`). Runs alongside the gateway under pm2.
- **Supabase** — `kit` schema holds `contacts`, `follow_ups`, `interaction_log`, `kit_meta`, `wa_sweep_state`, `energy_state`.
- **Open Brain** — logically separate, but **currently the same Supabase project as Kit**: `gateway/.env` sets both `SUPABASE_URL` and `OPEN_BRAIN_URL` to `popxesemindihcbedegy`. Kit lives in the `kit` schema, Open Brain in `public.thoughts` / `public.vault_manifest`. Kit writes to `thoughts` via `ContextBinder.capture()` only. Never `.from('thoughts')` directly. See [docs/kit_specification.md](docs/kit_specification.md) §5.8 — the two are meant to be separable, so keep the URLs as distinct config even while they point at one project.
  - **Destructive work must be scoped to a schema or an explicit table list, never to the project.** That one project also holds `health_monitor`, `triage` and plant care (`public.pc_*`). Rotating its service-role key breaks Kit until `gateway/.env` is updated.
- **People/*.md** — source of truth for contact records. Gitignored (personal data). See `People.template/` for the schema.

## Web UI (`web/`)

Vite + React + TypeScript SPA. Built output (`web/dist/`) is served by the gateway at `http://localhost:3141`.

```bash
cd web
npm run dev      # Vite dev server on :3143 (proxies /api to :3141)
npm run build    # Build to web/dist/ — must run before deploying/restarting gateway
```

The `kit-web` pm2 entry has been removed — the gateway serves the built assets directly. Always run `npm run build` in `web/` before restarting the gateway in production.

## Commands (gateway)

```bash
cd gateway
npm run dev            # tsx watch src/index.ts
npm test               # vitest
npm run test:watch
npm run build          # tsc
npm run lint           # eslint
```

Run a single gateway test:
```bash
cd gateway && npx vitest run src/services/contacts.test.ts
```

## Supabase conventions

- **Schema scope:** all Kit tables are in the `kit` schema, not `public`. Every Supabase JS query must chain `.schema('kit')` before `.from()`:

```ts
supabase.schema('kit').from('contacts')
```

- **Open Brain:** writes go via `ContextBinder.capture()` in `gateway/src/context-binding/`. Never insert into `thoughts` directly.

## Markdown ↔ Supabase sync

`gateway/src/services/sync.ts` keeps both sides live via chokidar (MD changes) + Supabase Realtime (DB changes). 3-second loop-prevention guard per contact on each direction. `SyncService` connects to `SUPABASE_URL`, never `OPEN_BRAIN_URL` — a code convention that survives the two currently resolving to the same project, and the thing that keeps them separable later.

## WhatsApp capture

Kit's gateway exposes `POST /api/incoming-message`. The external daemon POSTs each message for a tracked contact to that endpoint. `MessageRouter` drops messages for contacts with `whatsapp_capture: disabled` (privacy-by-default). After an inactivity gap, threads are summarised via Claude and presented via `/kit-captures` for user confirmation before anything is written to Open Brain. **No silent storage — ever.**

## Running ralph-loop

Implementation is driven by the ralph-loop plugin. See [docs/ralph-prompt.md](docs/ralph-prompt.md). Completion promise: `KIT_V1_COMPLETE`. Each iteration reads/updates `RESUME_NOTES.md`. Never emit the completion promise until all 10 phases have green tests.

## What lives in `old/`

- `old/expo-app/` — the v0 Expo/React Native app, kept as a starting point for a possible v2.0 mobile app
- `old/*.csv`, `old/*.md` — historical People Hub data and planning docs, not used at runtime
