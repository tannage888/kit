# Resume Notes — Kit v1.0

Scratchpad for the ralph-loop. Each iteration must update this file.

---

## Current status: Phase 1 complete — Beginning Phase 2

### Phase 1 — Gateway REST-client refactor ✅ DONE (2026-04-19)

All 8 deliverables landed. Final test run: **84 passed, 0 failed**. `tsc --noEmit` clean.

- [x] `history-fetcher.ts` refactored to REST client (`fetch` not Baileys)
- [x] `history-fetcher.test.ts` updated to mock fetch
- [x] `sweep-scheduler.ts` refactored (checks daemon `/api/status` not `wa.getStatus()`)
- [x] `sweep-scheduler.test.ts` fixed (Supabase `.schema()` chain, fetch mock)
- [x] `routes/api.ts` rewritten (no `wa` param, `POST /incoming-message`, status proxy)
- [x] `index.ts` simplified (no Baileys boot)
- [x] `markdown.ts` regex bugs fixed (`extractSection`, `parseFollowUps`)
- [x] `src/routes/api.test.ts` — new test file (5 tests)

### Stage A checklist

- [x] `People/` backed up to `People.backup-2026-04-19/` (42 files)
- [x] Spec renumbered (FR-00..FR-11, no duplicates, §5.9 filled)
- [x] Expo app moved to `old/expo-app/`
- [x] Unrelated files moved to `old/`
- [x] Gateway Baileys files deleted (`whatsapp.ts`, `message-store.ts`, `auth_state/`)
- [x] Baileys deps removed from `gateway/package.json`
- [x] `gateway/src/config.ts` — `AUTH_STATE_PATH` / `WHATSAPP_PHONE` removed, `EXTERNAL_GATEWAY_URL` added (default `http://127.0.0.1:3142`)
- [x] `People.template/` created with example files for all 3 tiers
- [x] `docs/implementation-plan.md`, `docs/ralph-prompt.md`, `docs/future-work.md` written
- [x] `CLAUDE.md` updated for the new architecture
- [x] Git init + initial commit + push to `github.com/tannage888/kit`

---

## Next iteration

**Phase 2 — Markdown schema + parser updates**

New frontmatter fields: `social_battery_cost`, `origin_story`, `special_interests`, `sensitive_topics`, `preferred_channel`, `birthday`, `whatsapp_capture`.

Deliverables:
1. Update `TrackedContact` type in `gateway/src/types.ts`
2. Update `parseContactFile()` in `sync.ts` to read new fields
3. Update markdown writer (Supabase → markdown) in `sync.ts` to write them back
4. Supabase migration: `gateway/supabase/migrations/20260419_phase2_contact_fields.sql`
5. Extend `sync.test.ts` round-trip test: new fields preserved

Don't emit `<promise>KIT_V1_COMPLETE</promise>` until all 10 phases are green.
