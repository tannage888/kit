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
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { ContactRegistry } from "../services/contacts.js";
import { MessageRouter } from "../services/message-router.js";
import { CapturePipeline } from "../services/capture.js";
import { SweepScheduler } from "../services/sweep-scheduler.js";
import { ImportIngestor } from "../services/import-ingestor.js";
import { ContactCreator, type CreateContactInput } from "../services/contact-creator.js";
import { buildWhatsAppLink, isValidE164 } from "../utils/wa-link.js";
import { parseContactFile } from "../utils/markdown.js";
import type { CaptureMode, Channel, GatewayStatus, TrackedContact } from "../types.js";
import { EnergyService } from "../services/energy.js";

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

  api.post("/contacts/refresh", async (_req: Request, res: Response) => {
    const count = await contacts.loadFromDatabase();
    res.json({ ok: true, count });
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
    frequency: z.enum(["Weekly", "Monthly", "Quarterly"]),
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

  return api;
}
