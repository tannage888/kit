/**
 * REST API Routes — Kit Gateway
 *
 * v1.0: Kit is a REST client of the dedicated claude_whatsapp_integration
 * daemon. The gateway no longer manages its own Baileys connection.
 *
 * Removed from v0: /auth/status, /send, /debug/store (all Baileys-specific).
 * Added: POST /api/incoming-message (daemon push endpoint).
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { ContactRegistry } from "../services/contacts.js";
import { MessageRouter } from "../services/message-router.js";
import { CapturePipeline } from "../services/capture.js";
import { SweepScheduler } from "../services/sweep-scheduler.js";
import { ImportIngestor } from "../services/import-ingestor.js";
import { ContactCreator, type CreateContactInput } from "../services/contact-creator.js";
import { buildWhatsAppLink, isValidE164 } from "../utils/wa-link.js";
import type { CaptureMode, Channel, GatewayStatus, TrackedContact } from "../types.js";

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

  return api;
}
