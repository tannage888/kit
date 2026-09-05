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

## Session credentials and re-pairing

The daemon keeps its WhatsApp session in `auth_state/kit/` — `creds.json` plus several hundred Signal-protocol pre-keys and sender keys. **Treat that folder as a credential.** It cannot be rotated: anyone holding a copy can act as the linked account until the device is unlinked from the phone.

The live session is the only copy that should exist anywhere:

```
C:\dev\claude_whatsapp_integration\auth_state\kit\
```

### After a re-pair

Re-pairing writes a fresh session but **does not remove the old one**. Past re-pairs left complete, usable sessions behind in `auth_state\kit.bak-<date>\`, `auth_backups\kit-<timestamp>\` and `C:\dev\_backups\kit-wa-auth-<date>\`.

1. **Unlink the old device** — WhatsApp › Settings › Linked devices. Identify it by *last-active date*, not by name: Baileys registers as a browser, so every Kit device looks alike. If only one device is listed, that is the live one — leave it. WhatsApp also auto-unlinks devices idle beyond ~14 days, so an old one may already have dropped off.
2. **Delete the displaced folder** rather than renaming it to `.bak`.
3. **Audit** with the command below.

### Backups exclude it by name

`C:\dev\backup.ps1` mirrors all of `C:\dev` into OneDrive using robocopy `/MIR`. It denies by *directory and file name*, so a session sitting in a folder whose name is not on the list gets uploaded. Excluding `auth_state` alone is not enough — the folders a re-pair displaces it into need listing too.

Currently excluded: directories `auth_state`, `auth_backups`, `_backups`; file `creds.json`.

Edit `C:\dev\backup.ps1`. The copy at `%USERPROFILE%\OneDrive\DevBackup\backup.ps1` is a mirror that robocopy overwrites on every run, so edits there are silently lost.

Two things that catch people out:

- Excluded directories are **skipped, not purged**. `/MIR` will never clean up a copy already sitting in OneDrive — those have to go by hand.
- Deleting inside OneDrive only moves the files to the online recycle bin, where they stay restorable for 30 days. Empty it at onedrive.live.com to finish the job.

### Auditing for stray sessions

```bash
# Should return exactly one path: the live session.
find /c/dev "$USERPROFILE/OneDrive" -maxdepth 8 -name creds.json -not -path '*/node_modules/*'
```

To verify the backup exclusions actually hold, run robocopy in list-only mode and grep the copy list — reading the script is not proof:

```bash
MSYS2_ARG_CONV_EXCL='*' MSYS_NO_PATHCONV=1 \
  robocopy "C:\dev\claude_whatsapp_integration" "<scratch>" /MIR /L /NP /NDL \
  /XD node_modules .git auth_state auth_backups _backups /XF creds.json
```

Without those two environment variables Git Bash rewrites `/MIR` and friends into paths; robocopy then exits 16 with a usage dump that can be mistaken for a clean result.

> **2026-09-05 audit.** Six full sessions were found outside the live folder — roughly 5,000 files and 77 MB across `C:\dev` and OneDrive, four of them mirrored to the cloud by the backup script. All removed, the stale device unlinked, and the exclusions above added. Nothing had reached GitHub: `auth_state/` is gitignored in the daemon repo and appears in no commit.
>
> Still open: `data\kit\wa_store.json` (~10 MB of message history, no credentials) is mirrored to OneDrive on every backup run. Not an impersonation risk, so it was left as a separate decision.

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
