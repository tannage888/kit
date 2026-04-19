/**
 * Kit WhatsApp Gateway — Entry Point
 *
 * Boots the Baileys WhatsApp connection, loads tracked contacts,
 * wires up the message router, capture pipeline, sweep scheduler,
 * and starts the Express REST API.
 *
 * Run: npm run dev  (development with hot reload)
 *      npm start    (production)
 *
 * First-time setup:
 *   Set WHATSAPP_PHONE=+447700900123 in .env, then start the gateway.
 *   An 8-character pairing code will appear in the terminal.
 *   Enter it in WhatsApp > Settings > Linked Devices > Link a Device >
 *   Link with phone number. The gateway will connect and save auth state.
 *   On subsequent starts, no code is needed.
 */

import express from "express";
import { config } from "./config.js";
import { WhatsAppConnection } from "./services/whatsapp.js";
import { ContactRegistry } from "./services/contacts.js";
import { CapturePipeline } from "./services/capture.js";
import { MessageRouter } from "./services/message-router.js";
import { HistoryFetcher } from "./services/history-fetcher.js";
import { SweepScheduler } from "./services/sweep-scheduler.js";
import { createApiRouter } from "./routes/api.js";
import { SyncService } from "./services/sync.js";

const startedAt = Date.now();

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║    Kit WhatsApp Gateway v0.2.0       ║");
  console.log("╚══════════════════════════════════════╝");
  console.log();

  // ── 1. Initialise services ─────────────────────────────

  const sync = new SyncService();
  const contacts = new ContactRegistry();
  const capture = new CapturePipeline(contacts);
  const messageRouter = new MessageRouter(contacts, capture);
  const wa = new WhatsAppConnection();
  const historyFetcher = new HistoryFetcher(wa);
  const sweepScheduler = new SweepScheduler(wa, contacts, capture, historyFetcher);

  // ── 2. Start bidirectional sync ────────────────────────

  await sync.start();

  // ── 3. Load tracked contacts from Supabase ─────────────

  console.log("📇 Loading tracked contacts...");
  await contacts.loadFromDatabase();

  // ── 4. Wire message events to the live router ──────────

  wa.on("message:received", (msg) => messageRouter.handleMessage(msg));
  wa.on("message:sent", (msg) => messageRouter.handleMessage(msg));

  wa.on("connection:status", (status) => {
    console.log(`📡 WhatsApp status: ${status}`);
  });

  // After the connection opens, resolve @lid JIDs for all tracked contacts,
  // then start the sweep scheduler. The 30s delay in the scheduler gives
  // history sync time to buffer messages before the first sweep runs.
  wa.on("connection:open", () => {
    const phones = contacts.getAll().map((c) => c.whatsapp);
    wa.resolveContactLids(phones).then(() => {
      sweepScheduler.start(config.SWEEP_INTERVAL_DAYS);
    });
  });

  // ── 5. Connect to WhatsApp ─────────────────────────────

  console.log("📱 Connecting to WhatsApp...");
  await wa.connect();

  // ── 6. Start REST API ──────────────────────────────────

  const app = express();
  app.use(express.json());

  const apiRouter = createApiRouter(
    wa, contacts, messageRouter, capture, sweepScheduler, startedAt
  );
  app.use("/api", apiRouter);

  app.get("/", (_req, res) => res.redirect("/api/status"));

  app.listen(config.PORT, () => {
    console.log();
    console.log(`🚀 REST API listening on http://localhost:${config.PORT}`);
    console.log(`   Status:      GET  /api/status`);
    console.log(`   Auth:        GET  /api/auth/status`);
    console.log(`   Send:        POST /api/send`);
    console.log(`   Capture:     POST /api/capture/:contactId`);
    console.log(`   Review:      GET  /api/captures/pending`);
    console.log(`   Sweep:       POST /api/sweep/run`);
    console.log(`   Sweep status:GET  /api/sweep/status`);
    console.log();
  });

  // ── 7. Graceful shutdown ───────────────────────────────

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down...`);
    sweepScheduler.stop();
    messageRouter.shutdown();
    await sync.stop();
    await wa.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
