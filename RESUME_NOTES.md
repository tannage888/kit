# Resume Notes — Kit v1.0

Scratchpad for the ralph-loop. Each iteration must update this file.

---

## Phase history

- Phase 1 ✅ — Gateway REST-client refactor (84 tests)
- Phase 2 ✅ — Markdown schema + whatsapp_capture field (88 tests)
- Phase 3 ✅ — Energy state + /kit-energy (98 tests)
- Phase 4 ✅ — Drift/safety/occasion pure functions (135 tests)
- Phase 5 ✅ — Daily check-in + /kit-checkin (147 tests)
- Phase 6 ✅ — Prep card + draft context + /kit-prep + /kit-draft (163 tests)
- Phase 7 ✅ — Slash commands: kit-energy, kit-checkin, kit-prep, kit-draft, kit-update, kit-followup
- Phase 8 ✅ — Reconnect context + /kit-reconnect (174 tests)
- Phase 9 ✅ — WhatsApp capture wiring: message-router filter, MCP tools kit-pending-captures/confirm/dismiss, /kit-captures, daemon setup docs (179 tests)
- Phase 10 ✅ — E2e smoke test + manual test plan (194 tests, 2026-04-19)
- Phase 11 ✅ — ZIP transcript ingestion: resolver endpoint, import-complete webhook, ImportIngestor service, source-tagged review cards, daemon-side wiring docs (212 tests, 2026-05-02)

---

## Current status: Phase 11 + post-ship fixes (partially uncommitted)

**Total: 212 tests passing, 13 test files**

---

## Session 2026-05-02 — Live debug + /kit-add-contact

### Proven in production
- End-to-end ZIP-import flow validated with real Samir Patel chat (221 messages, confirmed to contact card)

### Bug fixes found during live test (uncommitted — needs cleanup + commit next session)

**Kit (`kit` repo):**
- `gateway/src/services/import-ingestor.ts` — use `mode=full` not `since_last_review` (historical ZIP messages predate the live-capture watermark; since_last_review filters them all out)
- `gateway/src/services/message-router.ts` — `contactToJid()` was not stripping spaces from E.164 numbers (e.g. "+44 7956 289692" → JID had spaces, causing triggerCapture to look up wrong key and return false). Fix: add `.replace(/\s+/g, "")` to match ContactRegistry.e164ToJid.
- Both files have `📥` debug logs to remove before commit.

**Daemon (`claude_whatsapp_integration` repo):**
- `src/services/whatsapp.ts` — `messages.upsert` type gate only allowed `type=notify`; self-sent messages arrive as `type=append` (multi-device sync). Fix: allow both. Has `🔔` debug log to remove.
- `src/services/phone-export-importer.ts` — parser only handled iOS format `[DD/MM/YYYY, HH:MM:SS]`; Android exports use `DD/MM/YY, HH:MM - ` with no brackets. Fix: dual-regex, UK/US date-order fallback, NaN-timestamp rejection. Has `📄` debug log to remove.
- `src/services/read.ts` — transcript read crashes on stored NaN-timestamp messages from failed imports. Fix: defensive filter.
- `src/index.ts` — verbose `📦` onImport logging added; keep the useful lines, remove the noisy ones.

### New slash command (uncommitted)
- `.claude/commands/kit-add-contact.md` — new slash command
- `gateway/src/mcp/tools.ts` — `CreateContactInput` + `buildMarkdown` + DB upsert extended with `whatsapp_capture`, `wa_capture` fields
- `gateway/src/mcp/server.ts` — MCP `create-contact` tool schema + dispatch extended
- **Note:** `createContact` in tools.ts runs in the MCP server process, not the REST gateway. The slash command falls back to writing markdown directly; SyncService handles DB sync.

### 4 new contacts added (markdown written, Supabase sync pending)
- `People/2 - Active/Say Keat Ooi.md` — tier 2, monthly, +65 9182 8173, capture enabled
- `People/2 - Active/Teng Chew Ooi.md` — tier 2, monthly, +60 124738633, capture enabled (Say Keat's dad / Uncle Ooi)
- `People/1 - Inner Circle/Peter Tan.md` — tier 1, fortnightly, +64 210 568 555, capture enabled (uncle, dad's youngest brother)
- `People/1 - Inner Circle/Kat Osman.md` — tier 1, weekly, +44 7931 460 181, capture enabled (cousin)

### PRIORITY 1 — Daemon live-push hook (blocks live WhatsApp capture)

**Status:** Kit-side is already done (Phase 1). Work required is entirely in `claude_whatsapp_integration`.

**Why this matters:** Without it, `MessageRouter.handleMessage` is only called via the scheduled sweep. Live capture (inactivity timer, real-time auto-capture) never fires.

**What to implement in `claude_whatsapp_integration`:**

1. `src/config.ts` — add `WA_INCOMING_HOOK_URL: string | null` (nullable; feature is off if unset):
   ```ts
   WA_INCOMING_HOOK_URL: nullableStrEnv("WA_INCOMING_HOOK_URL"),
   ```

2. `src/index.ts` — add a best-effort POST on every `message:received` event, after the existing group-membership handler:
   ```ts
   if (config.WA_INCOMING_HOOK_URL) {
     const hookUrl = config.WA_INCOMING_HOOK_URL;
     wa.on("message:received", (msg: any) => {
       fetch(hookUrl, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
           remoteJid:  msg.remoteJid,
           fromMe:     msg.fromMe ?? false,
           body:       msg.body ?? "",
           timestamp:  msg.timestamp,
           messageId:  msg.messageId,
         }),
       }).catch(() => {}); // best-effort; Kit outage must not crash the daemon
     });
   }
   ```

3. `.env.example` — add:
   ```
   # WA_INCOMING_HOOK_URL=http://127.0.0.1:3141/api/incoming-message
   ```

**Schema compatibility verified:** Kit's `incomingMsgSchema` at `gateway/src/routes/api.ts:84` expects `{ remoteJid, fromMe, body, timestamp (epoch ms), messageId }` — this matches the `WhatsAppMessage` fields the daemon emits.

**No Kit gateway changes needed.** `POST /api/incoming-message` is already wired at `gateway/src/routes/api.ts:92` and calls `router.handleMessage(parsed.data)` directly.

**Compatible with queued items:** This is additive to the daemon only. Kit fix commits (items 2–5 below) are unaffected.

---

### Next session checklist
1. Remove debug logs (`🔔`, `📄`, `📥`) from whatsapp.ts, phone-export-importer.ts, import-ingestor.ts, index.ts
2. Commit kit fixes: `fix: Phase 11 production fixes — mode=full, contactToJid normalisation, add-contact command`
3. Commit daemon fixes: `fix: WhatsApp ZIP ingestion — append-type gate, Android export parser, defensive read filter`
4. Verify 4 new contacts synced to Supabase (refresh gateway or restart)
5. Consider adding a REST endpoint wrapper around `createContact` so the slash command can call it directly instead of writing markdown

### Deliverables shipped

**Gateway services (pure functions):**
- `services/relationship-status.ts` — drift, safety, occasions
- `services/checkin.ts` — buildCheckinReport + formatCheckinReport
- `services/prep.ts` — buildPrepCard + buildDraftContext
- `services/reconnect.ts` — buildReconnectContext
- `services/energy.ts` — EnergyService + isEnergyLevel
- `services/message-router.ts` — whatsapp_capture + wa_capture filter chain
- `services/import-ingestor.ts` — pulls daemon transcript after ZIP import, routes through MessageRouter, drains capture (Phase 11)

**MCP tools (gateway/src/mcp/):**
- server.ts: kit-set-energy, kit-get-energy, kit-daily-checkin, kit-prep-card, kit-draft-context, kit-reconnect-context, kit-pending-captures, kit-confirm-capture, kit-dismiss-capture, set-contact-active

**Slash commands (.claude/commands/):**
- kit-energy.md, kit-checkin.md, kit-prep.md, kit-draft.md, kit-update.md, kit-followup.md, kit-reconnect.md, kit-captures.md

**Database migrations (gateway/supabase/migrations/):**
- 20260419_phase2_contact_fields.sql — special_interests, sensitive_topics, preferred_channel, birthday, whatsapp_capture
- 20260419_phase3_energy_state.sql — kit.energy_state table

**Documentation:**
- docs/whatsapp-daemon-setup.md
- docs/manual-test-plan.md

**E2e test:**
- src/e2e.test.ts — 15 tests covering Phases 3–9 pure function layer
