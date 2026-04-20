---
description: Log an interaction with a contact after a conversation
---

Log an interaction with a contact.

Usage: `/kit-update <name>`

$ARGUMENTS

Call `kit-prep-card` first to show who the contact is (one-liner summary), then ask:
1. "What did you talk about? (brief notes)"
2. "Channel? (whatsapp/call/in-person/email — default: whatsapp)"
3. "Any follow-ups to track?"
4. "Date? (default: today)"

Then call `log-interaction` with the collected details.

After logging, confirm: "✅ Logged for [name]. Next action scheduled for [date]."

If the user types their notes directly after the command (e.g. `/kit-update Alice — Caught up over coffee`), parse the notes from the argument and skip asking.
