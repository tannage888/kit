/**
 * API route tests — Phase 1
 *
 * Covers the two Phase 1 additions:
 *   POST /api/incoming-message — validates schema, invokes MessageRouter
 *   GET  /api/status           — proxies daemon connection state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createApiRouter } from "./api.js";

// ── Config mock ───────────────────────────────────────────────────────────────

vi.mock("../config.js", () => ({
  config: {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_KEY: "test-key",
    EXTERNAL_GATEWAY_URL: "http://127.0.0.1:3142",
    CAPTURE_INACTIVITY_MINUTES: 30,
    SWEEP_INTERVAL_DAYS: 3,
  },
}));

// ── Stub helpers ──────────────────────────────────────────────────────────────

function makeRouter() {
  const mockContacts = {
    size: 5,
    getAll: vi.fn().mockReturnValue([]),
    getById: vi.fn(),
    getByJid: vi.fn(),
    loadFromDatabase: vi.fn().mockResolvedValue(5),
    register: vi.fn(),
    unregister: vi.fn().mockReturnValue(true),
    setCaptureMode: vi.fn().mockReturnValue(true),
  };

  const mockRouter = {
    handleMessage: vi.fn(),
    activeThreadCount: 0,
    triggerCapture: vi.fn().mockResolvedValue(true),
    captureSingleMessage: vi.fn().mockResolvedValue(true),
    shutdown: vi.fn(),
  };

  const mockCapture = {
    pendingCount: 0,
    getAllPendingReviews: vi.fn().mockReturnValue([]),
    getPendingReview: vi.fn().mockReturnValue(null),
    confirm: vi.fn().mockResolvedValue(true),
    dismiss: vi.fn().mockReturnValue(true),
  };

  const mockSweep = {
    getLastResult: vi.fn().mockReturnValue(null),
    getNextSweepAt: vi.fn().mockReturnValue(null),
    runSweep: vi.fn().mockResolvedValue({ contactsSwept: 0, threadsProcessed: 0 }),
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createApiRouter(
      mockContacts as any,
      mockRouter as any,
      mockCapture as any,
      mockSweep as any,
      Date.now()
    )
  );

  return { app, mockContacts, mockRouter, mockCapture, mockSweep };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/incoming-message", () => {
  it("accepts a valid message and calls handleMessage", async () => {
    const { app, mockRouter } = makeRouter();

    const msg = {
      remoteJid: "447700900001@s.whatsapp.net",
      fromMe: false,
      body: "Hey, are you free tonight?",
      timestamp: Date.now(),
      messageId: "msg-abc-123",
    };

    const res = await request(app).post("/api/incoming-message").send(msg);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockRouter.handleMessage).toHaveBeenCalledWith(expect.objectContaining({
      remoteJid: msg.remoteJid,
      body: msg.body,
    }));
  });

  it("rejects a message with missing required fields", async () => {
    const { app, mockRouter } = makeRouter();

    const res = await request(app)
      .post("/api/incoming-message")
      .send({ remoteJid: "447700900001@s.whatsapp.net" }); // missing body, timestamp, etc.

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
    expect(mockRouter.handleMessage).not.toHaveBeenCalled();
  });

  it("rejects a message with wrong field types", async () => {
    const { app } = makeRouter();

    const res = await request(app).post("/api/incoming-message").send({
      remoteJid: "447700900001@s.whatsapp.net",
      fromMe: "yes", // should be boolean
      body: "Hi",
      timestamp: "not-a-number",
      messageId: "msg-1",
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/status", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ connection: "connected" }),
    } as unknown as Response);
  });

  it("returns connection state proxied from the daemon", async () => {
    const { app } = makeRouter();

    const res = await request(app).get("/api/status");

    expect(res.status).toBe(200);
    expect(res.body.connection).toBe("connected");
    expect(typeof res.body.uptime).toBe("number");
    expect(typeof res.body.trackedContacts).toBe("number");
  });

  it("returns unavailable when the daemon is unreachable", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const { app } = makeRouter();

    const res = await request(app).get("/api/status");

    expect(res.status).toBe(200);
    expect(res.body.connection).toBe("unavailable");
  });
});
