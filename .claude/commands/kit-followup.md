---
description: View, add, or complete follow-ups for a contact
---

Manage follow-ups for a contact.

Usage:
- `/kit-followup <name>` — show open follow-ups
- `/kit-followup <name> add <text>` — add a follow-up
- `/kit-followup <name> done <text>` — mark a follow-up complete

$ARGUMENTS

Parse the arguments:
- If just a name: call `get_contact` to show open follow-ups for that contact
- If "add": call `add_follow_up` with contact_name and text
- If "done": call `complete_follow_up` with contact_name and follow_up_text

Confirm each action clearly.
