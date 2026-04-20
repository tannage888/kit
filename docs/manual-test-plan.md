# Kit v1.0 Manual Test Plan

Pre-release smoke test checklist. Run against a live environment with the Kit gateway running and Claude Desktop connected.

## Setup

- [ ] `cd kit/gateway && npm run dev` — gateway starts on port 3141
- [ ] `npm run mcp` — MCP server starts (or add to `claude_desktop_config.json`)
- [ ] Energy not yet set for today (fresh state)

---

## 1. Energy (`/kit-energy`)

- [ ] `/kit-energy high` → "Energy set to **high** for today"
- [ ] `/kit-energy medium` → "Energy set to **medium** for today"
- [ ] `/kit-energy low` → "Energy set to **low** for today"
- [ ] `/kit-energy invalid` → error message, not a crash
- [ ] `kit-get-energy` (via MCP) → returns today's level

---

## 2. Daily check-in (`/kit-checkin`)

- [ ] With energy set to high: shows all overdue contacts, sorted by drift severity
- [ ] With energy set to medium: caps at ~7, prefers Low battery contacts
- [ ] With energy set to low: caps at 3, Low battery only
- [ ] Open follow-ups appear at the bottom of the report
- [ ] Birthday occasions appear when within ±2 days (if any contacts have birthdays set)
- [ ] No energy set → helpful "set energy first" message

---

## 3. Prep card (`/kit-prep`)

- [ ] `/kit-prep Alice` → returns full prep card (tier, background, interests, follow-ups, recent interactions)
- [ ] `/kit-prep unknown-person` → "not found" message, not a crash
- [ ] Sensitive topics section appears only when set on the contact
- [ ] Open Brain context section present when thoughts exist

---

## 4. Draft context (`/kit-draft`)

- [ ] `/kit-draft Alice` → returns draft context with origin story, interests, last 3 interactions
- [ ] `/kit-draft Alice catch up on her new job` → intent is reflected or used to tailor Claude's draft
- [ ] Capped at 3 interactions (not the full log)
- [ ] `time_since_last_contact` field is human-readable (e.g. "3 weeks ago")

---

## 5. Reconnect (`/kit-reconnect`)

- [ ] `/kit-reconnect Bob` (contact with black drift) → returns reconnect brief with opener style
- [ ] Gap description is human (e.g. "3 months") not raw days
- [ ] Reassurance copy present
- [ ] Opener style matches tier (Inner Circle = direct/warm; Active = reference-specific; Business = professional)

---

## 6. Log interaction (`log-interaction` MCP tool)

- [ ] Log a whatsapp interaction for a known contact → "Logged successfully"
- [ ] `last_contact` field updated in Supabase + markdown file
- [ ] `next_action` updated correctly based on frequency
- [ ] Open Brain thought captured (INTERACTION type)
- [ ] Follow-ups added when provided in the `follow_ups` array

---

## 7. Create contact (`create-contact` MCP tool)

- [ ] Creates `People/<tier>/<Name>.md` with correct frontmatter
- [ ] Row inserted in `kit.contacts`
- [ ] Open Brain observation captured

---

## 8. WhatsApp capture review (`/kit-captures`)

Requires Kit gateway and WhatsApp daemon running.

- [ ] `/kit-captures` with no pending reviews → "No captures pending review"
- [ ] After a conversation thread times out (or sweep runs): pending review appears
- [ ] `/kit-captures confirm <id>` → "Capture confirmed", interaction written to Kit
- [ ] `/kit-captures dismiss <id>` → "Capture dismissed", nothing stored
- [ ] Confirming a capture that doesn't exist → "No pending capture found"

---

## 9. Sweep (`sweep-now` MCP tool)

- [ ] `sweep-now` with gateway running → returns sweep summary
- [ ] `sweep-now` with contact_name → sweeps only that contact
- [ ] `sweep-now` with gateway not running → friendly error (not a crash)
- [ ] After sweep: `last_contact` updated for contacts with new messages

---

## Pass criteria

All checkboxes ticked with no unexpected errors or crashes. Data in Supabase and People/*.md files stays in sync throughout.
