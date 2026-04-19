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
import { buildWhatsAppLink, isValidE164 } from "../utils/wa-link.js";
import type { CaptureMode, GatewayStatus, TrackedContact } from "../types.js";

export function createApiRouter(
  contacts: ContactRegistry,
  router: MessageRouter,
  capture: CapturePipeline,
  sweep: SweepScheduler,
  startedAt: number
): Router {
  const api = Router();

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
