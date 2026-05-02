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
    SWEEP_INTERVAL_HOURS: 3,
    SWEEP_INITIAL_LOOKBACK_DAYS: 7,
  },
}));

// ── Stub helpers ──────────────────────────────────────────────────────────────

function makeRouter() {
  const mockContacts = {
    size: 5,
    getAll: vi.fn().mockReturnValue([]),
    getById: vi.fn(),
    getByJid: vi.fn(),
    findByName: vi.fn(),
    jidFor: vi.fn((c: any) => `${c.whatsapp.replace(/^\+/, "")}@s.whatsapp.net`),
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

  const mockIngestor = {
    ingest: vi
      .fn()
      .mockResolvedValue({ status: "ok", ingested: 0, captureQueued: false }),
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
      mockIngestor as any,
      Date.now()
    )
  );

  return { app, mockContacts, mockRouter, mockCapture, mockSweep, mockIngestor };
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

describe("POST /api/contacts/resolve-name", () => {
  it("returns jid + contactId for a known contact", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.findByName.mockReturnValue({
      id: "alice-123",
      name: "Alice Smith",
      whatsapp: "+447700900001",
    });

    const res = await request(app)
      .post("/api/contacts/resolve-name")
      .send({ name: "Alice Smith" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      jid: "447700900001@s.whatsapp.net",
      contactId: "alice-123",
    });
    expect(mockContacts.findByName).toHaveBeenCalledWith("Alice Smith");
  });

  it("returns nulls when the name is unknown", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.findByName.mockReturnValue(undefined);

    const res = await request(app)
      .post("/api/contacts/resolve-name")
      .send({ name: "Nobody" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jid: null, contactId: null });
  });

  it("rejects an empty body", async () => {
    const { app } = makeRouter();
    const res = await request(app).post("/api/contacts/resolve-name").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
  });
});

describe("POST /api/zip-import-complete", () => {
  it("delegates to importIngestor.ingest and echoes the result", async () => {
    const { app, mockIngestor } = makeRouter();
    mockIngestor.ingest.mockResolvedValue({
      status: "ok",
      ingested: 12,
      captureQueued: true,
    });

    const res = await request(app).post("/api/zip-import-complete").send({
      chatJid: "447700900001@s.whatsapp.net",
      imported: 12,
      duplicates: 3,
      textFile: "WhatsApp Chat with Alice.txt",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      status: "ok",
      ingested: 12,
      captureQueued: true,
    });
    expect(mockIngestor.ingest).toHaveBeenCalledWith("447700900001@s.whatsapp.net");
  });

  it("forwards a soft skip from the ingestor as 200 ok", async () => {
    const { app, mockIngestor } = makeRouter();
    mockIngestor.ingest.mockResolvedValue({
      status: "skipped",
      reason: "unknown_contact",
    });

    const res = await request(app)
      .post("/api/zip-import-complete")
      .send({ chatJid: "999@s.whatsapp.net" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      status: "skipped",
      reason: "unknown_contact",
    });
  });

  it("rejects a missing chatJid", async () => {
    const { app, mockIngestor } = makeRouter();
    const res = await request(app).post("/api/zip-import-complete").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
    expect(mockIngestor.ingest).not.toHaveBeenCalled();
  });

  it("returns 502 when the ingestor throws (daemon unreachable)", async () => {
    const { app, mockIngestor } = makeRouter();
    mockIngestor.ingest.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await request(app)
      .post("/api/zip-import-complete")
      .send({ chatJid: "447700900001@s.whatsapp.net" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("ingest_failed");
    expect(res.body.detail).toMatch(/ECONNREFUSED/);
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
