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

On success, report:
- How many contacts were swept
- How many new captures are pending (if any)
- Suggest `/kit-captures` if `pendingCaptures > 0`

On error, show the full response so the user can debug.
