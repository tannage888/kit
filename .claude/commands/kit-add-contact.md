---
description: Create a new contact in Kit (markdown file + DB row + live registry registration)
---

Create a new contact in Kit.

Usage: `/kit-add-contact <name>`

$ARGUMENTS

Collect the details below by asking the user one at a time. If the user provides any field directly in their reply (e.g. "Samir Patel, tier 2, monthly"), parse what's there and only ask for what's missing.

**Required:**
1. Name (full name)
2. Tier (1 = Inner Circle, 2 = Active, 3 = Business Contact)
3. Frequency (Weekly / Fortnightly / Monthly / Quarterly / Twice Yearly / Annual)

**Optional but recommended:**
4. WhatsApp number in E.164 format (e.g. `+44 7956 289692`) — required if you want to use WhatsApp capture or ZIP imports for this contact
5. Email address — ask for this on every contact, and always for tier 3 business contacts. It goes in the `email` field, never in the notes.
6. Origin story (one or two sentences: how you know them, their role, context)
7. Social battery cost (Low / Medium / High — how much energy this contact typically takes)
8. WhatsApp capture (`enabled` / `disabled`) — only ask if a WhatsApp number was provided. Default to `disabled` per Kit's privacy posture; the user can answer "yes/enable" to opt in.
9. Notes (any extra context to seed)

Once you have the required fields (plus whatever optional ones the user provided), POST to the Kit gateway:

```
POST http://localhost:3141/api/contacts/create
Content-Type: application/json

{
  "name": "<name>",
  "tier": <1|2|3>,
  "frequency": "<frequency>",
  "whatsapp": "<E.164 if provided>",
  "email": "<email if provided>",
  "whatsapp_capture": "<enabled|disabled if provided>",
  "wa_capture": "on_demand",
  "origin_story": "<if provided>",
  "social_battery_cost": "<if provided>",
  "notes": "<if provided>"
}
```

Use the Bash tool: `curl -s -m 10 -X POST -H "Content-Type: application/json" -d '<json>' http://localhost:3141/api/contacts/create`

On success (`{"ok":true,...}`), confirm:
"✅ Created **[name]** (tier [N], [frequency]). Markdown written and contact immediately active in Kit."

If `whatsapp_capture: enabled` was set, add:
"WhatsApp capture is on — you can `/kit-captures` after sending yourself a chat export, or use `/kit-update` to log conversations manually."

On HTTP 409, tell the user the contact already exists.
On any other error, show the `detail` field from the response.
