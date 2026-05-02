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

Or via MCP tools: `kit-pending-captures`, `kit-confirm-capture`, `kit-dismiss-capture`.

## Enabling capture for a contact

In the contact's `People/` markdown file, set:

```yaml
whatsapp_capture: enabled
wa_capture: on_demand   # or: auto
```

Or update directly in Supabase `kit.contacts`.

## ZIP transcript ingestion (Phase 11)

You can WhatsApp yourself a "Export Chat" ZIP and have Kit ingest it into the same review pipeline as live capture. The daemon detects the self-sent ZIP, parses the `.txt` transcript, and pings Kit; Kit then pulls the new messages back from the daemon and queues a `/kit-captures` review card prefixed with "Imported WhatsApp transcript with …".

Two endpoints on Kit support this:

- `POST /api/contacts/resolve-name` — daemon's `NameResolver` calls this to map a contact name extracted from the export filename (e.g. "Alice Smith" from `WhatsApp Chat with Alice Smith.zip`) to a JID.
- `POST /api/zip-import-complete` — daemon calls this once the ZIP has been imported into its `MessageStore`. Body: `{ chatJid: string, imported?: number, duplicates?: number, textFile?: string }`.

### Daemon-side wiring

Two changes are needed in `claude_whatsapp_integration/src/index.ts` for this to fire end-to-end:

1. **Replace the "fetch all contacts and scan" name resolver** with a single targeted POST. In `index.ts` the `kitNameResolver` should call:

   ```ts
   const res = await fetch(`${config.KIT_GATEWAY_URL}/api/contacts/resolve-name`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ name }),
   });
   if (!res.ok) return null;
   const { jid } = await res.json() as { jid: string | null };
   return jid;
   ```

2. **Replace the `onImport` logger** with a webhook POST so Kit can pick the import up:

   ```ts
   onImport: async (r) => {
     console.log(`📦 ZIP auto-import: imported=${r.imported} file="${r.textFile}"`);
     if (!r.inferredChatJid) return;
     await fetch(`${config.KIT_GATEWAY_URL}/api/zip-import-complete`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({
         chatJid: r.inferredChatJid,
         imported: r.imported,
         duplicates: r.duplicates,
         textFile: r.textFile,
       }),
     }).catch((e) => console.warn(`⚠️ Kit ingest webhook failed: ${e.message}`));
   },
   ```

   Mirror the same webhook into `POST /api/import/zip-export` (manual upload route in `src/routes/api.ts`) and the `wa import-zip` CLI path so manual imports also flow into Kit.

3. **Set `KIT_GATEWAY_URL`** in the daemon environment (default `http://127.0.0.1:3141` already matches Kit's default port).

### Disabling

- Daemon side: `DISABLE_AUTO_ZIP_IMPORT=true` suppresses the auto-detector entirely.
- Kit side: contacts with `whatsapp_capture: disabled` cause Kit to silently no-op the ingest (the webhook returns `{ ok: true, status: "skipped", reason: "capture_disabled" }`).
