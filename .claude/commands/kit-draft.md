---
description: Draft a personalised message using stored context about the contact
---

Draft a message to a contact using their stored context.

Usage: `/kit-draft <name> [intent]`

$ARGUMENTS

Parse $ARGUMENTS: the first word/phrase before a comma or dash is the contact name,
anything after is the intent. If no intent given, proceed with just the contact name.

Call `kit_draft_context` with:
- contact_name: the contact name
- intent: the intent (if provided)

After receiving the context, compose a personalised draft message that:
1. References specific details from their background and interests
2. Acknowledges the time since last contact naturally
3. Incorporates any open follow-ups if relevant
4. Avoids any sensitive topics listed
5. Feels warm and personal, not formulaic

Present the draft and offer to revise. Ask the user to confirm before treating it as final.
