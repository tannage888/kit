# Neurodivergent Networking App — Feature Suggestions

*Based on People Hub data analysis + autism/ADHD networking challenges*

---

## The Core Insight

Most CRM and networking tools are built around the assumption that the hard part is *organising* contacts. For neurodivergent networkers, organisation is rarely the problem. The hard parts are:

1. **Knowing what to say** (and whether it's appropriate to say it)
2. **Initiating contact** when there's no obvious reason
3. **Remembering context** without being able to rely on social intuition
4. **Managing energy** — social interaction has a real cost
5. **Time blindness** — relationships drift without noticing
6. **Rejection anxiety** — fear of being annoying, especially after a gap

Your existing data schema already captures several of these (Social Battery Cost, Sensitive Topics, Origin Story, Special Interests) — the app just needs to make *active use* of them rather than storing them passively.

---

## Feature 1: "Today's One Thing" — The Daily Contact Queue

**Problem it solves:** For ADHD, seeing 33 people who need attention causes shutdown. For autism, "who should I contact?" without a rule feels arbitrary and stressful.

**How it works:** The home screen shows a single, curated contact suggestion — never more than 3 at once. The algorithm picks based on:
- Whose `next_action` date is approaching or overdue
- Current energy level (see Feature 4)
- Social Battery Cost match to today's capacity

The framing matters: not *"You have 6 people overdue"* but *"Here's who to check in with today: Barry Tan."*

**Existing data used:** `next_action`, `frequency`, `social_battery`

---

## Feature 2: "What Do I Say?" — Message Scaffolding

**Problem it solves:** This is the single biggest barrier for autistic networkers. Knowing *that* you should message someone is easy. Knowing *how* to start — especially after a gap — is genuinely hard. This is also a key ADHD task-initiation barrier.

**How it works:** For each contact, a button generates a suggested opening message using:
- Time since last contact (tone changes: 2 weeks vs. 3 months feel different)
- How you met (Origin Story)
- What you talked about last time (Interaction Log)
- Their interests (conversation hooks)
- Any pending follow-ups

Example output for *Graham Boutilier* after 10 weeks: *"Hey Graham — been a while! I was thinking about you the other day. How's the cricket going? Hope your mum's doing a bit better."*

The user can edit, regenerate, or use as-is. The goal is to get from *paralysed* to *draft in hand* in one tap.

**Existing data used:** `Origin Story`, `Special Interests`, `Sensitive Topics`, `Import Information`, interaction log

**New data needed:** Interaction log entries (what was discussed last time)

---

## Feature 3: Conversation Prep Card

**Problem it solves:** Walking into a call or meeting without being able to recall key context causes anxiety and social missteps for autistic people. ADHD makes this worse — the context simply isn't in working memory.

**How it works:** Before a scheduled interaction, the app surfaces a one-screen "pre-flight card":

- 🤝 **How you met:** *Met at HANetf, Tim was your boss*
- 💬 **Last time you talked:** *January 15 — mentioned his kids, one in Spain*
- 🎯 **Good topics:** *Finance, his WisdomTree work, family*
- ⚠️ **Avoid:** *(any sensitive topics)*
- ❓ **Suggested questions:** 2–3 auto-generated based on their profile
- 📌 **Follow up on:** Any unresolved threads from last interaction

This turns a social interaction from *unknown territory* into a *structured task*.

**Existing data used:** All fields, plus interaction log

---

## Feature 4: Energy Budget System

**Problem it solves:** Autistic people experience genuine depletion from social interaction. Booking three high-battery-cost contacts in one day leads to burnout and avoidance of the whole system. ADHD users have highly variable energy and need the app to flex with them.

**How it works:** A simple daily check-in: *"How are you feeling today?"* with three modes:

- 🟢 **Full capacity** — show high and medium battery contacts
- 🟡 **Medium day** — prioritise Low battery contacts only
- 🔴 **Low day** — suggest a simple text or emoji reaction to someone in Inner Circle; no pressure for anything more

The app never guilt-trips. On a red day, it might say: *"Even a quick 'thinking of you' to Keyan counts as contact."*

**Existing data used:** `social_battery` (currently 40% populated — should be mandatory on contact creation)

**New data needed:** Daily mood/energy check-in

---

## Feature 5: Relationship Drift Meter

**Problem it solves:** ADHD "object permanence for people" — contacts genuinely disappear from awareness unless something prompts them. Time blindness means 3 months can pass and it feels like 3 weeks.

**How it works:** Each contact has a simple visual health indicator:

- 🟢 On track (within target frequency)
- 🟡 Approaching overdue (within 2 weeks of target)
- 🔴 Drifting (overdue by more than one cycle)
- ⚫ Dormant (overdue by 2+ cycles — relationship at risk)

Crucially: *no shame framing*. Red doesn't mean you failed. It means *now is a good time*. The app reframes overdue contacts as opportunities, not failures.

For Inner Circle contacts specifically, drift triggers a gentle push notification: *"You haven't spoken to Sophie in 5 weeks — want a message suggestion?"*

**Existing data used:** `last_contact`, `frequency`, `next_action`

---

## Feature 6: "It's Not Too Late" — Reconnection Scripts

**Problem it solves:** Rejection Sensitive Dysphoria (common in ADHD) and autistic anxiety about social rules both create a specific trap: the longer the gap, the more anxiety about reaching out, the longer the gap grows. People can fall out of touch permanently over something that requires a single message.

**How it works:** When a contact has drifted to ⚫ Dormant, instead of flagging failure, the app offers explicit reassurance and a tailored script:

*"It's been 4 months since you spoke to Pete Johnston. That's completely fine — here's a natural way to get back in touch:"*

> *"Hey Pete — I know it's been a while! I was [contextual reason]. How have you been?"*

The app models what "contextual reason" should be based on how long the gap is, the relationship tier, and any recent events in their profile.

**Existing data used:** `last_contact`, `Type/Status`, `Origin Story`, interaction log

---

## Feature 7: Post-Interaction Debrief (Low Friction)

**Problem it solves:** The interaction log is only useful if it gets populated. For ADHD, this won't happen if it requires more than 60 seconds after a call. For autistic users, an unprompted, open-ended text field is less useful than guided questions.

**How it works:** After logging a contact date, the app prompts three simple questions:

1. *"What did you talk about?"* — free tags or short text (e.g. "job search, cricket, his mum")
2. *"Anything to follow up on?"* — adds to a follow-up list
3. *"How did it feel?"* — 😊 / 😐 / 😓 (optional — helps track which relationships are energising)

Takes under 60 seconds. Feeds the Message Scaffolding and Prep Card features.

**New data needed:** Interaction topics, follow-up items, interaction sentiment

---

## Feature 8: Follow-Up Tracker

**Problem it solves:** ADHD working memory means promises and threads get dropped. Autistic networkers may feel acute social discomfort if they forgot to follow up on something mentioned in the last call.

**How it works:** A lightweight to-do list scoped *per person*. Examples from your existing data that would have been perfect for this:

- *Yan: "He's going to put me in contact with someone"* — did that happen?
- *Harry Valentine: "Crypto dev jobs are a potential option"* — follow up on this
- *Graham: "His mum is not well"* — ask how she is next time

When the contact comes up in the queue, follow-up items surface automatically in the Prep Card.

**Existing data used:** `Import Information` (currently used as a dump for this kind of thing — should become structured)

---

## Feature 9: "Safe to Reach Out?" Confidence Indicator

**Problem it solves:** Autistic people often feel uncertain about unwritten social rules — *is it weird to message someone I haven't spoken to in 3 months? Will they think I'm odd?* This uncertainty causes paralysis.

**How it works:** Each contact card shows a plain-English signal about whether reaching out now is socially natural:

- ✅ *"Right on time — a message now is perfectly natural"*
- 🕐 *"A bit overdue, but a simple check-in is fine"*
- 💬 *"It's been a while — referencing something specific will help it feel natural"*
- 🔗 *"Long gap — consider a 'saw this and thought of you' hook"*

This externalises a social judgement call that is mentally taxing for autistic people to make on their own, and reduces RSD anxiety for ADHD users.

---

## Feature 10: Occasion Awareness

**Problem it solves:** Having a *reason* to reach out is enormously helpful — it removes the ambiguity of "why am I messaging now?" and gives a natural conversation opener. Neurotypical people track this intuitively; this feature makes it explicit.

**How it works:** Track birthdays, work anniversaries, or life events noted in the profile (e.g. *Tommy Yang's child born ~2018*, so they're about 8 now — a natural update). The app surfaces these as contact triggers with a pre-written message:

*"Tommy's kid turns 8 this year — want to ask how school's going?"*

**Existing data used:** Notes and import information fields
**New data needed:** Birthday/anniversary fields

---

## Feature 11: Communication Channel Preference

**Problem it solves:** *"Should I text, email, or message on LinkedIn?"* is a decision that causes friction and sometimes paralysis, especially for autistic users who want to do the "right" thing.

**How it works:** Add a simple field per contact for preferred channel (text, WhatsApp, email, LinkedIn, phone, in-person only). The app then prescribes the channel, removing one decision from the interaction.

**New data needed:** `preferred_channel` per contact

---

## New Data Fields to Prioritise

Looking at your existing schema, these fields are currently underused but are the most valuable for a neurodivergent-first tool. They should become prominent on the contact creation screen:

| Field | Current Usage | Priority |
|---|---|---|
| Social Battery Cost | 40% | **Mandatory** — core to energy budgeting |
| Special Interests | 5% | **High** — fuel for Message Scaffolding |
| Sensitive Topics | 2% | **High** — prevents social missteps |
| Origin Story | 25% | **High** — grounds message tone |
| Interaction Log | 0% | **Critical** — enables most other features |

The app should prompt for these during onboarding with simple questions rather than blank form fields: *"How did you meet [Name]?"* feels easier than a labelled text box.

---

## What to *Not* Build (or Frame Carefully)

- **Scoring or gamification of relationships** — "maintaining streaks" is anxiety-inducing and frames relationships as performance
- **Public or comparative elements** — this is deeply personal data
- **Aggressive notifications** — for ADHD especially, notification fatigue causes avoidance of the whole tool
- **"Networking" as a framing** — consider calling it something like *Tend* or *Keep in Touch* — the language of gardening rather than transacting

---

## Summary: Priority Build Order

1. **Daily Contact Queue** (Today's One Thing) — immediate value, simple to build
2. **Energy Budget Check-In** — changes the whole feel of the app
3. **Post-Interaction Debrief** — builds the data that powers everything else
4. **Message Scaffolding** ("What Do I Say?") — the highest-value differentiator
5. **Relationship Drift Meter** — visual, motivating, non-shaming
6. **Conversation Prep Card** — high value once interaction log is populated
7. **"It's Not Too Late" / Reconnection Scripts** — addresses the deepest pain point
