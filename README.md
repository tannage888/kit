# Kit — Personal Relationship Management

Kit is a conversational relationship management tool for neurodivergent users. All interaction happens through Claude Code slash commands and Claude Desktop — no app required.

It surfaces who you should reach out to today, gives you context before a conversation, helps you draft messages, and logs interactions to Open Brain.

## Architecture

```
Claude Code / Claude Desktop
    │  slash commands + MCP tools
    ▼
Kit gateway (port 3141)  ── REST ──►  WhatsApp daemon (port 3142)
  │                                          │
  ├── Supabase (kit schema)                  └── Baileys ──► WhatsApp
  ├── Open Brain (via ContextBinder)
  └── People/*.md (file watcher + sync)
```

## Prerequisites

- Node.js 20+
- `cd gateway && cp .env.example .env` and fill in credentials (Supabase, Open Brain, Anthropic)
- Supabase project with the `kit` schema (run migrations in `gateway/supabase/migrations/`)

## Starting Kit

**Terminal 1 — Gateway**

```bash
cd kit/gateway
npm run dev
```

The gateway starts on `http://localhost:3141`. It loads your contacts from Supabase, starts the markdown↔Supabase sync service, and begins the sweep scheduler.

**Terminal 2 — MCP server** (for Claude Desktop)

```bash
cd kit/gateway
npm run mcp
```

Or add it to `claude_desktop_config.json` so Claude Desktop spawns it automatically:

```json
{
  "mcpServers": {
    "kit": {
      "command": "npx",
      "args": ["tsx", "<path>/kit/gateway/src/mcp/server.ts"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_SERVICE_KEY": "...",
        "OPEN_BRAIN_URL": "...",
        "OPEN_BRAIN_SERVICE_KEY": "...",
        "ANTHROPIC_API_KEY": "..."
      }
    }
  }
}
```

## Using Kit

Set your energy level first, then run the daily check-in:

```
/kit-energy high          set today's social energy (high / medium / low)
/kit-checkin              who to reach out to today, sorted by drift + tier
/kit-prep Alice           pre-flight brief before a conversation
/kit-draft Alice          context for drafting a message
/kit-reconnect Bob        reconnect brief for a dormant contact
/kit-captures             review pending WhatsApp capture queue
```

Log interactions and manage follow-ups:

```
/kit-update               log a conversation (prompts for contact + notes)
/kit-followup             add or complete a follow-up item
```

## WhatsApp capture (optional)

Kit can buffer live WhatsApp messages for tracked contacts and queue them for your review before anything is stored. This requires the `claude_whatsapp_integration` daemon running on port 3142.

See [docs/whatsapp-daemon-setup.md](docs/whatsapp-daemon-setup.md) for full setup instructions.

The gateway works without the daemon — sweep (`sweep_now`) and all manual tools still work.

## Gateway commands

```bash
cd gateway
npm run dev            # start with hot-reload
npm start              # start (production)
npm run mcp            # start MCP server for Claude Desktop
npm test               # run Vitest tests (194 tests)
npm run test:watch     # watch mode
npm run build          # TypeScript compile
npm run lint           # ESLint
```

## MCP tools reference

| Tool | What it does |
|---|---|
| `kit_set_energy` | Set today's social energy level |
| `kit_get_energy` | Check today's energy level |
| `kit_daily_checkin` | Run the daily relationship check-in |
| `kit_prep_card` | Pre-flight brief for a contact |
| `kit_draft_context` | Context for drafting a message |
| `kit_reconnect_context` | Reconnect brief for a dormant contact |
| `kit_pending_captures` | List WhatsApp captures awaiting review |
| `kit_confirm_capture` | Save a capture to Kit + Open Brain |
| `kit_dismiss_capture` | Discard a capture |
| `get_queue` | Overdue + due-this-week contacts |
| `get_contact` | Full detail for a contact |
| `search_contacts` | Search contacts by name |
| `log_interaction` | Log a conversation |
| `add_follow_up` | Add a follow-up item |
| `complete_follow_up` | Mark a follow-up done |
| `create_contact` | Create a new contact |
| `sweep_now` | Trigger a WhatsApp history sweep |

## Project structure

```
gateway/
  src/
    index.ts                   Express server entry point (port 3141)
    config.ts                  Environment variable schema
    mcp/
      server.ts                MCP server (stdio transport)
      tools.ts                 MCP tool implementations
    services/
      contacts.ts              Contact registry (loads from Supabase)
      energy.ts                Energy state service
      checkin.ts               Daily check-in pure functions
      prep.ts                  Prep card + draft context pure functions
      reconnect.ts             Reconnect context pure functions
      relationship-status.ts   Drift, safety, and occasion calculations
      message-router.ts        WhatsApp message buffering + capture routing
      capture.ts               Capture pipeline (summarise + review queue)
      sweep-scheduler.ts       Scheduled WhatsApp history sweeps
      history-fetcher.ts       REST client for WhatsApp daemon
      sync.ts                  Markdown↔Supabase bidirectional sync
    routes/api.ts              REST API routes
    utils/markdown.ts          People/*.md parser
    context-binding/           Open Brain integration (ContextBinder)
    types.ts                   Shared TypeScript types
  supabase/migrations/         SQL migrations for the kit schema
  src/e2e.test.ts              End-to-end smoke tests

.claude/commands/              Claude Code slash commands
  kit-energy.md
  kit-checkin.md
  kit-prep.md
  kit-draft.md
  kit-reconnect.md
  kit-captures.md
  kit-update.md
  kit-followup.md

People/                        Contact markdown files (gitignored)
People.template/               Contact file schema/template
docs/
  kit_specification.md         Full v1.0 spec
  implementation-plan.md       Phase-by-phase build plan
  whatsapp-daemon-setup.md     WhatsApp daemon setup guide
  manual-test-plan.md          Manual QA checklist

old/                           v0 Expo app (kept for v2.0 reference)
```

## People/*.md format

Contacts live as markdown files in `People/`. They're the source of truth — edits sync to Supabase automatically. See `People.template/` for the full schema.

Key frontmatter fields:

```yaml
name: Alice Smith
tier: 1                      # 1 Inner Circle / 2 Active / 3 Business
frequency: Monthly
whatsapp: "+447700900001"
whatsapp_capture: enabled    # enabled | disabled (default: disabled)
wa_capture: on_demand        # on_demand | auto | off
birthday: 1990-04-21
preferred_channel: whatsapp
```
