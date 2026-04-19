# Resume Notes — Kit v1.0

Scratchpad for the ralph-loop. Each iteration must update this file.

---

## Current status: Stage A complete — Phase 1 not started

Stage A (pre-implementation setup) was done by hand on 2026-04-19 before ralph started. Summary:

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

## Known broken state entering Phase 1

Deleting `whatsapp.ts` and `message-store.ts` in Stage A intentionally breaks these files (they still import `WhatsAppConnection`):

- `gateway/src/index.ts`
- `gateway/src/services/history-fetcher.ts`
- `gateway/src/services/sweep-scheduler.ts`
- `gateway/src/routes/api.ts`
- `gateway/src/services/history-fetcher.test.ts`
- `gateway/src/services/sweep-scheduler.test.ts`

**Phase 1 fixes all of these** per `docs/implementation-plan.md` Stage B Phase 1.

`npm test` and `npx tsc --noEmit` are expected to fail until Phase 1 completes.

## Next iteration

Begin **Phase 1 — Gateway REST-client refactor**. See `docs/implementation-plan.md` for full deliverables and test criteria. Don't emit `<promise>KIT_V1_COMPLETE</promise>` until all 10 phases are green.
