---
project: kit
display_name: "Kit — Relationship Manager"
owner: seang
status: active
priority: 2
created: 2026-04-01
last_reviewed: 2026-05-13

permissions: bypassPermissions
max_concurrent_agents: 1
shared_resources:
  - whatsapp_daemon
  - port_3141
  - port_3142

current_stage: verify_contact_sync

stages:
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

next_actions: []
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
  task_id: "kit-80edbfaf"
  stage: "web-prod"
  model: "sonnet"
  loop: "single"
  started: "2026-05-13T08:42:51"
  ended: "2026-05-13T08:46:34"
  result: "done"
  iterations_used: 1
  tokens: { input: 0, output: 0, cost_usd: 0 }
history:
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
