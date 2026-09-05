# KIT (Keep In Touch) — Relationship Management App Specification
---

## 1. Purpose and Context

Kit is a personal relationship management app designed for neurodivergent users — specifically people with autism and/or ADHD — who struggle not with organising contacts but with knowing when and how to reach out, managing social energy, and maintaining context across conversations.

### 1.1 The Core Insight

Most CRM and networking tools are built around the assumption that the hard part is *organising* contacts. For neurodivergent networkers, organisation is rarely the problem. The existing data schema already captures the right fields (Social Battery Cost, Sensitive Topics, Origin Story, Special Interests) — the app needs to make *active use* of them rather than storing them passively.

### 1.2 Six Pain Points Addressed

1. **Knowing what to say** (and whether it's appropriate to say it)
2. **Initiating contact** when there's no obvious reason — a key ADHD task-initiation barrier
3. **Remembering context** without being able to rely on social intuition — context simply isn't in working memory for ADHD users; autistic users can't rely on social intuition
4. **Managing energy** — social interaction has a real cost; booking three high-battery-cost contacts in one day leads to burnout and avoidance of the whole system
5. **Time blindness** — ADHD "object permanence for people": contacts genuinely disappear from awareness unless something prompts them; 3 months can pass and feel like 3 weeks
6. **Rejection anxiety** — Rejection Sensitive Dysphoria (common in ADHD) and autistic anxiety about social rules create a specific trap: the longer the gap, the more anxiety about reaching out, the longer the gap grows

*Kit is emphatically not a "networking" tool. It is framed as tending to relationships — the language of gardening, not transacting.*

---

## 2. Scope

### 2.1 Interface philosophy — conversation first

Kit is a **conversational-first** application. The primary interface is natural language via Claude. In v1.0, Kit exposes its commands as **Claude Code slash commands** (`.claude/commands/*.md`) that call the Kit gateway. Migrating these to portable MCP prompts so Kit works in Claude Desktop is a documented follow-up (see [future-work.md](future-work.md)). There is no mobile app UI in v1.0 — all interaction happens through conversation.

This is a deliberate design choice, not a deferral:
- Neurodivergent users benefit from **unstructured input** — saying "I just spoke to Graham about cricket, his mum is better" is faster and lower-friction than filling out a form
- The conversational interface naturally handles **ambiguity and intent** — the user says what they want, Claude figures out which tools to call
- Message scaffolding (FR-03) is inherently conversational — the user describes their intent, Claude drafts the message
- No app to open, no UI to learn, no screens to navigate — Kit lives where the user already is

### 2.2 In Scope — v1.0 (Conversational Interface)

- Contact database with tiered relationship model (Inner Circle, Active, Business) — Supabase backend
- Kit gateway exposing all Kit operations via Claude Code slash commands (`/kit-*`)
- Daily contact queue via conversation ("who should I reach out to?")
- AI-generated message scaffolding with user-directed intent (FR-03)
- Post-interaction debrief via conversation ("I just spoke to Graham about...")
- Conversation prep via conversation ("prep me for a call with Sophie")
- Relationship drift detection and surfacing ("who have I lost touch with?")
- Follow-up tracker ("what did I promise to do for Graham?")
- Open Brain integration via context binding protocol for persistent memory
- Contact data stored in markdown files, in a human readable format with summaries of interaction; context stored in Open Brain via context binding
- interaction is via claude chat

---

## 3. Data Model

The data model is derived from the People folder, in markdown files.

### 3.1 Contact Record

The markdown files need to store this information

| Field | Type | Required | Notes |
|---|---|---|---|
| name | string | Yes | Full display name |
| relationship_tier | enum | Yes | 1-Inner Circle, 2-Active, 3-Business Contact |
| frequency | enum | Yes | Weekly, Monthly, Quarterly |
| last_contact | date | Yes | Date of most recent interaction |
| next_action | date | Yes | Computed or manually set target contact date |
| social_battery_cost | enum | Yes | Low, Medium, High — mandatory on creation |
| origin_story | text | Recommended | How you met |
| special_interests | text | Recommended | Topics they enjoy — used for message generation |
| sensitive_topics | text | Recommended | Topics to avoid — prevents social missteps |
| preferred_channel | enum | Recommended | WhatsApp, Email, LinkedIn, Phone, In-Person |
| whatsapp_number | string | If channel=WhatsApp | E.164 format |
| email | string | Recommended | Their current best address. One per contact — a corporate address that expires is overwritten, not appended to. Never stored in `notes`. |
| whatsapp_capture | enum | Yes | `enabled` or `disabled` — controls whether Kit's WhatsApp listener reads messages for this contact. Default `disabled` (opt-in per contact). |
| birthday | date | Optional | Used for Occasion Awareness |
| notes | text | Optional | Free-form additional context |
| url | string | Optional | LinkedIn or Google Contacts link |

**Data quality note:** The following fields are currently underused but are the most valuable for a neurodivergent-first tool. They should become prominent on the contact creation screen:

| Field | Historical Usage | Priority |
|---|---|---|
| Social Battery Cost | 40% | **Mandatory** — core to energy budgeting |
| Special Interests | 5% | **High** — fuel for Message Scaffolding |
| Sensitive Topics | 2% | **High** — prevents social missteps |
| Origin Story | 25% | **High** — grounds message tone |
| Interaction Log | 0% | **Critical** — enables most other features |

The app should prompt for these during onboarding with simple questions rather than blank form fields: *"How did you meet [Name]?"* feels easier than a labelled text box.

### 3.2 Interaction Log (stored in Open Brain)

Each interaction is captured as an Open Brain memory tagged to the contact. 

A summary of the interaction is written to the markdown file.


| Field | Type | Notes |
|---|---|---|
| contact_name | string | Person tag for Open Brain retrieval |
| date | date | Date of interaction |
| topics | text | What was discussed — free text or tags |
| follow_ups | text | Things to action or ask next time |
| sentiment | enum | Positive / Neutral / Draining — optional |
| channel | enum | How the interaction happened (WhatsApp, call, in-person, etc.) |

### 3.3 Contact Tiers

| Tier | Label | Typical Frequency | Description |
|---|---|---|---|
| 1 | Inner Circle | Weekly – Monthly | Close personal relationships; proactive drift alerts enabled |
| 2 | Active | Monthly – Quarterly | Ongoing relationships requiring regular maintenance |
| 3 | Business Contact | Quarterly+ | Professional contacts; lower frequency, context still tracked |

---

## 4. Functional Requirements

these reports should be triggerable by slash commands in claude
e.g. /kit-xxxx

### FR-00 - Set energy level /kit-energy H/M/L
This slash command allows the user to set the energy level to high, medium or low.

**Problem it solves:** Autistic people experience genuine depletion from social interaction. ADHD users have highly variable energy and need the app to flex with them. Booking three high-battery-cost contacts in one day leads to burnout and avoidance of the whole system.

A daily check-in adjusts which contacts are surfaced based on the user's current social capacity.

- Check-in prompt on app open: "How are you feeling today?" with three modes
- **Green (Full capacity):** show High, Medium, and Low battery contacts
- **Yellow (Medium day):** show Low battery contacts only
- **Red (Low day):** suggest a simple text or emoji to one Inner Circle contact; no pressure for more
- On a Red day the app says: "Even a quick 'thinking of you' to [Name] counts as contact"
- Check-in state persists for the day and resets at midnight
- social_battery_cost is mandatory on contact creation


### FR-01 — Daily checkin /kit-checkin

**Problem it solves:** For ADHD, seeing 33 people who need attention causes shutdown. For autism, "who should I contact?" without a rule feels arbitrary and stressful.

- This report displays depending on eneergy level:
    - High: display all the interactions overdue, due today and those due in the next 7 days.
    - Medium: display up to 7 interactions overdue or due today, prioritised by energy level.  One must be high and the rest medium or low
    - Low:  display up to 3 interactions overdue or due today, maximum medium preferably low
- Contacts are ranked by: overdue severity, then energy match, then relationship tier
- Framing must be positive — "Here's who to check in with today" not "6 people overdue"
- Each card shows: name, tier, last contact date, drift status

**Existing data used:** `next_action`, `frequency`, `social_battery_cost`


### FR-02 — Conversation Prep Card /kit-prep [contact]

**Problem it solves:** Walking into a call or meeting without being able to recall key context causes anxiety and social missteps for autistic people. ADHD makes this worse — the context simply isn't in working memory. This turns a social interaction from *unknown territory* into a *structured task*.

Before initiating contact, the user can open a one-screen pre-flight brief for the contact. This retrieves stored context from Open Brain and the contact record.

- How you met (Origin Story)
- Last interaction: date and topics discussed (from Open Brain)
- Good topics (Special Interests)
- Topics to avoid (Sensitive Topics)
- 2-3 auto-generated suggested questions based on profile and interaction history
- Open follow-up items from the last interaction

**Existing data used:** All contact fields, plus interaction log

### FR-03 — Message Scaffolding ("What Do I Say?") /kit-draft [contact]

**Problem it solves:** This is the single biggest barrier for autistic networkers. Knowing *that* you should message someone is easy. Knowing *how* to start — especially after a gap — is genuinely hard. This is also a key ADHD task-initiation barrier. The goal is to get from *paralysed* to *draft in hand* in one tap.

The AI assists the user's intent — it does not decide the purpose of the message. The user always provides direction; the AI handles the phrasing, tone, and context-weaving.

**User intent input (required):** Before generating a message, the user provides a brief instruction describing what they want to say. This can be:
- A quick preset: "Check in", "Say happy birthday", "Follow up"
- A free-text prompt: "I want to tell them I appreciate them but don't know how", "Ask about the job interview they mentioned", "Apologise for not being in touch"
- user must be able to talk to claude about how the message will land and ask claude to redraft

**How the AI uses the intent:** The user's direction is the primary input. The AI then layers in stored context to make the message feel personal and natural:
- Contact's origin story, special interests, and sensitive topics (to avoid)
- Time since last contact (adjusts warmth and framing)
- Last interaction topics and open follow-ups (for natural callbacks)
- Relationship tier (adjusts formality)

**Interaction flow:**
1. User types in slash command for contact
2. app prompts for message type ("Check in", "Follow up", "Share something") 
3. User taps a preset or types their intent
4. AI generates a draft incorporating their intent + stored context
5. User can edit, regenerate (with revised intent), or use as-is
6. Copy to clipboard (v1.0) or send via WhatsApp (v1.1)
7. Generated messages must not be stored or logged without user confirmation


**Existing data used:** User intent (primary), `Origin Story`, `Special Interests`, `Sensitive Topics`, interaction log, follow-ups


### FR-04 — Relationship Drift Meter

**Problem it solves:** ADHD "object permanence for people" — contacts genuinely disappear from awareness unless something prompts them. Time blindness means 3 months can pass and it feels like 3 weeks.

Each contact card shows a visual indicator of relationship health based on time since last contact relative to their target frequency.

- **Green:** within target frequency window
- **Yellow:** within 2 weeks of overdue
- **Red:** overdue by more than one frequency cycle
- **Black:** overdue by 2+ cycles — relationship at risk
- No shame framing — Red means "good time to reach out", not "you failed". The app reframes overdue contacts as opportunities, not failures.
- Dormant (Black) contacts surface a reconnection script prompt (see FR-07) rather than a plain overdue alert
- For Inner Circle contacts specifically, drift triggers a gentle push notification
- should be flagged in the daily checkin

### FR-05 — Update Contact /kit-update [contact] [message] [date (optional)]

This should be triggerable using natural language or a slash command.

KIT takes the message that has been received or a summary of a conversataion and update the openbrain and the markdown file with the interaction. if a timestamp is supplied date it, otherwise use the current date and time

### FR-06 — WhatsApp Integration

The app integrates with the claude_whatsapp_integration project and will scrape messages from whatsapp.  If there are messages potentially missing it can prompt to get the user to download a transcript of the whsapp message and feed it into kit.  Kit can then use the transcript and the message log in openbrain to patch the timeline and record to the markdown files.

- Integration via claude_whatsapp_integration — set up a **dedicated instance** of this module for Kit (own port, own `auth_state/kit/`). Rationale: clean packaging if Kit is productised, independent failure domain, simpler support model.
- After sending a message KIT must update the contact with the message sent using the update process in FR-05
- If WhatsApp is not the preferred_channel for a contact, a channel reminder is shown before proceeding
- No automated or scheduled sending — all sends are user-initiated
- Kit monitors WhatsApp chats via the dedicated `claude_whatsapp_integration` daemon and updates the markdown file and Open Brain
- Kit listens to incoming and outgoing WhatsApp messages for tracked contacts whose `whatsapp_capture` field is `enabled`. When a conversation thread goes quiet (configurable inactivity window, default 30 minutes), Kit automatically summarises it and presents a review card before writing anything.

**Capture pipeline:**
1. The dedicated `claude_whatsapp_integration` daemon receives a message event and POSTs it to Kit gateway's `/api/incoming-message` endpoint
2. Kit's `MessageRouter` drops the message if the tracked contact's `whatsapp_capture` is `disabled`; otherwise buffers it per-JID
3. After the inactivity timeout (default 30 min), the thread is assembled and sent to Claude with a summarisation prompt
4. Claude returns: topics discussed, follow-ups mentioned, overall sentiment
5. Kit presents a review card (`/kit-captures`) — "Here's what I captured — confirm or dismiss"
6. On confirm: `kit.interaction_log` row written, `contacts.last_contact`/`next_action` updated, `ContextBinder.capture()` called with `source: "kit-whatsapp-capture"`, summary line appended to the contact's markdown
7. On dismiss: nothing stored; user can trigger manually later via `/kit-update`

**Privacy controls:**
- `whatsapp_capture: disabled` contacts are never read — the message is dropped at the router and never enters the capture pipeline
- The capture review card is always shown before anything is written — no silent storage
- Users can delete any stored memory from within Kit, which calls the Open Brain delete endpoint
- Every contact's markdown frontmatter shows whether capture is active, making the state auditable


### FR-07 — Reconnection Scripts ("It's Not Too Late")

**Problem it solves:** Rejection Sensitive Dysphoria (common in ADHD) and autistic anxiety about social rules both create a specific trap: the longer the gap, the more anxiety about reaching out, the longer the gap grows. People can fall out of touch permanently over something that requires a single message.

When a contact reaches Dormant status, the app provides an explicit reassurance message and a tailored reconnection script, addressing RSD anxiety directly.

- Triggered when contact is overdue by 2+ frequency cycles
- Opening copy: "It's been [X] since you spoke to [Name]. That's completely fine — here's a natural way to get back in touch:"
- Script uses: gap duration, relationship tier, origin story, last known topics, and any life events from notes
- Script avoids explaining the gap; it opens with a natural hook instead
- User can edit, regenerate, or dismiss
- The app models what a "contextual reason" should be based on how long the gap is, the relationship tier, and any recent events in their profile
- this should be flagged in the daily checkin

### FR-08 — Post-Interaction Debrief /kit-update [contact]

**Problem it solves:** The interaction log is only useful if it gets populated. For ADHD, this won't happen if it requires more than 60 seconds after a call. For autistic users, an unprompted, open-ended text field is less useful than guided questions.

After logging a contact, the app prompts three guided questions to capture interaction context. Responses are saved to Open Brain tagged to the contact.

- Prompt fires after: marking a contact as contacted, or returning from WhatsApp
- Question 1: "What did you talk about?" — free text or topic tags
- Question 2: "Anything to follow up on?" — adds to per-contact follow-up list
- Question 3: "How did it feel?" — emoji selector: positive / neutral / draining (optional — helps track which relationships are energising)
- Total time target: under 60 seconds
- Responses are saved as an Open Brain memory thoughts with contact name, date, and topics
- Debrief is optional — can be dismissed without penalty

### FR-09 — Follow-Up Tracker /kit-followup

**Problem it solves:** ADHD working memory means promises and threads get dropped. Autistic networkers may feel acute social discomfort if they forgot to follow up on something mentioned in the last call.

A per-contact list of open threads and pending actions that surfaces in the Prep Card.

- Follow-ups are added during Post-Interaction Debrief or manually from the contact card
- Each follow-up has: text description, date created, and optional due date
- Open follow-ups appear at the top of the Conversation Prep Card for that contact
- Follow-ups can be marked complete from the Prep Card or the contact detail view
- Completed follow-ups are retained in the interaction history (via Open Brain) but removed from the active list

Examples from existing data that illustrate the value:
- *Yan: "He's going to put me in contact with someone"* — did that happen?
- *Harry Valentine: "Crypto dev jobs are a potential option"* — follow up on this
- *Graham: "His mum is not well"* — ask how she is next time

### FR-10 — Occasion Awareness

**Problem it solves:** Having a *reason* to reach out is enormously helpful — it removes the ambiguity of "why am I messaging now?" and gives a natural conversation opener. Neurotypical people track this intuitively; this feature makes it explicit.

The app surfaces contact opportunities based on birthdays, anniversaries, and life events stored in contact notes.

- Birthday field on contact record; notification fires 2 days in advance
- Life events captured in notes are surfaced as manual hooks (e.g. "Tommy's child turns 8 this year — want to ask how school's going?")
- Occasion triggers appear as an additional card in Today's One Thing with a pre-written opener
- include in daily checkin

### FR-11 — "Safe to Reach Out?" Confidence Indicator

**Problem it solves:** Autistic people often feel uncertain about unwritten social rules — *is it weird to message someone I haven't spoken to in 3 months? Will they think I'm odd?* This uncertainty causes paralysis. This externalises a social judgement call that is mentally taxing for autistic people to make on their own, and reduces RSD anxiety for ADHD users.

Each contact card shows a plain-English signal externalising the social confidence judgement.

Include this in the daily checkin for overdue contacts

| Status | Copy shown |
|---|---|
| On time | Right on time — a message now is perfectly natural |
| Slightly overdue | A bit overdue, but a simple check-in is fine |
| Overdue | It's been a while — referencing something specific will help it feel natural |
| Dormant | Long gap — consider a "saw this and thought of you" hook |


---

## 5. Open Brain Integration (Context Binding Protocol)

Kit uses Open Brain as its persistent conversation memory layer. Open Brain is a self-hosted Supabase-backed knowledge store accessible via MCP. All thoughts stored by Kit are bound to contact entities using the **openbrain-context** binding protocol (`tannage888/openbrain_context_binding`), which provides standardised tagging, typed thoughts, and structured queries.

### 5.1 Context binding overview

Each Kit contact is a named **entity** in the context binding protocol. Thoughts (interactions, follow-ups, observations) are captured with structured metadata that binds them to the contact entity, enabling reliable retrieval and cross-contact queries.

**Dependency:** `openbrain-context` Python package (or equivalent TypeScript port for the Kit gateway/app layer).

**Repository:** `github.com/tannage888/openbrain_context_binding`

### 5.2 Entity naming convention

Each contact maps to a canonical entity name: lowercase, starting with a letter, containing only letters, digits, hyphens, or underscores.

| Contact name | Canonical entity |
|---|---|
| Graham Boutilier | `graham-boutilier` |
| Sophie Chen | `sophie-chen` |
| Barry Tan | `barry-tan` |
| Tommy Yang | `tommy-yang` |

The canonical name is derived automatically from the contact's display name on creation and stored on the contact record. It serves as the primary key for all Open Brain queries related to that contact.

### 5.3 Thought types used by Kit

Kit uses the following subset of the `ThoughtType` enum defined by the context binding protocol:

| ThoughtType | Kit usage | Example |
|---|---|---|
| `INTERACTION` | Post-interaction debrief entries — one per conversation | "Talked about cricket, his mum's health, job search" |
| `NEXT_ACTION` | Follow-up items — things to action or ask next time | "Ask how his mum is doing" |
| `OBSERVATION` | Key facts that need long-term recall | "Graham's mum is unwell" |
| `CONTEXT` | Background information about the contact or relationship | "Met at HANetf, Tim was his boss" |
| `SUMMARY` | Periodic consolidated snapshot of the relationship | Auto-generated summary of recent interactions |

### 5.4 Metadata structure

Every thought captured by Kit includes the following metadata, built by `build_metadata()`:

```python
{
    "type": "interaction",              # ThoughtType value
    "topics": [                         # Always includes entity + type + extras
        "graham-boutilier",             # Canonical entity name (first)
        "interaction",                  # Thought type value
        "cricket",                      # Extra topics from conversation
        "family"
    ],
    "people": ["Graham Boutilier"],     # Display names of people involved
    "action_items": [                   # Follow-ups mentioned in the interaction
        "Ask about his mum next time"
    ],
    "source": "kit-debrief"             # Where the capture originated
}
```

**Source values used by Kit:**

| Source | Origin |
|---|---|
| `kit-debrief` | Post-interaction debrief (FR-08) |
| `kit-manual` | Manually added via `/kit-update` (FR-05) |
| `kit-whatsapp-capture` | Automatic WhatsApp conversation capture (FR-06) |
| `kit-slash` | Captured via a Kit Claude Code slash command |
| `kit-import` | Migrated from People Hub data |

### 5.5 Capture examples

**Logging an interaction (FR-08 debrief):**
```python
binder.capture(
    content="Caught up with Graham over WhatsApp. Talked about cricket season starting, his mum is doing a bit better. He mentioned looking at a new role at WisdomTree.",
    entity="graham-boutilier",
    thought_type=ThoughtType.INTERACTION,
    extra_topics=["cricket", "family", "career"],
    people=["Graham Boutilier"],
    actions=["Ask about the WisdomTree role next time"],
    source="kit-debrief",
)
```

**Adding a follow-up (FR-09):**
```python
binder.capture(
    content="Ask Graham about the WisdomTree role next time we speak",
    entity="graham-boutilier",
    thought_type=ThoughtType.NEXT_ACTION,
    people=["Graham Boutilier"],
    source="kit-debrief",
)
```

**Recording a key fact:**
```python
binder.capture(
    content="Graham's mum has been unwell — ask how she's doing",
    entity="graham-boutilier",
    thought_type=ThoughtType.OBSERVATION,
    extra_topics=["family"],
    people=["Graham Boutilier"],
    source="kit-debrief",
)
```

### 5.6 Retrieval patterns

All Kit features that read from Open Brain use `ContextBinder` query methods:

| Feature | Query | What it returns |
|---|---|---|
| Conversation Prep Card (FR-02) | `binder.get_context("graham-boutilier", limit=5)` | Most recent interactions, observations, and follow-ups for the contact |
| Message Scaffolding (FR-03) | `binder.get_context("graham-boutilier", thought_type=ThoughtType.INTERACTION, limit=3)` | Recent interaction content for tone and topic context |
| Follow-Up Tracker (FR-09) | `binder.get_context("graham-boutilier", thought_type=ThoughtType.NEXT_ACTION)` | All open follow-up items for the contact |
| Reconnection Script (FR-07) | `binder.get_context("graham-boutilier", limit=1)` | Last interaction date + topics for script generation |
| Cross-contact search | `binder.search("cricket")` | All thoughts mentioning cricket across all contacts |
| All blockers/actions | `binder.search_by_type(ThoughtType.NEXT_ACTION)` | All open follow-ups across all contacts |
| Relationship summary | `binder.get_latest_summary("graham-boutilier")` | Most recent consolidated summary for the contact |

### 5.7 Completing follow-ups

When a follow-up is marked complete in Kit (FR-09), the original `NEXT_ACTION` thought remains in Open Brain as historical context. Kit tracks completion status in the `follow_ups` table in Supabase. The thought itself is not deleted — it becomes part of the interaction history, visible when reviewing past conversations.

### 5.8 Open Brain instance

Kit uses the shared Open Brain Supabase instance. Context binding via entity names ensures Kit thoughts are isolated and retrievable without noise from other contexts.

- Supabase project: `popxesemindihcbedegy` (shared with Open Brain)
- All Kit thoughts are bound to contact entities — queries by entity return only that contact's context
- No memory limit enforced — all interaction logs retained indefinitely
- The `thoughts` table uses the standard Open Brain schema; context binding metadata lives in the `metadata` JSONB column
- Cross-entity queries (e.g. "all overdue follow-ups") are supported via `search_by_type()`
- this must be configurable.  If this is every installed by another user they will have their own openbrain

### 5.9 Capture pipeline integration

The WhatsApp capture pipeline feeds Open Brain indirectly through `ContextBinder`, not by writing to the `thoughts` table directly. Flow:

1. The dedicated `claude_whatsapp_integration` daemon POSTs each incoming/outgoing message for a tracked contact to Kit gateway's `POST /api/incoming-message` endpoint.
2. `MessageRouter` checks the contact's `whatsapp_capture` flag; if `disabled`, the message is dropped and never enters the pipeline.
3. Otherwise the message is buffered per-JID. After the configurable silence gap (default 30 min), the thread is assembled into a `ConversationThread`.
4. `CapturePipeline` sends the thread to Claude with a summarisation prompt; Claude returns topics, follow-ups, and sentiment.
5. A review card is presented via `/kit-captures`. **No Open Brain write occurs before confirmation** — this is load-bearing for the privacy model.
6. On confirm, `ContextBinder.capture()` is called with:
   - `entity`: canonical name for the contact
   - `thought_type`: `INTERACTION`
   - `source`: `kit-whatsapp-capture`
   - `action_items`: any follow-ups Claude identified
   - `people`: contact display name(s)
7. The same commit path also inserts into `kit.interaction_log`, updates `contacts.last_contact` and `next_action`, and appends a summary line under `## Interaction Log` in the contact's markdown file.
8. On dismiss, nothing is written anywhere — no Open Brain memory, no Supabase row, no markdown change.

Sweep-based capture (the periodic `SweepScheduler` that fetches recent history from the daemon on schedule) uses the exact same `CapturePipeline` entry point — the only difference is that live capture is triggered by a push from the daemon, whereas sweep is triggered by the Kit-side timer.



## 7. Non-Functional Requirements

### 7.1 Platform

- **v1.0 Primary:** Conversational interface via **Claude Code slash commands** (`.claude/commands/kit-*.md`) that invoke the Kit gateway's tools.
- **v1.0 Runtime:** Kit gateway (`gateway/src/`) + Supabase (`kit` schema) + Open Brain (via `ContextBinder`) + dedicated `claude_whatsapp_integration` daemon.
- **v1.0 No mobile app** — all interaction is conversational; no app to install or maintain.
- **v1.1 (planned):** Migrate slash commands to portable MCP prompts so Kit works in Claude Desktop and any MCP-capable client. See [future-work.md](future-work.md).
- **v2.0:** Mobile app (Expo / React Native) — iOS primary, Android secondary. The v0 Expo code is preserved in `old/expo-app/`.

### 7.2 Privacy and data

- All contact data stored in user-owned Supabase instance — no third-party cloud hosting
- Open Brain instance is user-owned — Kit does not control or access it beyond the context binding protocol
- No analytics, tracking, or third-party data sharing
- Message scaffolding runs through Claude conversation — messages are not stored by the provider beyond the API request
- User can export all data at any time (JSON)
- User can delete all data including Open Brain memories via conversational commands

### 7.3 Performance

- MCP tool response (queue, contact lookup): under 2 seconds
- Open Brain context query (prep card): under 3 seconds
- Message scaffolding generation: under 5 seconds

### 7.4 Conversational design

- All responses use anxiety-neutral language — never "overdue", "you missed", "you failed"
- Conversational tone is warm, practical, and non-judgmental
- Kit MCP tools return structured data that Claude can present naturally in conversation
- No jargon in user-facing output — "check in with", "catch up with", not "execute contact action"

### 7.5 Accessibility (v2.0 mobile app)

- Large tap targets — minimum 44x44pt throughout
- VoiceOver / TalkBack support for all interactive elements
- No time-limited UI elements (no auto-dismissing alerts or countdown timers)
- Notification copy reviewed for anxiety-neutral language before release

