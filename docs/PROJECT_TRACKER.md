---
project: kit
display_name: "Kit — Relationship Manager"
owner: seang
status: active
priority: 2
created: 2026-04-01
last_reviewed: 2026-06-13

permissions: bypassPermissions
max_concurrent_agents: 1
shared_resources:
  - whatsapp_daemon
  - port_3141
  - port_3142

current_stage: supabase-source-of-truth

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

  kit-memories:
    model: sonnet
    loop: ralph
    max_iterations: 8
    prompt: |
      Add a persistent memory system to the Kit gateway at C:\dev\kit using pgvector
      and Supabase's built-in gte-small embedding model.

      ## Context
      Kit's web chat panel (POST /api/chat) currently uses a bare system prompt with no
      memory of past conversations or learned facts. This stage adds a kit.memories table
      to Supabase, a Supabase Edge Function for generating embeddings via gte-small (free,
      no external API needed), a MemoryStore service in the gateway, and wires it into the
      chat pipeline so the assistant gets smarter over time.

      The Supabase project is popxesemindihcbedegy (same project used for kit and open-brain).
      The gateway is at C:\dev\kit\gateway. Apply all Supabase changes via the Supabase MCP.

      ## Step 1 — Supabase migration
      Apply via MCP (project_id: popxesemindihcbedegy):

        CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

        CREATE TABLE IF NOT EXISTS kit.memories (
          id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
          contact_id  text        REFERENCES kit.contacts(id) ON DELETE CASCADE,
          category    text        NOT NULL CHECK (category IN (
                        'contact_fact', 'life_event', 'preference', 'interaction_insight')),
          content     text        NOT NULL,
          source      text        NOT NULL CHECK (source IN ('chat', 'sweep', 'manual')),
          embedding   extensions.vector(384),
          created_at  timestamptz DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS memories_embedding_idx
          ON kit.memories USING ivfflat (embedding extensions.vector_cosine_ops)
          WITH (lists = 100);
        CREATE INDEX IF NOT EXISTS memories_contact_idx ON kit.memories (contact_id);
        CREATE INDEX IF NOT EXISTS memories_category_idx ON kit.memories (category);

      Verify: query information_schema.columns for kit.memories and confirm embedding column exists.

      ## Step 2 — Supabase Edge Function: embed
      Deploy function named "kit-embed" to project popxesemindihcbedegy (verify_jwt: false —
      called server-side from the gateway with the service key).

        import "jsr:@supabase/functions-js/edge-runtime.d.ts";

        const session = new Supabase.ai.Session('gte-small');

        Deno.serve(async (req: Request) => {
          const { texts } = await req.json();
          const embeddings = await Promise.all(
            (texts as string[]).map((t: string) =>
              session.run(t, { mean_pool: true, normalize: true })
            )
          );
          return new Response(JSON.stringify({ embeddings }), {
            headers: { 'Content-Type': 'application/json' }
          });
        });

      Verify: invoke with { texts: ["hello world"] } and confirm response is array of 384 numbers.

      ## Step 3 — Gateway MemoryStore service
      Create gateway/src/services/memory-store.ts:

      - Constructor takes supabaseClient and supabaseUrl + serviceKey (for Edge Function call)
      - remember(content, category, source, contactId?): Promise<void>
        Calls kit-embed Edge Function to get embedding, inserts row into kit.memories
      - search(query, opts?: { contactId?: string; limit?: number }): Promise<Memory[]>
        Embeds the query, runs cosine similarity search:
          SELECT id, contact_id, category, content, source, created_at,
                 1 - (embedding <=> $1::vector) AS similarity
          FROM kit.memories
          WHERE ($2::text IS NULL OR contact_id = $2)
          ORDER BY embedding <=> $1::vector
          LIMIT $3
        Returns rows with similarity > 0.5 only.
      - Export interface Memory { id, contactId, category, content, source, similarity, createdAt }

      Add unit tests in gateway/src/services/memory-store.test.ts.
      Run npm test in C:\dev\kit\gateway — all existing tests must stay green.

      ## Step 4 — Wire into /api/chat: system prompt enrichment (read)
      In gateway/src/routes/api.ts, in the POST /api/chat handler:
      - Before the Anthropic API call, call memoryStore.search(lastUserMessage, { limit: 6 })
      - Also if any contact name is mentioned in the message, call
        memoryStore.search(lastUserMessage, { contactId, limit: 4 }) for that contact
      - Prepend results to the system prompt as:
          ## What Kit remembers
          - [category] content (source, date)
          ...
      - If no memories found, omit the section entirely (don't add empty block)

      ## Step 5 — Wire into /api/chat: memory capture (write)
      After each successful assistant response turn:
      - Make a second fast Claude call (haiku, max_tokens: 256) with prompt:
          "Extract new facts about the user or their contacts from this exchange.
           Output one fact per line as: [category]|[contact_name or 'user']|fact
           Only extract genuinely new information. If nothing new, output NONE."
      - Parse the response, look up contact_id from name if needed, call remember() for each fact
      - Do this asynchronously — do not await it before returning the chat response

      ## Step 6 — REST endpoints for Claude Code access
      Add to gateway/src/routes/api.ts:
      - POST /api/memories  body: { content, category, source, contactId? }
        Calls memoryStore.remember() and returns { ok: true }
      - GET /api/memories/search?q=...&contactId=...&limit=...
        Calls memoryStore.search() and returns the Memory array

      ## Step 7 — Open Brain search endpoint (optional feature)
      Open Brain is personal infrastructure — disabled by default, enabled only when
      OPEN_BRAIN_URL is present in .env. This allows the feature to be turned off
      simply by removing the env var, and ensures new users who have no Open Brain
      instance are unaffected.

      In gateway/src/index.ts (or config):
      - Add: const OPEN_BRAIN_ENABLED = Boolean(process.env.OPEN_BRAIN_URL)
      - Export this flag so routes and services can check it

      Add to gateway/src/routes/api.ts:
      - GET /api/openbrain/search?q=...&limit=...
        If !OPEN_BRAIN_ENABLED: return { results: [], enabled: false } immediately
        Otherwise: query the Open Brain thoughts table (OPEN_BRAIN_URL + OPEN_BRAIN_SERVICE_KEY).
        First check the actual column structure of the thoughts table via Supabase MCP.
        If embedding column exists: embed query via kit-embed, run cosine similarity search.
        If no embedding column: fall back to Postgres full-text search on content column.
        Returns { results: [{ id, content, createdAt, similarity? }], enabled: true }
      - GET /api/openbrain/status
        Returns { enabled: OPEN_BRAIN_ENABLED } — lets Claude Code and the web UI know
        whether Open Brain is wired up without making a search call

      ## Step 8 — Include Open Brain in chat system prompt (guarded)
      In the POST /api/chat handler:
      - Only query /api/openbrain/search if OPEN_BRAIN_ENABLED is true
      - If results exist and similarity > 0.4, append under system prompt heading:
          ## From Open Brain (raw captures)
          - content (date)
          ...
      - If OPEN_BRAIN_ENABLED is false, skip entirely — no empty section, no error

      ## Final checks
      Run npm test in C:\dev\kit\gateway — must exit 0.
      Run npm run build in C:\dev\kit\web — must exit 0.
      Commit all gateway changes. Do not commit .env or People/.

    success_criteria: |
      npm test in C:\dev\kit\gateway exits 0.
      kit.memories table exists with embedding vector(384) column.
      kit-embed Edge Function returns 384-dim array for test input.
      POST /api/chat response improves when a relevant memory exists.
      POST /api/memories stores a row; GET /api/memories/search retrieves it.
      GET /api/openbrain/search returns results from the thoughts table.
    needs_human_for:
      - supabase_edge_function_cold_start_errors
      - pgvector_ivfflat_index_requires_rows_before_querying
      - open_brain_thoughts_schema_unknown (agent must check via Supabase MCP before implementing Step 7)

  kit-send:
    model: sonnet
    loop: ralph
    max_iterations: 6
    prompt: |
      Add WhatsApp send capability to the Kit gateway and web UI at C:\dev\kit.

      ## Context
      The WhatsApp daemon at C:\dev\claude_whatsapp_integration already has a working
      POST /api/send endpoint (port 3142) that accepts:
        { "messages": [{ "to": "+447700900123", "text": "Hey!" }] }
      and returns { results: [{ to, status, messageId }] }.

      The gateway (port 3141) deliberately omitted this in v0. This stage adds it back
      as a proxied gateway endpoint, exposes it as a chat tool, and adds a Send button
      to the contact detail page in the web UI with a confirm-before-send step.

      ## Step 1 — Gateway proxy: POST /api/send
      In gateway/src/routes/api.ts, add a proxy route following the same pattern as
      the existing GET /api/groups proxy:
      - POST /api/send
      - Body: { to: string (E.164), text: string }
      - Validates with zod: to must match /^\+[1-9]\d{6,14}$/, text must be non-empty string
      - Proxies to http://localhost:3142/api/send as { messages: [{ to, text }] }
      - Returns { ok: true, messageId } on success
      - Returns 503 if daemon returns whatsapp_not_initialised
      - Returns 502 for other daemon errors

      ## Step 2 — Chat tool: kit-send-message
      In the CHAT_TOOLS array and the tool handler switch in gateway/src/routes/api.ts:
      - Add tool: name "kit-send-message", description "Send a WhatsApp message to a contact.",
        input_schema: { contact_name: string, text: string }
      - Handler: look up contact by name in the registry, get their whatsapp number,
        POST to /api/send internally, return { ok, messageId } or clear error message
      - If contact has no WhatsApp number, return an error — do not attempt to send
      - If daemon is not connected, return a clear error message

      ## Step 3 — Web UI: Send button on ContactDetail
      In web/src/pages/ContactDetail.tsx:
      - Add a "Send Message" section below the Save button, only shown if contact.whatsapp is set
      - Textarea for composing the message (pre-populated if a draft is passed via location state)
      - "Send via WhatsApp" button — disabled while sending
      - Confirm step: clicking Send shows an inline confirmation "Send to [name] on WhatsApp?" 
        with Confirm / Cancel buttons before actually calling POST /api/send
      - On success: show "Sent ✓" and clear the textarea
      - On error: show the error message in red

      Add api.post() to web/src/api/client.ts if not already present (it is).

      ## Step 4 — Tests
      Add tests in gateway/src/routes/api.test.ts (or a new send.test.ts) covering:
      - POST /api/send with valid body proxies to daemon and returns messageId
      - POST /api/send with missing/invalid E.164 returns 400
      - POST /api/send when daemon returns 503 returns 503

      Run npm test in C:\dev\kit\gateway — all tests must pass.
      Run npm run build in C:\dev\kit\web — must exit 0.

    success_criteria: |
      npm test in C:\dev\kit\gateway exits 0.
      npm run build in C:\dev\kit\web exits 0.
      POST /api/send on the gateway proxies to the daemon and returns a messageId.
      kit-send-message tool exists in the CHAT_TOOLS list.
      ContactDetail shows a Send section with confirm step when contact has a WhatsApp number.
    needs_human_for:
      - daemon_not_connected (Baileys session expired — user must re-pair)
      - send_failures_due_to_rate_limiting

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
  last_updated: 2026-06-13
  merged_prs:
    - {pr: 1,  note: "sweep activity report, gap warnings, daemon pin, contract tests"}
    - {pr: 3,  note: "group chat sweeping + Supabase source of truth"}
    - {pr: 4,  note: "chat window (POST /api/chat with 18 Kit tools) + contact History tab"}
    - {pr: 5,  note: "chat moved to fixed right-side drawer panel (Maestro-style)"}
    - {pr: 6,  note: "fix schema('kit') on GET /api/contacts/:id"}
    - {pr: 7,  note: "fix contact name colour, active toggle, inactive filter"}
    - {pr: 8,  note: "exclude inactive contacts from dashboard"}
    - {pr: 9,  note: "add active field to TrackedContact and contacts SELECT"}
    - {pr: 10, note: "clickable contacts on dashboard"}
    - {pr: 11, note: "left-justify all text (body)"}
    - {pr: 12, note: "left-justify #root (Vite scaffold had text-align:center)"}
    - {pr: 13, note: "4-column layout — nav, contacts, detail, chat always visible"}
    - {pr: 14, note: "widen main content area (nav 130px, contacts 200px, chat 300px)"}
    - {pr: 15, note: "set main area to 800px"}
    - {pr: 16, note: "fix layout overflow — grid-template-columns 100px 160px 1fr 240px"}
    - {pr: 17, note: "Groups page, pre-fill selectedGroups from whatsapp_groups, contacts panel live-refresh on save"}
    - {pr: 18, note: "widen chat column 340px->480px, ContactDetail maxWidth 560->820px"}
    - {pr: 19, note: "remove 1126px #root width cap — app now spans full viewport"}
    - {pr: 20, note: "widen contacts panel column 140px->200px"}
    - {pr: 21, note: "widen chat column 340px->480px"}
  in_progress: []

next_actions:
  - label: kit-memories
    summary: >
      Add a kit.memories table (pgvector, gte-small embeddings via Supabase Edge Function)
      so the web chat builds up a persistent memory of contacts and the user's life.
      Web chat reads and writes automatically. Claude Code uses its own memory files
      by default; can query kit.memories on request via GET /api/memories/search.
    steps:
      - Supabase migration: enable pgvector, create kit.memories (id, contact_id, category, content, source, embedding vector(384), created_at)
      - Deploy Edge Function embed — Supabase gte-small, takes texts[], returns embeddings[]
      - Gateway MemoryStore service — remember() and search() methods
      - Wire search into /api/chat system prompt enrichment (read before Claude call)
      - Wire capture into /api/chat response (extract + store new facts after each turn)
      - Add POST /api/memories and GET /api/memories/search for Claude Code access
    verification:
      - pgvector enabled + kit.memories columns confirmed via SQL
      - embed Edge Function returns 384-dim vector for test input
      - MemoryStore unit tests green, npm test passes
      - Chat: store "Mark works at Corgi", ask "where does Mark work?" — response mentions Corgi
      - Chat: say "I got a dog", query kit.memories — row with source=chat appears
    phase: 3
    status: queued

  - label: phone-access
    summary: >
      Two parts: (A) Cloudflare Tunnel — human task, exposes localhost:3141 at a
      permanent HTTPS URL with Cloudflare Access (Google login gate). (B) PWA —
      manifest.json, vite-plugin-pwa service worker, iOS meta tags, mobile UX pass.
      Result: install Kit from browser on any device, opens full-screen like a native app.
    steps:
      - "[human] Install cloudflared, create named tunnel → localhost:3141, add pm2 entry"
      - "[human] Configure Cloudflare Access (Google login gate)"
      - "web/public/manifest.json + icons (192, 512, 180px)"
      - "vite-plugin-pwa + workbox NetworkFirst for /api/*"
      - "index.html meta tags for iOS standalone install"
      - "Mobile UX pass: 44px touch targets, no overflow at 390px"
    needs_human_for:
      - cloudflare_tunnel_setup
      - domain_name_decision
    phase: 3
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
  task_id: "kit-1d250908"
  stage: "group-sweep"
  model: "sonnet"
  loop: "ralph"
  started: "2026-06-14T12:02:56"
  ended: "2026-06-14T12:04:11"
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
