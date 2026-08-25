/**
 * Kit Gateway — Entry Point (v1.0)
 *
 * Boots the gateway without an embedded Baileys connection.
 * WhatsApp is handled by the dedicated claude_whatsapp_integration daemon
 * on EXTERNAL_GATEWAY_URL (default http://127.0.0.1:3142). Messages are
 * pushed to this gateway via POST /api/incoming-message.
 *
 * Run: npm run dev  (development with hot reload)
 *      npm start    (production)
 *
 * Ensure the WhatsApp daemon is running before starting the gateway,
 * but the gateway is tolerant of the daemon being temporarily unavailable
 * (sweep skips, live capture simply doesn't receive pushes).
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { ContactRegistry } from "./services/contacts.js";
import { CapturePipeline } from "./services/capture.js";
import { MessageRouter } from "./services/message-router.js";
import { HistoryFetcher } from "./services/history-fetcher.js";
import { SweepScheduler } from "./services/sweep-scheduler.js";
import { ImportIngestor } from "./services/import-ingestor.js";
import { createApiRouter } from "./routes/api.js";
import { SyncService } from "./services/sync.js";

const startedAt = Date.now();

export const OPEN_BRAIN_ENABLED = Boolean(process.env.OPEN_BRAIN_URL);

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║    Kit Gateway v1.0.0                ║");
  console.log("╚══════════════════════════════════════╝");
  console.log();

  // ── 1. Initialise services ─────────────────────────────

  const sync = new SyncService();
  const contacts = new ContactRegistry();
  const capture = new CapturePipeline(contacts);
  const messageRouter = new MessageRouter(contacts, capture);
  const fetcher = new HistoryFetcher(config.EXTERNAL_GATEWAY_URL);
  const sweepScheduler = new SweepScheduler(contacts, capture, fetcher);
  const importIngestor = new ImportIngestor(
    contacts,
    messageRouter,
    config.EXTERNAL_GATEWAY_URL
  );

  // ── 2. Start bidirectional markdown↔Supabase sync ─────

  await sync.start();

  // ── 3. Load tracked contacts from Supabase ─────────────

  console.log("📇 Loading tracked contacts...");
  await contacts.loadFromDatabase();

  // ── 4. Start sweep scheduler ───────────────────────────
  // Starts immediately; sweeps skip gracefully if daemon is unavailable.

  sweepScheduler.start(config.SWEEP_INTERVAL_HOURS);

  // ── 5. Start REST API ──────────────────────────────────

  const app = express();
  const allowedOrigins = new Set([
    "http://localhost:3143",
    ...(process.env.PUBLIC_URL ? [process.env.PUBLIC_URL] : []),
  ]);
  app.use((_req, res, next) => {
    const origin = _req.headers.origin ?? "";
    if (allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  app.use(express.json());

  const apiRouter = createApiRouter(
    contacts, messageRouter, capture, sweepScheduler, importIngestor, startedAt
  );
  app.use("/api", apiRouter);

  const webDist = path.resolve(__dirname, "../../web/dist");
  app.use(express.static(webDist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));

  app.listen(config.PORT, () => {
    console.log();
    console.log(`🚀 REST API listening on http://localhost:${config.PORT}`);
    console.log(`   Status:      GET  /api/status`);
    console.log(`   Incoming:    POST /api/incoming-message`);
    console.log(`   ZIP import:  POST /api/zip-import-complete`);
    console.log(`   Contacts:    GET  /api/contacts`);
    console.log(`   Captures:    GET  /api/captures/pending`);
    console.log(`   Sweep:       POST /api/sweep/run`);
    console.log(`   Sweep status:GET  /api/sweep/status`);
    console.log();
    console.log(`📡 WhatsApp daemon: ${config.EXTERNAL_GATEWAY_URL}`);
    console.log();
  });

  // ── 6. Graceful shutdown ───────────────────────────────

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down...`);
    sweepScheduler.stop();
    messageRouter.shutdown();
    await sync.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
