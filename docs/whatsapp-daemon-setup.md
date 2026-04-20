# WhatsApp Daemon Setup

Kit's live WhatsApp capture uses a separate daemon process (`claude_whatsapp_integration`) that maintains the WA connection and forwards messages to the Kit gateway via HTTP.

## Architecture

```
WhatsApp ──► claude_whatsapp_integration (port 3142)
                        │
                        │  POST /message  (each incoming/outgoing message)
                        ▼
                Kit Gateway (port 3141)
                        │
                        ├── MessageRouter  (buffers by JID)
                        ├── CapturePipeline  (summarises + queues review)
                        └── /api/captures/pending  (review queue)
```

## Prerequisites

1. Node 20+ and the `claude_whatsapp_integration` package installed separately.
2. Kit gateway running: `cd gateway && npm run dev`
3. Environment variables set in `gateway/.env`:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
   - `OPEN_BRAIN_URL`, `OPEN_BRAIN_SERVICE_KEY`
   - `CAPTURE_INACTIVITY_MINUTES` (default: 30)
   - `PORT` (default: 3141)

## Starting the daemon

```bash
# Terminal 1 — Kit gateway
cd kit/gateway
npm run dev

# Terminal 2 — WhatsApp daemon
npx claude_whatsapp_integration --gateway http://localhost:3141
```

On first run the daemon will display a QR code — scan it with WhatsApp on your phone.

## Message routing behaviour

A message is captured only when **all** of these hold:

| Check | Pass | Drop |
|-------|------|------|
| Contact is in Kit | tracked | unknown → silent drop |
| `whatsapp_capture` | `enabled` | `disabled` → drop |
| `wa_capture` | `on_demand` or `auto` | `off` → drop |

For `auto` contacts: capture triggers automatically after `CAPTURE_INACTIVITY_MINUTES` of silence.
For `on_demand` contacts: messages are buffered until you call `/kit-captures confirm <id>`.

## Reviewing captures

In Claude Desktop or Claude Code:

```
/kit-captures              — show pending review queue
/kit-captures confirm <id> — save to Kit + Open Brain
/kit-captures dismiss <id> — discard
```

Or via MCP tools: `kit_pending_captures`, `kit_confirm_capture`, `kit_dismiss_capture`.

## Enabling capture for a contact

In the contact's `People/` markdown file, set:

```yaml
whatsapp_capture: enabled
wa_capture: on_demand   # or: auto
```

Or update directly in Supabase `kit.contacts`.
