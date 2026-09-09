# Kit — Future Work

v1.0 scope is deliberately narrow. Items here are deferred, not rejected.

## v1.1 — Claude Desktop / portable MCP

**Today:** v1.0 slash commands live in `.claude/commands/*.md` — they only work in Claude Code.

**Future:** Migrate to MCP prompts exposed by the Kit gateway's MCP server ([gateway/src/mcp/server.ts](../gateway/src/mcp/server.ts)). Benefits:

- Works in Claude Desktop, Claude Code, or any MCP-capable client
- Single source of truth (no duplication between command file and tool)
- Easier to distribute as a product (user installs the MCP server once)

**Trigger to do this work:** Kit is moving from "working for me" to "ready to share with one other user."

**Rough plan when the time comes:**
1. Export each `.claude/commands/kit-*.md` as an MCP prompt in `server.ts`
2. Publish the gateway as an npm package or bundled executable
3. Write install docs for Claude Desktop
4. Keep the Claude Code command files as thin wrappers (or delete if MCP prompts cover them)

## v1.2 — Incoming message hook in the daemon

The `claude_whatsapp_integration` migration doc notes the `WA_INCOMING_HOOK_URL` push is not yet implemented on the daemon side. Until it lands, live capture can't fire automatically — sweep-based capture (polled every `SWEEP_INTERVAL_HOURS`) is the fallback.

Once the daemon supports the hook, no Kit-side changes needed; the gateway endpoint is already built in Phase 1.

## v2.0 — Mobile app

Spec §7.1 mentions a future Expo/React Native app. The original v0 Expo code is preserved in [old/expo-app/](../old/expo-app/) as a starting point if this ever happens. True push notifications for birthdays, drift, and energy would land here.

## Multi-product WhatsApp daemon sharing

v1.0 uses a dedicated `claude_whatsapp_integration` instance for Kit (port 3142, `auth_state/kit/`). If a second product also using Baileys ever needs to run alongside, consider:

- WhatsApp Web's ~4 linked-devices-per-number limit will force this sooner rather than later if two products ship
- Refactor the daemon to multiplex — it accepts multiple consumer apps over REST, and each app manages its own tracked-contact list
- Auth_state stays single-tenant (one WhatsApp number per daemon), but consumers are separate

Not worth doing until there's a second real consumer.

## Productising Kit

If Kit becomes a product:
- Installer bundles the gateway + the dedicated daemon
- First-run setup walks the user through the WhatsApp pairing code
- People folder location becomes configurable, not hardcoded to `projects/kit/People/`
- Open Brain instance becomes user-configurable (spec §5.8 already flags this)
- Licensing / update mechanism / telemetry-opt-in decisions

## Rejected: Supabase as the sole source of truth

Unlike everything above, this one is **rejected, not deferred** — recorded here so
the reasoning is not rediscovered from scratch.

In May 2026 a branch (`supabase-source-of-truth`) flipped the sync direction. All
writes went to Supabase first, and `People/*.md` became a pure render target:
`sync.ts` dropped the chokidar watcher entirely, and a `contacts` UPDATE regenerated
the whole markdown file from DB rows via Realtime.

**What survived:** `generateContactFile()`, the `url` field end-to-end, and the
render-a-file-from-DB-rows machinery — all of which are in `main` today and are what
`POST /api/contacts/backfill-missing-md` is built on.

**What was rejected:** the one-way direction. Making markdown a render target means
you can no longer edit a contact by typing in the file, which is the interaction the
tool exists to support — a hand-edit would be silently overwritten on the next
Realtime event. `main` therefore keeps bidirectional sync with `People/*.md` as source
of truth and the 3-second loop-prevention guard per contact on each direction.

**If this is revisited,** the thing to solve first is hand-edits: either the file
stops being editable (and something else becomes the fast capture path), or writes
from the file keep winning. The 2026 branches were deleted once this note existed.
