/**
 * REST API Routes — Kit Gateway
 *
 * v1.0: Kit is a REST client of the dedicated claude_whatsapp_integration
 * daemon. The gateway no longer manages its own Baileys connection.
 *
 * Removed from v0: /auth/status, /send, /debug/store (all Baileys-specific).
 * Added: POST /api/incoming-message (daemon push endpoint).
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Router, Request, Response } from "express";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { ContactRegistry } from "../services/contacts.js";
import { MessageRouter } from "../services/message-router.js";
import { CapturePipeline } from "../services/capture.js";
import { SweepScheduler } from "../services/sweep-scheduler.js";
import { ImportIngestor } from "../services/import-ingestor.js";
import { ContactCreator, type CreateContactInput } from "../services/contact-creator.js";
import { buildWhatsAppLink, isValidE164 } from "../utils/wa-link.js";
import { normaliseMessages, toJid, type RawDaemonMessage } from "../utils/wa-messages.js";
import { parseContactFile } from "../utils/markdown.js";
import type { CaptureMode, Channel, GatewayStatus, TrackedContact } from "../types.js";
import { EnergyService } from "../services/energy.js";
import { MemoryStore } from "../services/memory-store.js";
// Lazy import — mcp/tools.ts calls requireEnv() at module load;
// importing it lazily avoids failures in test environments where env vars aren't set.
let _kitTools: typeof import("../mcp/tools.js") | null = null;
async function kitTools() {
  if (!_kitTools) _kitTools = await import("../mcp/tools.js");
  return _kitTools;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PEOPLE_DIR = path.resolve(__dirname, "..", "..", "..", "People");

const TIER_DIRS = [
  { dir: "1 - Inner Circle", tier: 1 },
  { dir: "2 - Active", tier: 2 },
  { dir: "3 - Business Contact", tier: 3 },
];

export function createApiRouter(
  contacts: ContactRegistry,
  router: MessageRouter,
  capture: CapturePipeline,
  sweep: SweepScheduler,
  importIngestor: ImportIngestor,
  startedAt: number
): Router {
  const api = Router();
  const creator = new ContactCreator(contacts);
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
  const memoryStore = new MemoryStore(supabase, config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
  const OPEN_BRAIN_ENABLED = Boolean(config.OPEN_BRAIN_URL);

  // ── Health / status ──────────────────────────────────────

  api.get("/status", async (_req: Request, res: Response) => {
    const ext = await fetch(`${config.EXTERNAL_GATEWAY_URL}/api/status`)
      .then((r) => r.json() as Promise<{ connection?: string }>)
      .catch(() => ({ connection: "unavailable" }));

    const last = sweep.getLastResult();
    const next = sweep.getNextSweepAt();
    const status: GatewayStatus = {
      connection: (ext.connection ?? "unavailable") as GatewayStatus["connection"],
      trackedContacts: contacts.size,
      activeThreads: router.activeThreadCount,
      pendingCaptures: capture.pendingCount,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      lastSweep: last?.completedAt ?? null,
      nextSweep: next?.toISOString() ?? null,
    };
    res.json(status);
  });

  // ── Incoming message push (from the WhatsApp daemon) ────

  const incomingMsgSchema = z.object({
    remoteJid: z.string().min(1),
    fromMe: z.boolean(),
    body: z.string(),
    timestamp: z.number(),
    messageId: z.string(),
  });

  api.post("/incoming-message", (req: Request, res: Response) => {
    const parsed = incomingMsgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.issues });
      return;
    }
    router.handleMessage(parsed.data);
    res.json({ ok: true });
  });

  // ── Deep link ────────────────────────────────────────────

  const linkSchema = z.object({
    number: z.string(),
    message: z.string().optional(),
  });

  api.post("/deep-link", (req: Request, res: Response) => {
    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    try {
      const url = buildWhatsAppLink(parsed.data.number, parsed.data.message);
      res.json({ url });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Contact management ───────────────────────────────────

  api.get("/contacts", (_req: Request, res: Response) => {
    res.json(contacts.getAll());
  });

  api.get("/contacts/:id", async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const [contactRes, interactionsRes, followUpsRes] = await Promise.all([
      supabase.schema("kit").from("contacts").select("*").eq("id", id).single(),
      supabase.schema("kit").from("interaction_log").select("id, date, notes, channel, group_jid, group_name").eq("contact_id", id).order("date", { ascending: false }).limit(20),
      supabase.schema("kit").from("follow_ups").select("id, text, completed, created_at").eq("contact_id", id).order("completed").order("created_at", { ascending: false }),
    ]);
    if (!contactRes.data) { res.status(404).json({ error: "contact_not_found" }); return; }
    res.json({ contact: contactRes.data, interactions: interactionsRes.data ?? [], followUps: followUpsRes.data ?? [] });
  });

  api.post("/contacts/refresh", async (_req: Request, res: Response) => {
    const count = await contacts.loadFromDatabase();
    res.json({ ok: true, count });
  });

  /**
   * Reconcile each contact's group membership from the daemon.
   *
   * whatsapp_groups drives the group branch of the sweep, and as a manual
   * field it stayed empty for every contact — so that branch never ran.
   * `dry_run` reports what would change without writing.
   */
  api.post("/contacts/sync-groups", async (req: Request, res: Response) => {
    const dryRun = req.body?.dry_run === true;
    // Optional partial-name filter, so membership can be switched on for one
    // contact at a time rather than all of them at once.
    const only = typeof req.body?.contact_name === "string"
      ? req.body.contact_name.toLowerCase()
      : null;
    const results: Array<{ contact: string; groups: string[]; changed: boolean }> = [];

    try {
      for (const contact of contacts.getAll()) {
        if (!contact.whatsapp) continue;
        if (only && !contact.name.toLowerCase().includes(only)) continue;

        const identifier = contact.whatsapp.replace(/\s+/g, "");
        const response = await fetch(
          `${config.EXTERNAL_GATEWAY_URL}/api/contacts/${encodeURIComponent(identifier)}/chats`
        );
        if (!response.ok) continue;

        const body = (await response.json()) as { chats?: Array<{ chatJid: string }> };
        const jids = (body.chats ?? [])
          .map((c) => c.chatJid)
          .filter((j) => j.endsWith("@g.us"))
          .sort();

        const next = jids.join(",");
        const changed = next !== (contact.whatsapp_groups ?? "");
        results.push({ contact: contact.name, groups: jids, changed });

        if (changed && !dryRun) {
          const { error } = await supabase
            .schema("kit")
            .from("contacts")
            .update({ whatsapp_groups: next || null })
            .eq("id", contact.id);
          if (error) throw new Error(`${contact.name}: ${error.message}`);
        }
      }

      if (!dryRun && results.some((r) => r.changed)) await contacts.loadFromDatabase();

      res.json({
        ok: true,
        dryRun,
        contactsChecked: results.length,
        contactsChanged: results.filter((r) => r.changed).length,
        totalGroupLinks: results.reduce((n, r) => n + r.groups.length, 0),
        results,
      });
    } catch (err: any) {
      res.status(502).json({ error: "sync_failed", detail: err.message });
    }
  });

  // Create a new contact: writes markdown, upserts Supabase, registers in
  // live ContactRegistry — all in one request so the contact is immediately
  // usable without a gateway restart or waiting for chokidar to fire.
  const createContactSchema = z.object({
    name: z.string().min(1),
    tier: z.number().int().min(1).max(3),
    frequency: z.string().min(1),
    whatsapp: z.string().optional(),
    whatsapp_capture: z.enum(["enabled", "disabled"]).optional(),
    wa_capture: z.enum(["auto", "on_demand", "off"]).optional(),
    origin_story: z.string().optional(),
    notes: z.string().optional(),
    social_battery_cost: z.string().optional(),
  });

  api.post("/contacts/create", async (req: Request, res: Response) => {
    const parsed = createContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.issues });
      return;
    }
    try {
      const result = await creator.create(parsed.data as CreateContactInput);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        res.status(409).json({ error: "already_exists", detail: err.message });
      } else {
        res.status(500).json({ error: "create_failed", detail: err.message });
      }
    }
  });

  // Name → JID resolver. Used by the WhatsApp daemon's NameResolver hook
  // when a ZIP-export filename can't be matched against the daemon's own
  // chats table — Kit's contact registry is the second-chance lookup.
  const resolveNameSchema = z.object({ name: z.string().min(1) });

  api.post("/contacts/resolve-name", (req: Request, res: Response) => {
    const parsed = resolveNameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.issues });
      return;
    }
    const contact = contacts.findByName(parsed.data.name);
    if (!contact) {
      res.json({ jid: null, contactId: null });
      return;
    }
    res.json({ jid: contacts.jidFor(contact), contactId: contact.id });
  });

  // ── Social channel incoming messages (from LinkedIn/Instagram daemons) ──
  // Daemons call this endpoint with scraped messages for a tracked contact.
  // Messages are routed through the same inactivity-timer capture pipeline
  // as WhatsApp, but keyed by "{channel}:{contactId}" instead of JID.

  const channelIncomingSchema = z.object({
    contactId: z.string().uuid(),
    channel: z.enum(["linkedin", "instagram"]),
    messages: z.array(
      z.object({
        fromMe: z.boolean(),
        body: z.string(),
        timestamp: z.number(),
        messageId: z.string(),
      })
    ).min(1),
  });

  api.post("/channels/incoming", (req: Request, res: Response) => {
    const parsed = channelIncomingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.issues });
      return;
    }
    const { contactId, channel, messages } = parsed.data;
    const ok = router.handleChannelMessages(contactId, channel as Channel, messages);
    if (!ok) {
      res.status(404).json({ error: "contact_not_found_or_capture_disabled" });
      return;
    }
    res.json({ ok: true, buffered: messages.length });
  });

  // ── ZIP import completion (from the WhatsApp daemon) ─────
  // The daemon calls this after a successful "Export Chat" ZIP import.
  // Kit then pulls the new messages from the daemon and routes them
  // through MessageRouter so the user gets a /kit-captures review card.

  const zipImportSchema = z.object({
    chatJid: z.string().min(1),
    imported: z.number().int().nonnegative().optional(),
    duplicates: z.number().int().nonnegative().optional(),
    textFile: z.string().optional(),
  });

  api.post("/zip-import-complete", async (req: Request, res: Response) => {
    const parsed = zipImportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.issues });
      return;
    }
    try {
      const result = await importIngestor.ingest(parsed.data.chatJid);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(502).json({ error: "ingest_failed", detail: err.message });
    }
  });

  const registerSchema = z.object({
    id: z.string(),
    name: z.string(),
    whatsapp: z.string().refine(isValidE164, "Must be E.164 format"),
    tier: z.number().int().min(1).max(3),
    wa_capture: z.enum(["auto", "on_demand", "off"]).default("on_demand"),
    frequency: z.enum([
      "Weekly", "Fortnightly", "Monthly", "Bi-monthly", "Quarterly", "Twice Yearly", "Annual",
    ]),
    last_contact: z.string(),
  });

  api.post("/contacts/register", (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid contact", details: parsed.error.issues });
      return;
    }
    contacts.register(parsed.data as TrackedContact);
    res.json({ ok: true });
  });

  api.delete("/contacts/:id", (req: Request, res: Response) => {
    const removed = contacts.unregister(req.params["id"] as string);
    res.json({ ok: removed });
  });

  const updateContactSchema = z.object({
    tier: z.number().int().min(1).max(3).optional(),
    frequency: z.string().min(1).optional(),
    whatsapp: z.string().optional(),
    whatsapp_capture: z.enum(["enabled", "disabled"]).optional(),
    wa_capture: z.enum(["auto", "on_demand", "off"]).optional(),
    last_contact: z.string().optional(),
    notes: z.string().optional(),
    social_battery_cost: z.string().optional(),
    linkedin_username: z.string().optional(),
    linkedin_capture: z.enum(["enabled", "disabled"]).optional(),
    instagram_username: z.string().optional(),
    instagram_capture: z.enum(["enabled", "disabled"]).optional(),
    whatsapp_groups: z.string().optional(),
    url: z.string().optional(),
    active: z.boolean().optional(),
  });

  api.put("/contacts/:id", async (req: Request, res: Response) => {
    const id = req.params["id"] as string;
    const contact = contacts.getById(id);
    if (!contact) {
      res.status(404).json({ error: "contact_not_found" });
      return;
    }
    const parsed = updateContactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.issues });
      return;
    }
    const fields = parsed.data;

    const { error } = await supabase
      .schema("kit")
      .from("contacts")
      .update(fields)
      .eq("id", id);

    if (error) {
      res.status(500).json({ error: "db_update_failed", detail: error.message });
      return;
    }

    Object.assign(contact, fields);
    if (fields.wa_capture) contacts.setCaptureMode(id, fields.wa_capture as CaptureMode);

    res.json({ ok: true });
  });

  // ── URL backfill (one-shot migration) ────────────────────
  // Reads existing People/*.md files and writes any url frontmatter field
  // found to kit.contacts. Run once after deploying this change.

  api.post("/contacts/backfill-url", async (_req: Request, res: Response) => {
    let updated = 0;
    let skipped = 0;
    for (const { dir, tier } of TIER_DIRS) {
      const tierPath = path.join(PEOPLE_DIR, dir);
      if (!fs.existsSync(tierPath)) continue;
      for (const file of fs.readdirSync(tierPath).filter((f) => f.endsWith(".md"))) {
        try {
          const { contact } = parseContactFile(path.join(tierPath, file), tier);
          if (!contact.url) { skipped++; continue; }
          await supabase.schema("kit").from("contacts")
            .update({ url: contact.url }).eq("id", contact.id);
          updated++;
        } catch { skipped++; }
      }
    }
    res.json({ ok: true, updated, skipped });
  });

  // ── Capture mode ─────────────────────────────────────────

  const captureModeSchema = z.object({
    mode: z.enum(["auto", "on_demand", "off"]),
  });

  api.put("/contacts/:id/capture-mode", (req: Request, res: Response) => {
    const parsed = captureModeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid mode", details: parsed.error.issues });
      return;
    }
    const ok = contacts.setCaptureMode(req.params["id"] as string, parsed.data.mode as CaptureMode);
    res.json({ ok });
  });

  // ── Capture pipeline controls ────────────────────────────

  api.post("/capture/:contactId", async (req: Request, res: Response) => {
    try {
      const ok = await router.triggerCapture(req.params["contactId"] as string);
      if (!ok) {
        res.status(404).json({ error: "No active thread for this contact" });
        return;
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: "Capture failed", detail: err.message });
    }
  });

  api.post("/capture/:contactId/message/:messageId", async (req: Request, res: Response) => {
    try {
      const ok = await router.captureSingleMessage(
        req.params["contactId"] as string,
        req.params["messageId"] as string
      );
      res.json({ ok });
    } catch (err: any) {
      res.status(500).json({ error: "Capture failed", detail: err.message });
    }
  });

  api.get("/captures/pending", (_req: Request, res: Response) => {
    res.json(capture.getAllPendingReviews());
  });

  api.get("/captures/pending/:contactId", (req: Request, res: Response) => {
    const review = capture.getPendingReview(req.params["contactId"] as string);
    if (!review) {
      res.status(404).json({ error: "No pending review for this contact" });
      return;
    }
    res.json(review);
  });

  api.post("/captures/confirm/:contactId", async (req: Request, res: Response) => {
    try {
      const ok = await capture.confirm(req.params["contactId"] as string);
      if (!ok) {
        res.status(404).json({ error: "No pending review to confirm" });
        return;
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to confirm capture", detail: err.message });
    }
  });

  api.post("/captures/dismiss/:contactId", (req: Request, res: Response) => {
    const ok = capture.dismiss(req.params["contactId"] as string);
    res.json({ ok });
  });

  // ── Sweep controls ───────────────────────────────────────

  const sweepRunSchema = z.object({
    contact_name: z.string().optional(),
  });

  api.post("/sweep/run", async (req: Request, res: Response) => {
    const parsed = sweepRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    try {
      const result = await sweep.runSweep(parsed.data.contact_name);
      if (!result) {
        res.status(409).json({ error: "Sweep already in progress" });
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: "Sweep failed", detail: err.message });
    }
  });

  api.get("/sweep/status", (_req: Request, res: Response) => {
    res.json({
      lastResult: sweep.getLastResult(),
      nextSweepAt: sweep.getNextSweepAt()?.toISOString() ?? null,
    });
  });

  // ── Energy state ─────────────────────────────────────────

  const energy = new EnergyService();

  api.get("/energy", async (_req: Request, res: Response) => {
    const level = await energy.getEnergyForToday();
    res.json({ level, day: new Date().toISOString().slice(0, 10) });
  });

  const energySetSchema = z.object({ level: z.enum(["high", "medium", "low"]) });

  api.post("/energy", async (req: Request, res: Response) => {
    const parsed = energySetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.issues });
      return;
    }
    try {
      await energy.setEnergy(parsed.data.level);
      res.json({ ok: true, level: parsed.data.level });
    } catch (err: any) {
      res.status(500).json({ error: "energy_save_failed", detail: err.message });
    }
  });

  // ── Groups (proxy to daemon) ─────────────────────────────

  api.get("/groups", async (_req: Request, res: Response) => {
    try {
      const response = await fetch(`${config.EXTERNAL_GATEWAY_URL}/api/groups`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err: any) {
      res.status(502).json({ error: "daemon_unavailable", detail: err.message });
    }
  });

  // ── Conversation transcript (read-only proxy to daemon) ───

  const conversationQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(365).default(14),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
  });

  /**
   * Return the raw message transcript for a contact.
   *
   * Read-only by design: nothing here writes to Supabase, Open Brain or the
   * markdown file. It exists so the user can ask what someone actually said,
   * rather than reading a summary of a summary.
   */
  api.get("/contacts/:id/conversation", async (req: Request, res: Response) => {
    const parsed = conversationQuerySchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: "invalid_query", details: parsed.error.issues }); return; }
    const { days, limit } = parsed.data;

    const contact = contacts.getById(req.params["id"] as string);
    if (!contact) { res.status(404).json({ error: "contact_not_found" }); return; }
    if (!contact.whatsapp) { res.status(409).json({ error: "no_whatsapp_number" }); return; }
    // `off` is the strongest opt-out the contact record carries. Reading the
    // transcript stores nothing, but honouring the flag keeps one switch
    // meaningful across every path that touches someone's messages.
    if (contact.wa_capture === "off") { res.status(403).json({ error: "capture_disabled" }); return; }

    const jid = toJid(contact.whatsapp);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const url = `${config.EXTERNAL_GATEWAY_URL}/api/chats/${encodeURIComponent(jid)}/messages?from=${encodeURIComponent(from)}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        res.status(502).json({ error: "daemon_error", status: response.status }); return;
      }
      const body = await response.json() as { messages?: RawDaemonMessage[] };
      const all = normaliseMessages(body.messages ?? [], jid);

      // Keep the most recent `limit` — a truncated tail is the useful half
      // when the question is "what did they just say?"
      const messages = all.slice(-limit);
      res.json({
        contact: { id: contact.id, name: contact.name },
        from,
        to: new Date().toISOString(),
        total: all.length,
        returned: messages.length,
        truncated: all.length > messages.length,
        messages,
      });
    } catch (err: any) {
      res.status(502).json({ error: "daemon_unavailable", detail: err.message });
    }
  });

  // ── Send (proxy to daemon) ────────────────────────────────

  const sendSchema = z.object({
    to: z.string().regex(/^\+[1-9]\d{6,14}$/, "must be E.164 format"),
    text: z.string().min(1),
  });

  api.post("/send", async (req: Request, res: Response) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid_body", details: parsed.error.issues }); return; }
    const { to, text } = parsed.data;
    try {
      const response = await fetch(`${config.EXTERNAL_GATEWAY_URL}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ to, text }] }),
      });
      const data: any = await response.json();
      if (response.status === 503 || data?.error === "whatsapp_not_initialised") {
        res.status(503).json({ error: "whatsapp_not_initialised" }); return;
      }
      if (!response.ok) {
        res.status(502).json({ error: "daemon_error", detail: data }); return;
      }
      const result = data?.results?.[0];
      res.json({ ok: true, messageId: result?.messageId ?? null });
    } catch (err: any) {
      res.status(502).json({ error: "daemon_unavailable", detail: err.message });
    }
  });

  // ── Chat (Claude + Kit tools) ────────────────────────────

  const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const CHAT_TOOLS: Anthropic.Tool[] = [
    { name: "get-queue", description: "Returns contacts overdue or due this week.", input_schema: { type: "object", properties: {}, required: [] } },
    { name: "get-contact", description: "Full details for a contact: background, interactions, follow-ups.", input_schema: { type: "object", properties: { name_or_id: { type: "string" } }, required: ["name_or_id"] } },
    { name: "search-contacts", description: "Search contacts by name fragment.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "log-interaction", description: "Log a conversation with a contact. Updates last_contact and schedules next action.", input_schema: { type: "object", properties: { contact_name: { type: "string" }, notes: { type: "string" }, date: { type: "string" }, channel: { type: "string", enum: ["in-person", "call", "whatsapp", "email", "other"] }, follow_ups: { type: "array", items: { type: "string" } } }, required: ["contact_name", "notes"] } },
    { name: "add-follow-up", description: "Add a follow-up item to a contact.", input_schema: { type: "object", properties: { contact_name: { type: "string" }, text: { type: "string" } }, required: ["contact_name", "text"] } },
    { name: "complete-follow-up", description: "Mark a follow-up as done.", input_schema: { type: "object", properties: { contact_name: { type: "string" }, follow_up_text: { type: "string" } }, required: ["contact_name", "follow_up_text"] } },
    { name: "kit-daily-checkin", description: "Run daily check-in: who to reach out to today based on energy level.", input_schema: { type: "object", properties: {}, required: [] } },
    { name: "kit-set-energy", description: "Set social energy level for today (high/medium/low).", input_schema: { type: "object", properties: { level: { type: "string", enum: ["high", "medium", "low"] } }, required: ["level"] } },
    { name: "kit-get-energy", description: "Check today's energy level.", input_schema: { type: "object", properties: {}, required: [] } },
    { name: "get-conversation", description: "Read the actual WhatsApp messages exchanged with a contact — the real transcript, not a summary. Read-only.", input_schema: { type: "object", properties: { contact_name: { type: "string" }, days: { type: "number" }, limit: { type: "number" } }, required: ["contact_name"] } },
    { name: "sweep-now", description: "Pull recent WhatsApp history and summarise conversations.", input_schema: { type: "object", properties: { contact_name: { type: "string" } }, required: [] } },
    { name: "kit-prep-card", description: "Pre-flight brief before reaching out to a contact.", input_schema: { type: "object", properties: { contact_name: { type: "string" } }, required: ["contact_name"] } },
    { name: "kit-draft-context", description: "Context for drafting a message to a contact.", input_schema: { type: "object", properties: { contact_name: { type: "string" }, intent: { type: "string" } }, required: ["contact_name"] } },
    { name: "kit-reconnect-context", description: "Reconnection brief for a dormant contact.", input_schema: { type: "object", properties: { contact_name: { type: "string" } }, required: ["contact_name"] } },
    { name: "kit-pending-captures", description: "List pending WhatsApp captures for review.", input_schema: { type: "object", properties: {}, required: [] } },
    { name: "kit-confirm-capture", description: "Confirm and save a pending capture.", input_schema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "kit-dismiss-capture", description: "Dismiss a pending capture.", input_schema: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] } },
    { name: "create-contact", description: "Create a new contact.", input_schema: { type: "object", properties: { name: { type: "string" }, tier: { type: "number", enum: [1, 2, 3] }, frequency: { type: "string" }, origin_story: { type: "string" }, notes: { type: "string" }, whatsapp: { type: "string" } }, required: ["name", "tier", "frequency"] } },
    { name: "set-contact-active", description: "Mark a contact active or inactive.", input_schema: { type: "object", properties: { contact_name: { type: "string" }, active: { type: "boolean" } }, required: ["contact_name", "active"] } },
    { name: "kit-send-message", description: "Send a WhatsApp message to a Kit contact. Delivers a real message immediately and cannot be undone — confirm the exact wording with the user first. Contacts only; the number comes from their record. Logged as an interaction by default.", input_schema: { type: "object", properties: { contact_name: { type: "string" }, text: { type: "string" }, log: { type: "boolean" } }, required: ["contact_name", "text"] } },
  ] as Anthropic.Tool[];

  async function dispatchChatTool(name: string, args: Record<string, unknown>): Promise<string> {
    const t = await kitTools();
    switch (name) {
      case "get-queue": return JSON.stringify(await t.getQueue());
      case "get-contact": { const d = await t.getContact(String(args.name_or_id ?? "")); return d ? JSON.stringify(d) : `No contact found for "${args.name_or_id}"`; }
      case "search-contacts": return JSON.stringify(await t.searchContacts(String(args.query ?? "")));
      case "log-interaction": return t.logInteraction({ contact_name: String(args.contact_name ?? ""), notes: String(args.notes ?? ""), date: args.date ? String(args.date) : undefined, channel: args.channel ? String(args.channel) : undefined, follow_ups: Array.isArray(args.follow_ups) ? args.follow_ups as string[] : undefined });
      case "add-follow-up": return t.addFollowUp(String(args.contact_name ?? ""), String(args.text ?? ""));
      case "complete-follow-up": return t.completeFollowUp(String(args.contact_name ?? ""), String(args.follow_up_text ?? ""));
      case "kit-daily-checkin": return t.dailyCheckin();
      case "kit-set-energy": return t.setEnergy(String(args.level ?? ""));
      case "kit-get-energy": return t.getEnergy();
      case "get-conversation": return t.getConversation({ contact_name: String(args.contact_name ?? ""), days: args.days as number | undefined, limit: args.limit as number | undefined });
      case "sweep-now": return t.sweepNow(args.contact_name ? String(args.contact_name) : undefined);
      case "kit-prep-card": return t.kitPrepCard(String(args.contact_name ?? ""));
      case "kit-draft-context": return t.kitDraftContext(String(args.contact_name ?? ""), args.intent ? String(args.intent) : undefined);
      case "kit-reconnect-context": return t.kitReconnectContext(String(args.contact_name ?? ""));
      case "kit-pending-captures": return t.getPendingCaptures();
      case "kit-confirm-capture": return t.confirmCapture(String(args.contact_id ?? ""));
      case "kit-dismiss-capture": return t.dismissCapture(String(args.contact_id ?? ""));
      case "create-contact": return t.createContact({ name: String(args.name ?? ""), tier: (args.tier ?? 3) as 1 | 2 | 3, frequency: String(args.frequency ?? "Monthly"), origin_story: args.origin_story ? String(args.origin_story) : undefined, notes: args.notes ? String(args.notes) : undefined, whatsapp: args.whatsapp ? String(args.whatsapp) : undefined });
      case "set-contact-active": return t.setContactActive(String(args.contact_name ?? ""), Boolean(args.active));
      // Delegates to the shared MCP implementation so the web UI and Claude
      // Desktop send by exactly the same rules — contacts only, and logged.
      case "kit-send-message": return t.sendMessage({ contact_name: String(args.contact_name ?? ""), text: String(args.text ?? ""), log: args.log as boolean | undefined });
      default: return `Unknown tool: ${name}`;
    }
  }

  const chatSchema = z.object({
    message: z.string().min(1),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
  });

  api.post("/chat", async (req: Request, res: Response) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid_body", details: parsed.error.issues }); return; }

    const today = new Date().toISOString().slice(0, 10);
    const lastUserMessage = parsed.data.message;

    // Step 4: enrich system prompt with memories before the Anthropic call
    let memorySection = "";
    try {
      const generalMemories = await memoryStore.search(lastUserMessage, { limit: 6 });

      // Check if any contact name is mentioned in the message
      const allContacts = contacts.getAll();
      const mentionedContact = allContacts.find((c) =>
        lastUserMessage.toLowerCase().includes(c.name.toLowerCase())
      );
      let contactMemories: typeof generalMemories = [];
      if (mentionedContact) {
        contactMemories = await memoryStore.search(lastUserMessage, { contactId: mentionedContact.id, limit: 4 });
      }

      const combined = [...generalMemories, ...contactMemories.filter((cm) => !generalMemories.some((gm) => gm.id === cm.id))];
      if (combined.length > 0) {
        const lines = combined.map((m) => {
          const date = m.createdAt.slice(0, 10);
          return `- [${m.category}] ${m.content} (${m.source}, ${date})`;
        });
        memorySection = `\n\n## What Kit remembers\n${lines.join("\n")}`;
      }
    } catch {
      // Non-fatal: proceed without memories if embed/search fails
    }

    // Step 8: include Open Brain results if enabled
    let openBrainSection = "";
    if (OPEN_BRAIN_ENABLED && config.OPEN_BRAIN_URL && config.OPEN_BRAIN_SERVICE_KEY) {
      try {
        const obSupabase = createClient(config.OPEN_BRAIN_URL, config.OPEN_BRAIN_SERVICE_KEY);
        const [embedding] = await memoryStore.embedTexts([lastUserMessage]);
        const embeddingStr = `[${embedding.join(",")}]`;
        const { data: obData } = await (obSupabase as any).rpc("match_thoughts", {
          query_embedding: embeddingStr,
          match_threshold: 0.4,
          match_count: 5,
        }).catch(() => ({ data: null }));

        // Fallback: full-text search if rpc fails or returns nothing
        let results: { id: string; content: string; created_at: string; similarity?: number }[] = obData ?? [];
        if (results.length === 0) {
          const { data: ftData } = await obSupabase
            .from("thoughts")
            .select("id, content, created_at")
            .textSearch("content", lastUserMessage.split(" ").slice(0, 5).join(" & "), { type: "websearch" })
            .limit(5);
          results = ftData ?? [];
        }

        const filtered = results.filter((r) => !r.similarity || r.similarity > 0.4);
        if (filtered.length > 0) {
          const lines = filtered.map((r) => `- ${r.content} (${r.created_at.slice(0, 10)})`);
          openBrainSection = `\n\n## From Open Brain (raw captures)\n${lines.join("\n")}`;
        }
      } catch {
        // Non-fatal
      }
    }

    const systemPrompt = `You are Kit, a relationship management assistant for a neurodivergent user (autism/ADHD). You help them maintain relationships by tracking contacts, logging interactions, and surfacing who to reach out to.

Today is ${today}. You have access to their contact database and WhatsApp history via tools. Use tools to answer questions accurately rather than guessing. Keep responses concise and practical.${memorySection}${openBrainSection}`;

    const messages: Anthropic.MessageParam[] = [
      ...(parsed.data.history ?? []).map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: lastUserMessage },
    ];

    const toolCalls: { name: string; input: Record<string, unknown>; result: string }[] = [];
    let reply = "";

    try {
      let iteration = 0;
      while (iteration < 8) {
        iteration++;
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: systemPrompt,
          tools: CHAT_TOOLS,
          messages,
        });

        if (response.stop_reason === "end_turn") {
          reply = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
          break;
        }

        if (response.stop_reason === "tool_use") {
          const assistantContent = response.content;
          messages.push({ role: "assistant", content: assistantContent });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of assistantContent) {
            if (block.type !== "tool_use") continue;
            const result = await dispatchChatTool(block.name, block.input as Record<string, unknown>);
            toolCalls.push({ name: block.name, input: block.input as Record<string, unknown>, result });
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
          }
          messages.push({ role: "user", content: toolResults });
        } else {
          break;
        }
      }

      // Step 5: async memory capture — extract new facts from this exchange
      if (reply) {
        const exchange = `User: ${lastUserMessage}\nAssistant: ${reply}`;
        void (async () => {
          try {
            const extractResp = await anthropic.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 256,
              messages: [{
                role: "user",
                content: `Extract new facts about the user or their contacts from this exchange.\nOutput one fact per line as: [category]|[contact_name or 'user']|fact\nCategories: contact_fact, life_event, preference, interaction_insight\nOnly extract genuinely new information. If nothing new, output NONE.\n\n${exchange}`,
              }],
            });
            const text = extractResp.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("").trim();
            if (text === "NONE" || !text) return;
            for (const line of text.split("\n")) {
              const parts = line.split("|");
              if (parts.length < 3) continue;
              const [rawCat, rawName, ...factParts] = parts;
              const category = rawCat.replace(/[[\]]/g, "").trim() as any;
              const nameOrUser = rawName.trim();
              const fact = factParts.join("|").trim();
              if (!fact || !["contact_fact", "life_event", "preference", "interaction_insight"].includes(category)) continue;
              let contactId: string | undefined;
              if (nameOrUser !== "user") {
                const found = contacts.getAll().find((c) => c.name.toLowerCase() === nameOrUser.toLowerCase());
                if (found) contactId = found.id;
              }
              await memoryStore.remember(fact, category, "chat", contactId);
            }
          } catch {
            // Non-fatal background task
          }
        })();
      }

      res.json({ reply, tool_calls: toolCalls });
    } catch (err: any) {
      res.status(500).json({ error: "chat_failed", detail: err.message });
    }
  });

  // ── Memories (Step 6) ───────────────────────────────────

  const memorySchema = z.object({
    content: z.string().min(1),
    category: z.enum(["contact_fact", "life_event", "preference", "interaction_insight"]),
    source: z.enum(["chat", "sweep", "manual"]),
    contactId: z.string().optional(),
  });

  api.post("/memories", async (req: Request, res: Response) => {
    const parsed = memorySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid_body", details: parsed.error.issues }); return; }
    try {
      await memoryStore.remember(parsed.data.content, parsed.data.category, parsed.data.source, parsed.data.contactId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: "memory_store_failed", detail: err.message });
    }
  });

  api.get("/memories/search", async (req: Request, res: Response) => {
    const q = String(req.query["q"] ?? "").trim();
    if (!q) { res.status(400).json({ error: "q_required" }); return; }
    const contactId = req.query["contactId"] ? String(req.query["contactId"]) : undefined;
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 10;
    try {
      const results = await memoryStore.search(q, { contactId, limit });
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ error: "memory_search_failed", detail: err.message });
    }
  });

  // ── Open Brain (Steps 7-8) ───────────────────────────────

  api.get("/openbrain/status", (_req: Request, res: Response) => {
    res.json({ enabled: OPEN_BRAIN_ENABLED });
  });

  api.get("/openbrain/search", async (req: Request, res: Response) => {
    if (!OPEN_BRAIN_ENABLED || !config.OPEN_BRAIN_URL || !config.OPEN_BRAIN_SERVICE_KEY) {
      res.json({ results: [], enabled: false });
      return;
    }
    const q = String(req.query["q"] ?? "").trim();
    if (!q) { res.status(400).json({ error: "q_required" }); return; }
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 10;
    try {
      const obSupabase = createClient(config.OPEN_BRAIN_URL, config.OPEN_BRAIN_SERVICE_KEY);
      const [embedding] = await memoryStore.embedTexts([q]);
      const embeddingStr = `[${embedding.join(",")}]`;

      // Try cosine similarity search first
      const { data: vecData, error: vecError } = await (obSupabase as any).rpc("match_thoughts", {
        query_embedding: embeddingStr,
        match_threshold: 0.0,
        match_count: limit,
      });

      let results: { id: string; content: string; createdAt: string; similarity?: number }[] = [];
      if (!vecError && vecData && vecData.length > 0) {
        results = (vecData as any[]).map((r) => ({
          id: r.id,
          content: r.content,
          createdAt: r.created_at,
          similarity: r.similarity,
        }));
      } else {
        // Fallback: full-text search
        const words = q.split(/\s+/).slice(0, 5).join(" & ");
        const { data: ftData } = await obSupabase
          .from("thoughts")
          .select("id, content, created_at")
          .textSearch("content", words, { type: "websearch" })
          .limit(limit);
        results = (ftData ?? []).map((r: any) => ({
          id: r.id,
          content: r.content,
          createdAt: r.created_at,
        }));
      }

      res.json({ results, enabled: true });
    } catch (err: any) {
      res.status(500).json({ error: "openbrain_search_failed", detail: err.message });
    }
  });

  return api;
}
