/**
 * REST API Routes
 *
 * Endpoints exposed by the gateway for the Kit mobile app to call.
 * Runs on the local network (or tunnelled via Tailscale/Cloudflare).
 *
 * All endpoints return JSON. Errors use standard HTTP status codes.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { WhatsAppConnection } from "../services/whatsapp.js";
import { ContactRegistry } from "../services/contacts.js";
import { MessageRouter } from "../services/message-router.js";
import { CapturePipeline } from "../services/capture.js";
import { SweepScheduler } from "../services/sweep-scheduler.js";
import { buildWhatsAppLink, isValidE164 } from "../utils/wa-link.js";
import type { CaptureMode, GatewayStatus, TrackedContact } from "../types.js";

export function createApiRouter(
  wa: WhatsAppConnection,
  contacts: ContactRegistry,
  router: MessageRouter,
  capture: CapturePipeline,
  sweep: SweepScheduler,
  startedAt: number
): Router {
  const api = Router();

  // ── Health / status ──────────────────────────────────────

  api.get("/status", (_req: Request, res: Response) => {
    const last = sweep.getLastResult();
    const next = sweep.getNextSweepAt();
    const status: GatewayStatus = {
      connection: wa.getStatus(),
      trackedContacts: contacts.size,
      activeThreads: router.activeThreadCount,
      pendingCaptures: capture.pendingCount,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      lastSweep: last?.completedAt ?? null,
      nextSweep: next?.toISOString() ?? null,
    };
    res.json(status);
  });

  // ── Auth status ──────────────────────────────────────────

  api.get("/auth/status", (_req: Request, res: Response) => {
    const status = wa.getStatus();
    const pairingCode = wa.getPairingCode();
    res.json({
      status,
      paired: status === "connected",
      pairingCode: pairingCode ?? null,
      instructions: pairingCode
        ? "Enter this code in WhatsApp > Settings > Linked Devices > Link a Device > Link with phone number"
        : null,
    });
  });

  // ── Send a message via Baileys ───────────────────────────

  const sendSchema = z.object({
    contact_id: z.string(),
    message: z.string().min(1).max(5000),
  });

  api.post("/send", async (req: Request, res: Response) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }

    const contact = contacts.getById(parsed.data.contact_id);
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    if (!contact.whatsapp) {
      res.status(400).json({ error: "Contact has no WhatsApp number" });
      return;
    }

    try {
      const messageId = await wa.sendMessage(contact.whatsapp, parsed.data.message);
      res.json({ ok: true, messageId });
    } catch (err: any) {
      res.status(502).json({ error: "Failed to send via WhatsApp", detail: err.message });
    }
  });

  // ── Generate a wa.me deep link (v1.0 fallback) ──────────

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
    const removed = contacts.unregister(req.params.id);
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
    const ok = contacts.setCaptureMode(req.params.id, parsed.data.mode as CaptureMode);
    res.json({ ok });
  });

  // ── Capture pipeline controls ────────────────────────────

  /** Manually trigger capture for a contact's current thread */
  api.post("/capture/:contactId", async (req: Request, res: Response) => {
    try {
      const ok = await router.triggerCapture(req.params.contactId);
      if (!ok) {
        res.status(404).json({ error: "No active thread for this contact" });
        return;
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: "Capture failed", detail: err.message });
    }
  });

  /** Capture a single message by ID */
  api.post("/capture/:contactId/message/:messageId", async (req: Request, res: Response) => {
    try {
      const ok = await router.captureSingleMessage(req.params.contactId, req.params.messageId);
      res.json({ ok });
    } catch (err: any) {
      res.status(500).json({ error: "Capture failed", detail: err.message });
    }
  });

  /** Get all pending capture reviews */
  api.get("/captures/pending", (_req: Request, res: Response) => {
    res.json(capture.getAllPendingReviews());
  });

  /** Get a specific pending review */
  api.get("/captures/pending/:contactId", (req: Request, res: Response) => {
    const review = capture.getPendingReview(req.params.contactId);
    if (!review) {
      res.status(404).json({ error: "No pending review for this contact" });
      return;
    }
    res.json(review);
  });

  /** Confirm a pending capture → write to Open Brain */
  api.post("/captures/confirm/:contactId", async (req: Request, res: Response) => {
    try {
      const ok = await capture.confirm(req.params.contactId);
      if (!ok) {
        res.status(404).json({ error: "No pending review to confirm" });
        return;
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to confirm capture", detail: err.message });
    }
  });

  /** Dismiss a pending capture → discard without storing */
  api.post("/captures/dismiss/:contactId", (req: Request, res: Response) => {
    const ok = capture.dismiss(req.params.contactId);
    res.json({ ok });
  });

  // ── Debug ────────────────────────────────────────────────

  api.get("/debug/store", (_req: Request, res: Response) => {
    res.json(wa.getStoreStats());
  });

  // ── Sweep controls ───────────────────────────────────────

  const sweepRunSchema = z.object({
    contact_name: z.string().optional(),
  });

  /** Trigger an immediate sweep (optionally for a single contact) */
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

  /** Get the last sweep result and next scheduled time */
  api.get("/sweep/status", (_req: Request, res: Response) => {
    res.json({
      lastResult: sweep.getLastResult(),
      nextSweepAt: sweep.getNextSweepAt()?.toISOString() ?? null,
    });
  });

  return api;
}
