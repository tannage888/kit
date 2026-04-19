# Kit — Development, Testing & Rollout Plan
*Version 0.1 — March 2026*

---

## 1. Overview

This plan covers the full journey from project scaffold to public launch. Kit is built by a solo developer using React Native (Expo), with Supabase for backend services and the Anthropic API for AI features. The plan is structured in four phases: Alpha (personal use), Beta (invited users), Soft Launch (App Store), and Growth.

Total estimated time from scaffold to App Store: **16–20 weeks** working part-time (~10hrs/week).

---

## 2. Tech Stack Summary

| Layer | Technology | Notes |
|---|---|---|
| Mobile app | React Native + Expo (SDK 51+) | Single codebase for iOS and Android |
| Local data | expo-sqlite | Contact records stored on-device |
| Backend | Supabase (Edge Functions + cron) | Push scheduling, AI proxy |
| Memory / context | Open Brain (dedicated Supabase project) | Interaction logs per contact |
| AI | Anthropic Claude API (claude-haiku-4-5) | Message scaffolding, prep card questions |
| Push notifications | Expo Push Notifications | Cross-platform, no extra infra |
| WhatsApp | wa.me deep links (v1.0) | No API key required |
| CI/CD | Expo EAS Build | TestFlight + internal Android distribution |

---

## 3. Build Phases

### Phase 1 — Foundation (Weeks 1–3)
*Goal: working contact list with drift meter on a real device*

**Tasks:**
- Scaffold Expo project, configure TypeScript, ESLint, Prettier
- Implement SQLite schema: contacts table, follow_ups table
- Build contact list screen with Drift Meter colour coding (FR-06)
- Build contact detail screen (read-only)
- Build add/edit contact form with all required fields
- Add relationship tier badges and frequency labels
- Wire Today's One Thing algorithm (FR-01) — overdue sort, no energy filtering yet
- Unit tests: drift calculation, next_action computation, tier sorting

**Done when:** Solo use feels natural; all 33 People Hub contacts imported manually.

---

### Phase 2 — Core Loop (Weeks 4–7)
*Goal: full send-and-debrief loop working end to end*

**Tasks:**
- Implement WhatsApp deep link send (FR-07): construct wa.me URL, open, return
- Build Post-Interaction Debrief screen (FR-09): 3 questions, emoji picker
- Wire Supabase Open Brain write on debrief submit
- Build Energy Budget daily check-in (FR-05): modal on app open, persists to midnight
- Filter Today's One Thing by energy state
- Implement push notification scheduling via Supabase cron + Expo Push API (FR-02)
- Daily digest logic: batch multiple due contacts into one notification
- Integration tests: send flow end-to-end, debrief → Open Brain write, push trigger

**Done when:** Full loop works: app opens → check-in → contact surfaced → WhatsApp opens → debrief fires → Open Brain updated → next_action recalculated.

---

### Phase 3 — Intelligence Layer (Weeks 8–12)
*Goal: AI features working; app feels genuinely useful*

**Tasks:**
- Build Conversation Prep Card (FR-03): fetch Open Brain memories, display structured brief
- Implement Message Scaffolding (FR-04): call Claude API with contact profile + interaction history
- Prompt engineering: gap-aware tone, hook generation, follow-up reference
- Build Reconnection Scripts (FR-08): dormant trigger, reassurance copy, Claude-generated hook
- Implement "Safe to Reach Out?" indicator (FR-12): compute from drift state
- Build Follow-Up Tracker (FR-10): per-contact list, mark complete, surfaces in Prep Card
- Implement Occasion Awareness (FR-11): birthday notification 2 days out, life event hooks
- AI response tests: tone at 2 weeks vs 3 months, follow-up reference accuracy
- Edge case tests: contact with no Open Brain history, missing WhatsApp number, missing origin story

**Done when:** Message scaffolding produces a message that doesn't need editing at least 70% of the time in personal use.

---

### Phase 4 — Polish & Beta Prep (Weeks 13–16)
*Goal: app ready for 10 external users*

**Tasks:**
- Onboarding flow: CSV import from People Hub, guided blank-field prompts ("How did you meet X?")
- Accessibility pass: 44pt tap targets, VoiceOver labels, no countdown timers
- Notification copy audit: remove any guilt or failure framing
- Data export: JSON dump of contacts + Open Brain memories (FR NFR)
- In-app data deletion: clear all contacts, wipe Open Brain via MCP
- Performance: cold start < 2s, contact queue < 1s, prep card < 3s, AI < 5s
- Crash reporting: Sentry integration
- App Store assets: screenshots, icon, description, privacy policy
- TestFlight build via EAS

**Done when:** 5 people use the app for one week with no critical bugs reported.

---

## 4. Testing Strategy

### Unit Tests (Jest + React Native Testing Library)

| Area | What to test |
|---|---|
| Drift calculation | next_action vs today → correct colour state |
| Queue algorithm | Ordering by overdue severity + energy match |
| wa.me URL builder | E.164 formatting, message URL encoding |
| Open Brain tag builder | Correct person/type/date/channel tags |
| Notification scheduler | Correct fire time, batch logic |

### Integration Tests

| Flow | Pass condition |
|---|---|
| Full send loop | Contact → WhatsApp opens → debrief fires → OB write succeeds → next_action updated |
| Energy filter | Red day → only Low battery contacts shown |
| Push notification | Due contact at 9am → notification appears on device |
| Prep Card | Open Brain query returns correct memories for contact |
| Message scaffolding | Claude API returns a non-empty message within 5s |

### Manual / Exploratory

- All 33 People Hub contacts imported without data loss
- Dormant contact (Black) shows reconnection script, not standard overdue alert
- Occasion Awareness fires 2 days before a birthday
- VoiceOver reads all interactive elements correctly
- Deleting all data removes both SQLite records and Open Brain memories

### Beta Acceptance Criteria (before Soft Launch)

- Zero crash-rate on core loop (contact → send → debrief) over 7-day beta
- Prep Card loads in under 3 seconds on 3-year-old device
- Message scaffolding rated "usable without editing" by 3/5 beta users
- No notification copy flagged as guilt-inducing by any beta user

---

## 5. Rollout Plan

### Alpha — Personal Use (Weeks 1–12)
- Solo use on personal device throughout build
- All 33 People Hub contacts as live test data
- Iteration based on daily friction points

### Beta — Invited Users (Weeks 14–17)
- 8–12 people: mix of neurodivergent and neurotypical users
- Recruited from personal network + neurodivergent online communities (r/autism, r/ADHD)
- Distributed via TestFlight (iOS) and EAS internal distribution (Android)
- Weekly check-in: 5-question Typeform (not a long survey)
- Focus: notification tone, message scaffolding quality, energy budget usefulness
- Feedback tracked in a simple Notion board

### Soft Launch — App Store v1.0 (Week 18–20)
- iOS App Store submission (primary platform)
- Android Play Store (can follow 2–4 weeks later)
- Initial pricing: free with optional one-time "supporter" purchase (£4.99) — no subscription in v1.0
- No paid acquisition at launch; organic only

### v1.1 — Post-Launch Priorities (3–6 months post-launch)
- WhatsApp Business API integration (replace deep links with proper send/receive)
- iCloud or encrypted cloud backup option for contact data
- Android parity improvements
- Investigate multi-brain Open Brain coordination for power users

---

## 6. Infrastructure Costs (Monthly at Launch)

| Item | Cost |
|---|---|
| Supabase (2 projects: Kit backend + Open Brain) | Free tier → ~£20/mo at scale |
| Anthropic API (Haiku, ~500 messages/mo) | ~£1–3/mo |
| Expo EAS Build (personal plan) | Free |
| Apple Developer Account | £79/year (~£7/mo) |
| Sentry (error tracking, free tier) | £0 |
| **Total at launch** | **~£8–30/mo** |

---

## 7. Go / No-Go Criteria for App Store Submission

| Criterion | Threshold |
|---|---|
| Core loop crash-free | 0 crashes in 7-day beta |
| Message scaffolding quality | ≥60% rated usable without editing |
| Notification tone | 0 beta users flagged guilt framing |
| Performance | All NFR thresholds met on mid-range device |
| Privacy policy | Published at a URL, linked from App Store listing |
| Data deletion | Full delete (contacts + OB memories) verified working |

---

*Kit — Dev, Test & Rollout Plan v0.1 — March 2026 — Confidential*
