---
project: kit
display_name: "Kit — Relationship Manager"
owner: seang
status: done
priority: 2
created: 2026-04-01
last_reviewed: 2026-05-16

permissions: bypassPermissions
max_concurrent_agents: 1
shared_resources:
  - whatsapp_daemon
  - port_3141
  - port_3142

current_stage: supabase-source-of-truth-backfill

daemon_pin:
  repo: C:\dev\claude_whatsapp_integration
  commit: b503624ce7cf5af75974c584047a369ee04d9ac0
  message: "feat: add GET /api/groups endpoint"
  verified: 2026-05-16
  endpoints_consumed:
    - GET /api/status
    - GET /api/groups
    - GET /api/chats/:jid/messages
    - POST /api/chats/:jid/ack

stages:
  supabase-source-of-truth:
    model: sonnet
    loop: ralph
    max_iterations: 10
    prompt: |
      Flip Kit's contact sync so Supabase is the source of truth and People/*.md files
      are generated artifacts rendered from Supabase. All changes are in C:\dev\kit\gateway.

      ## Context
      Currently markdown files are canonical — API writes patch markdown, chokidar triggers
      Supabase sync. We want the reverse: all writes go to Supabase first, markdown is
      regenerated from Supabase on every contact update. ContactRegistry already loads from
      Supabase exclusively so that layer needs no changes.

      Caveat to document: direct markdown edits will be overwritten by the next
      Supabase→markdown render. All edits must go through API or MCP tools.

      ## 1. gateway/src/utils/markdown.ts
      Add url: string | null to ContactRow interface.
      Parse url from frontmatter in parseContactFile().
      Add new exported function:
        generateContactFile(contact: ContactRow, followUps: FollowUpRow[], interactions: InteractionRow[]): string
      It must produce a complete markdown file with:
      - YAML frontmatter block with all ContactRow fields (name, relationship_tier, frequency,
        last_contact, next_action, social_battery_cost, whatsapp_capture, origin_story,
        special_interests, sensitive_topics, preferred_channel, whatsapp_number, birthday,
        notes, url, linkedin_username, linkedin_capture, instagram_username, instagram_capture,
        whatsapp_groups — omit null/empty optional fields)
      - "# {name}" heading
      - "## Interaction Log" section with interactions newest-first, each as
        "**{date} — {channel}:** {notes}"
      - "**Follow-ups:**" section as a checklist, completed items struck through (~~text~~)

      ## 2. gateway/src/services/sync.ts
      REMOVE the chokidar watcher setup and the entire onMarkdownChange() handler.
      REMOVE the mdToDbGuard and dbToMdGuard loop-prevention logic.
      REMOVE the chokidar import and dependency.
      UPDATE onContactUpdate(): instead of patching specific frontmatter fields with
      setFrontmatterField(), fetch the contact's follow_ups and interaction_log rows from
      Supabase, then call generateContactFile() and write the full file to the correct
      People/ path.
      KEEP onInteractionInsert(), onFollowUpInsert(), onFollowUpUpdate() unchanged —
      they still write activity to markdown via prependInteractionEntry/appendFollowUp/
      completeFollowUp.

      ## 3. gateway/src/routes/api.ts — PUT /api/contacts/:id
      Current: find markdown file → setFrontmatterField loop → fs.writeFileSync → chokidar fires.
      New: validate fields → upsert changed fields to kit.contacts via Supabase → return 200.
      (The Realtime onContactUpdate() will fire and regenerate markdown automatically.)
      Remove ALL markdown file reads and writes from this handler.

      ## 4. gateway/src/services/contact-creator.ts
      Current: fs.writeFileSync(markdown) then supabase.upsert(contact).
      New: supabase.upsert(contact) first, then generateContactFile() → fs.writeFileSync(markdown).

      ## 5. gateway/src/types.ts
      Add url: string | null to TrackedContact.

      ## 6. gateway/src/services/contacts.ts
      Add url to the SELECT string in loadFromDatabase().
      Populate url: row.url ?? null on the TrackedContact object.

      ## 7. gateway/src/utils/markdown.test.ts
      Add tests for generateContactFile() — at minimum: round-trip test (parseContactFile →
      generateContactFile produces equivalent frontmatter), and empty interactions/followUps case.

      ## 8. One-time url backfill endpoint
      Add POST /api/contacts/backfill-url to api.ts (admin endpoint, no auth needed since
      gateway is local-only). It reads every People/*.md file, extracts the url frontmatter
      field if present, and upserts it to kit.contacts. Returns a summary of how many were
      updated. This is a one-shot migration; document it in the response.

      Run npm test in C:\dev\kit\gateway after each major step. All existing tests must
      remain green throughout.
    success_criteria: |
      npm test in C:\dev\kit\gateway exits 0.
      PUT /api/contacts/:id no longer reads or writes markdown files directly.
      onContactUpdate() in sync.ts calls generateContactFile() and writes the full file.
      chokidar is removed from sync.ts.
      url field present on TrackedContact and in loadFromDatabase() SELECT.
    needs_human_for:
      - supabase_realtime_not_firing_in_dev
      - people_directory_path_resolution_errors

  group-sweep:
    model: sonnet
    loop: ralph
    max_iterations: 8
    prompt: |
      Add group chat sweeping to the Kit gateway at C:\dev\kit.

      ## Context
      Kit's sweep currently only fetches 1:1 WhatsApp threads per contact. Contacts can
      have group JIDs assigned via the web UI (whatsapp_groups field), but this field is
      never read by the sweep pipeline. Wire it all the way through so assigned groups
      are swept alongside the 1:1 chat.

      ## Supabase migrations (apply via MCP to the kit project)
      1. ALTER TABLE kit.contacts ADD COLUMN IF NOT EXISTS whatsapp_groups text;
      2. CREATE TABLE IF NOT EXISTS kit.wa_group_sweep_state (
           contact_id      text        NOT NULL,
           group_jid       text        NOT NULL,
           last_swept_at   timestamptz NOT NULL,
           last_message_ts bigint      NOT NULL,
           messages_found  integer     NOT NULL DEFAULT 0,
           PRIMARY KEY (contact_id, group_jid)
         );

      ## Code changes

      gateway/src/types.ts:
      - Add `whatsapp_groups: string | null` to TrackedContact
      - Add `groupJid?: string` to ConversationThread

      gateway/src/services/contacts.ts:
      - Add whatsapp_groups to the Supabase SELECT string in loadFromDatabase()
      - Populate it on TrackedContact (null if absent)

      gateway/src/services/sweep-scheduler.ts:
      - Add private loadGroupWatermark(contactId, groupJid): Promise<number>
        Falls back to SWEEP_INITIAL_LOOKBACK_DAYS default. Queries kit.wa_group_sweep_state.
      - Add private saveGroupWatermark(contactId, groupJid, lastMessageTs, messagesFound): Promise<void>
        Upserts into kit.wa_group_sweep_state by (contact_id, group_jid).
      - In sweepContact(), after the existing 1:1 block:
        Parse contact.whatsapp_groups as comma-separated JIDs.
        For each group JID: loadGroupWatermark → fetchSince → tag threads with groupJid
        → processAndCommit → saveGroupWatermark.
        Fold group messagesFound and threadsProcessed into the existing ContactSweepResult totals.

      gateway/src/services/history-fetcher.ts: NO CHANGES — fetchSince already accepts any JID.

      ## Tests (gateway/src/services/sweep-scheduler.test.ts)
      - Contact with whatsapp_groups: "120@g.us" → fetchSince called twice (1:1 + group),
        both watermarks saved, counts aggregated correctly
      - Contact with whatsapp_groups: null → behaves exactly as before (no extra calls)

      ## Serialisation
      whatsapp_groups is a comma-separated string: "120@g.us, 121@g.us"
      Parse with: value.split(",").map(j => j.trim()).filter(Boolean)

      Run npm test in C:\dev\kit\gateway after each major change. All 212 existing tests
      must remain green.
    success_criteria: |
      npm test in C:\dev\kit\gateway exits 0.
      kit.wa_group_sweep_state table exists in Supabase.
      whatsapp_groups column exists on kit.contacts.
      sweepContact() calls fetchSince for each group JID in contact.whatsapp_groups.
    needs_human_for:
      - supabase_migration_errors
      - baileys_group_jid_format_changes

  commit-and-verify:
    model: sonnet
    loop: single
    prompt: |
      The gateway-api-expansion and web UI stages (web-scaffold through web-prod) completed
      but left changes uncommitted. Review and commit all staged work in C:\dev\kit.

      Changed files (from git status):
      - gateway/src/routes/api.ts — CORS + GET /api/contacts + PUT /api/contacts/:id + GET /api/groups proxy
      - gateway/src/index.ts — static serving of web/dist/
      - gateway/src/services/contacts.ts — contact update logic
      - pm2.config.cjs — pm2 entries
      - web/ — new Vite+React SPA (untracked)

      Steps:
      1. Run npm test in C:\dev\kit\gateway — must exit 0 before committing.
      2. Run npm run build in C:\dev\kit\web — must exit 0 before committing.
      3. Commit gateway changes: "feat: gateway-api-expansion — CORS, PUT contacts, groups proxy"
      4. Commit web changes: "feat: web UI scaffold and implementation (Vite+React)"
      5. If tests fail, fix them before committing.
    success_criteria: |
      git -C C:\dev\kit status --short shows no uncommitted changes.
      npm test in C:\dev\kit\gateway exits 0.
      npm run build in C:\dev\kit\web exits 0.
    needs_human_for:
      - test failures that require design decisions

  verify_contact_sync:
    model: haiku
    loop: single
    prompt: |
      Four contacts were added to People/ on 2026-05-02 but their Supabase
      sync via SyncService hasn't been verified. Confirm each one has a row
      in kit.contacts via the gateway's REST API.

      Contact IDs to verify:
      - say_keat_ooi   (People/2 - Active/Say Keat Ooi.md)
      - teng_chew_ooi  (People/2 - Active/Teng Chew Ooi.md)
      - peter_tan      (People/1 - Inner Circle/Peter Tan.md)
      - kat_osman      (People/1 - Inner Circle/Kat Osman.md)

      Method:
      1. Confirm Kit gateway is up: curl -fs http://127.0.0.1:3141/api/status
         If not, stop and escalate.
      2. Fetch contacts list: curl -fs http://127.0.0.1:3141/api/contacts
      3. Verify all 4 IDs appear in the response.
      4. If any are missing: do NOT manually insert them. Escalate — most
         likely the chokidar watcher missed the create, or frontmatter is
         malformed. The fix is to investigate sync.ts logs, not bypass it.

      No code modifications under any circumstances.
    success_criteria: |
      curl -fs http://127.0.0.1:3141/api/contacts | grep -oE '(say_keat_ooi|teng_chew_ooi|peter_tan|kat_osman)' | sort -u | wc -l
      returns 4
    needs_human_for:
      - gateway not running on 127.0.0.1:3141
      - any of the 4 contact IDs missing from the response

  daemon-groups-endpoint:
    model: sonnet
    loop: single
    prompt: |
      Add a GET /api/groups endpoint to the WhatsApp daemon at C:\dev\claude_whatsapp_integration.
      The endpoint should call Baileys' sock.groupFetchAllParticipating() and return an array of:
        [{ jid: string, name: string, participants: string[] }]
      where participants are phone numbers in international format (e.g. "+447700900123").
      Add the route in src/ following the existing routing pattern. Add a test. Run npm test.
    success_criteria: |
      npm test in C:\dev\claude_whatsapp_integration exits 0.
      A GET /api/groups route exists in the daemon source.
    needs_human_for:
      - baileys_api_breaking_changes

  gateway-api-expansion:
    model: sonnet
    loop: ralph
    max_iterations: 6
    prompt: |
      Expand the Kit gateway at C:\dev\kit\gateway with:
      1. CORS middleware allowing http://localhost:3143
      2. GET /api/contacts — list all contacts from the registry
      3. PUT /api/contacts/:id — update contact fields and write back to the markdown file
      4. GET /api/groups — proxy to daemon GET http://localhost:3142/api/groups
      Follow existing patterns in gateway/src/routes/api.ts. Run npm test after each change.
    success_criteria: |
      npm test in C:\dev\kit\gateway exits 0.
      All four additions exist in gateway/src/routes/api.ts.
    needs_human_for:
      - schema_changes

  web-scaffold:
    model: sonnet
    loop: single
    prompt: |
      Scaffold a Vite + React + TypeScript SPA at C:\dev\kit\web.
      - Run: npm create vite@latest web -- --template react-ts (inside C:\dev\kit)
      - Add a gateway API client at web/src/api/client.ts pointing to http://localhost:3141
      - Add react-router-dom. Create placeholder pages: Dashboard, Contacts, Groups, Captures, Sweep.
      - Add a nav sidebar linking all pages.
      - Configure vite.config.ts to proxy /api to http://localhost:3141 in dev.
      - Add kit-web entry to C:\dev\kit\pm2.config.cjs: runs `npm run preview` on port 3143.
      Run npm run build to verify it compiles.
    success_criteria: |
      C:\dev\kit\web exists with a working Vite+React app.
      npm run build in C:\dev\kit\web exits 0.
    needs_human_for: []

  web-contacts:
    model: sonnet
    loop: ralph
    max_iterations: 8
    prompt: |
      Implement the Contacts section of the Kit web UI at C:\dev\kit\web.
      - Contacts list: fetch GET /api/contacts, display name, tier, last_contact, next_action.
      - Contact detail: all fields editable via form, save via PUT /api/contacts/:id.
      - Group assignment: fetch GET /api/groups, show multi-select, save to whatsapp_groups field.
      Run npm run build to verify after each major change.
    success_criteria: |
      npm run build in C:\dev\kit\web exits 0.
      Contacts list and detail pages exist and call the gateway API.
    needs_human_for:
      - ux_design_decisions

  web-dashboard:
    model: sonnet
    loop: ralph
    max_iterations: 6
    prompt: |
      Implement the Dashboard and Captures pages of the Kit web UI at C:\dev\kit\web.
      - Dashboard: energy state widget (GET/POST /api/energy), today's contacts list.
      - Captures page: fetch pending captures, show approve/dismiss buttons.
      Run npm run build to verify.
    success_criteria: |
      npm run build exits 0. Dashboard and Captures pages are functional.
    needs_human_for: []

  web-sweep:
    model: sonnet
    loop: single
    prompt: |
      Implement the Sweep page of the Kit web UI at C:\dev\kit\web.
      - Trigger sweep button (POST /api/sweep).
      - Show last sweep result: contacts swept, threads processed, per-contact breakdown.
      - Auto-refresh status while sweep is in progress.
      Run npm run build to verify.
    success_criteria: |
      npm run build exits 0. Sweep page triggers the gateway sweep endpoint.
    needs_human_for: []

  web-prod:
    model: sonnet
    loop: single
    prompt: |
      Wire the Kit web UI into production.
      - In gateway/src/index.ts, serve web/dist/ statically at /.
      - Update pm2.config.cjs to remove the separate kit-web entry (now served by gateway).
      - Update CLAUDE.md to document the web UI and its build step (npm run build in web/).
      Verify http://localhost:3141 serves the React app. Gateway tests must still pass.
    success_criteria: |
      http://localhost:3141 serves the React app.
      npm test in C:\dev\kit\gateway exits 0.
    needs_human_for: []

  pwa:
    model: sonnet
    loop: ralph
    max_iterations: 6
    prompt: |
      Make the Kit web UI a Progressive Web App (PWA) so it can be installed on a phone
      from the browser. Full plan is in C:\dev\kit\docs\pwa-plan.md — read it first.

      ## Prerequisites (must be confirmed before starting)
      1. Confirm Cloudflare Tunnel is running and kit.yourdomain.com resolves to localhost:3141.
         If not, stop and escalate — this stage cannot complete without a public HTTPS endpoint.
      2. Confirm Cloudflare Access is protecting the URL (Google login gate).
         If not, stop and escalate — do not expose the gateway without auth.

      ## Code changes

      ### 1. gateway/src/index.ts — CORS
      Add the public domain (from env var PUBLIC_URL or hardcoded) to the CORS allowed origins
      alongside http://localhost:3143.

      ### 2. web/public/manifest.json — create
      {
        "name": "Kit",
        "short_name": "Kit",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#ffffff",
        "theme_color": "#000000",
        "icons": [
          { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
          { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
          { "src": "/icons/icon-180.png", "sizes": "180x180", "type": "image/png" }
        ]
      }

      ### 3. web/public/icons/ — create placeholder icons
      Generate simple solid-colour PNG icons at 192x192, 512x512, and 180x180 using
      the canvas API or a script. They can be plain coloured squares — the user will
      replace them later.

      ### 4. web/index.html — add meta tags
      <link rel="manifest" href="/manifest.json" />
      <link rel="apple-touch-icon" href="/icons/icon-180.png" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="theme-color" content="#000000" />

      ### 5. web/ — install and configure vite-plugin-pwa
      npm install -D vite-plugin-pwa workbox-window
      Add to vite.config.ts:
        import { VitePWA } from 'vite-plugin-pwa'
        plugins: [react(), VitePWA({
          registerType: 'autoUpdate',
          manifest: false,  // we manage manifest.json manually
          workbox: {
            runtimeCaching: [{
              urlPattern: /\/api\/.*/,
              handler: 'NetworkFirst',
              options: { cacheName: 'kit-api', networkTimeoutSeconds: 5 }
            }]
          }
        })]

      ### 6. Mobile UX audit
      Check all interactive elements are at least 44x44px touch targets.
      Check nothing overflows viewport width on a 390px screen.
      Add safe-area-inset padding to any fixed bottom elements.

      Run npm run build in C:\dev\kit\web after each major step. All gateway tests must
      remain green (npm test in C:\dev\kit\gateway).

    success_criteria: |
      npm run build in C:\dev\kit\web exits 0.
      npm test in C:\dev\kit\gateway exits 0.
      web/public/manifest.json exists with correct shape.
      vite-plugin-pwa is configured in web/vite.config.ts.
      Lighthouse PWA score >= 90 (run manually after deploy).
    needs_human_for:
      - cloudflare_tunnel_not_running
      - cloudflare_access_not_configured
      - icon_design (placeholder icons are fine to ship, user replaces later)
      - public_domain_not_yet_decided

web_ui_status:
  last_updated: 2026-06-07
  merged_prs:
    - pr: 1  note: "sweep activity report, gap warnings, daemon pin, contract tests"
    - pr: 3  note: "group chat sweeping + Supabase source of truth"
    - pr: 4  note: "chat window (POST /api/chat with 18 Kit tools) + contact History tab"
    - pr: 5  note: "chat moved to fixed right-side drawer panel (Maestro-style)"
    - pr: 6  note: "fix schema('kit') on GET /api/contacts/:id"
    - pr: 7  note: "fix contact name colour, active toggle, inactive filter"
    - pr: 8  note: "exclude inactive contacts from dashboard"
    - pr: 9  note: "add active field to TrackedContact and contacts SELECT"
    - pr: 10 note: "clickable contacts on dashboard"
    - pr: 11 note: "left-justify all text (body)"
    - pr: 12 note: "left-justify #root (Vite scaffold had text-align:center)"
    - pr: 13 note: "4-column layout — nav, contacts, detail, chat always visible"
    - pr: 14 note: "widen main content area (nav 130px, contacts 200px, chat 300px)"
    - pr: 15 note: "set main area to 800px"
    - pr: 16 note: "fix layout overflow — grid-template-columns 100px 160px 1fr 240px"
    - pr: 17 note: "Groups page, pre-fill selectedGroups from whatsapp_groups, contacts panel live-refresh on save"
  in_progress: []
next_actions:
  - label: phone-access
    summary: >
      Expose the Kit web UI (localhost:3141) remotely via a permanent Cloudflare
      Tunnel so it can be reached from phone or any device. Requires a free
      Cloudflare account, a named tunnel config, and a pm2 entry to keep the
      tunnel running alongside the gateway. The chat panel and full web UI should
      be usable on mobile without any code changes.
    notes: >
      Claude mobile app does not support MCP; the web chat panel (POST /api/chat)
      is the phone-friendly path. Temporary URL via `cloudflared tunnel --url
      http://localhost:3141` works today without an account — permanent URL needs
      a named tunnel and a Cloudflare account.
    phase: 2
    status: queued
blockers: []
human_tasks:
  - id: instagram_auth
    what: "Run `npm run login` in C:\\dev\\kit\\daemons\\instagram to create auth_state.json. Daemon will crash-loop until this is done."
    done: true
  - id: linkedin_auth
    what: "Verify LinkedIn daemon auth — check C:\\dev\\kit\\daemons\\linkedin has a valid session. Run `npm run login` if not."
    done: true
  - id: pm2_save
    what: "Run `pm2 save` from C:\\dev\\kit after all daemons are in their desired state (instagram/linkedin stopped or authed) to persist the process list for startup resurrection."
    done: true
  - id: verify_contact_sync_rerun
    what: "verify_contact_sync stage failed during migration (gateway was down). Gateway is now up — Orchestra should re-dispatch this stage automatically. If it fails again, check the People/ markdown files for the 4 contacts."
    done: true
  - id: whatsapp_groups_pr_merged
    what: "Merge the GET /api/groups PR from claude_whatsapp_integration before gateway-api-expansion dispatches — the gateway proxies to that endpoint."
    done: true
last_dispatch:
  task_id: "kit-0101187d"
  stage: "group-sweep"
  model: "sonnet"
  loop: "ralph"
  started: "2026-05-18T07:55:58"
  ended: "2026-05-18T08:17:07"
  result: "done"
  iterations_used: 1
  tokens: { input: 0, output: 0, cost_usd: 0 }
history:
  - stage: daemon-groups-endpoint
    result: skipped
    ended: 2026-05-16
    note: "GET /api/groups already shipped in claude_whatsapp_integration commit b503624 (2026-05-11). Stage was mis-scoped to C:\\dev\\kit; agent correctly refused. Work done; advanced directly to commit-and-verify."
  - stage: cleanup_phase11
    result: done
    ended: 2026-05-10
    note: "Debug logs stripped, Phase 11 fixes committed. Repo moved to C:\\dev\\kit."
---

# Kit — Relationship Manager

Kit is a conversational-first relationship management tool for neurodivergent users. It syncs WhatsApp conversations, maintains contact notes in markdown, and exposes tools via Claude Code slash commands and (in progress) a web UI.

## Current focus

Building a web UI (Vite + React) served from the Kit gateway, to allow contact management and group JID assignment without hand-editing markdown files.

## Architecture

```
Claude Code slash commands  +  Web UI (:3143)
              │                      │
              └──────────┬───────────┘
                         ▼
              Kit gateway (:3141)
                         │
            ┌────────────┼──────────────┐
            ▼            ▼              ▼
     Supabase       Open Brain    WhatsApp daemon
     (kit schema)  (ContextBinder)  (:3142, Baileys)
                                        │
                                    WhatsApp
```

- Gateway: `C:\dev\kit\gateway`
- WhatsApp daemon: `C:\dev\claude_whatsapp_integration`
- Both managed by pm2 (`C:\dev\kit\pm2.config.cjs`)
- `People/*.md` — gitignored contact markdown files (source of truth)

## Conventions (must follow)

- Supabase queries MUST chain `.schema('kit')` — tables live in `kit` schema, never `public`.
- Open Brain writes go through `ContextBinder.capture()` — never insert into `thoughts` directly.
- `whatsapp_capture` defaults to `disabled` per contact. Silent storage is a privacy bug.
- `People/` is gitignored — never commit it.
- No Baileys anywhere in Kit. Gateway is a REST client of the daemon on :3142.
