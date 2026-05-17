---
description: Trigger a WhatsApp sweep for all contacts or a specific contact
---

Trigger a WhatsApp sweep via the Kit gateway.

Usage: `/kit-sweep [contact name]`

$ARGUMENTS

If a contact name was provided, sweep that contact only. Otherwise sweep all tracked contacts.

Run the sweep:

**All contacts:**
```
curl -s -m 120 -X POST -H "Content-Type: application/json" -d '{}' http://127.0.0.1:3141/api/sweep/run
```

**Specific contact (replace NAME):**
```
curl -s -m 120 -X POST -H "Content-Type: application/json" -d '{"contact_name": "NAME"}' http://127.0.0.1:3141/api/sweep/run
```

Use the Bash tool to run the curl command with a 120-second timeout — a full sweep of 30+ contacts takes ~60–90s. If the request times out (exit code 28), check `GET /api/sweep/status` to see the completed result.

After the sweep, also fetch gaps from the daemon:
```
curl -s http://127.0.0.1:3142/api/gaps
```

On success:

1. List every contact where `messagesFound > 0` (unseen activity), formatted as:
   - **Name** — N messages, M threads
   Sort by messagesFound descending. If none, say "No new activity found."

2. Summary line: `X contacts with activity / Y swept / Z skipped`

3. **Gap warning** — from the gaps response, filter to gaps where `resolvedAt` is null.
   - If any have `backfillSucceeded: false`: show a ⚠️ warning listing each gap as:
     `⚠️ Gap: <date/time range> — backfill failed (messages may be missing)`
     Format `fromTs`/`toTs` as human-readable local time. Include `chatJid` if set.
     Suggest running `/kit-sweep` again after WhatsApp reconnects, or importing a ZIP export to recover.
   - If all unresolved gaps have `backfillSucceeded: true`: show a single line:
     `ℹ️ N gap(s) detected and backfilled successfully.`
   - If no unresolved gaps: omit the section entirely.

4. If `pendingCaptures > 0`, suggest `/kit-captures`.

On error, show the full response so the user can debug.
