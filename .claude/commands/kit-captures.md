---
description: Review pending WhatsApp captures
---

List and action WhatsApp conversations queued for review.

Usage:
- `/kit-captures` — show all pending captures
- `/kit-captures confirm <contact-id>` — save the capture to Kit
- `/kit-captures dismiss <contact-id>` — discard without saving

$ARGUMENTS

If no arguments are given, call `kit_pending_captures` and present the results.

If the argument starts with "confirm ", extract the contact ID and call `kit_confirm_capture` with it.

If the argument starts with "dismiss ", extract the contact ID and call `kit_dismiss_capture` with it.

Present the outcome clearly, noting what was saved or discarded.
