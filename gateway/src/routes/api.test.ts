/**
 * API route tests — Phase 1
 *
 * Covers the two Phase 1 additions:
 *   POST /api/incoming-message — validates schema, invokes MessageRouter
 *   GET  /api/status           — proxies daemon connection state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("POST /api/send", () => {
  it("proxies to daemon and returns messageId", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ to: "+447700900123", status: "sent", messageId: "msg-xyz-1" }] }),
    } as unknown as Response);

    const { app } = makeRouter();
    const res = await request(app).post("/api/send").send({ to: "+447700900123", text: "Hey!" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.messageId).toBe("msg-xyz-1");
  });

  it("returns 400 for missing to field", async () => {
    const { app } = makeRouter();
    const res = await request(app).post("/api/send").send({ text: "Hey!" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
  });

  it("returns 400 for invalid E.164 number", async () => {
    const { app } = makeRouter();
    const res = await request(app).post("/api/send").send({ to: "07700900123", text: "Hey!" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
  });

  it("returns 400 for empty text", async () => {
    const { app } = makeRouter();
    const res = await request(app).post("/api/send").send({ to: "+447700900123", text: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
  });

  it("returns 503 when daemon returns whatsapp_not_initialised", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "whatsapp_not_initialised" }),
    } as unknown as Response);

    const { app } = makeRouter();
    const res = await request(app).post("/api/send").send({ to: "+447700900123", text: "Hey!" });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("whatsapp_not_initialised");
  });
});

// ── GET /api/contacts/:id/conversation ────────────────────────────────────────

describe("GET /api/contacts/:id/conversation", () => {
  afterEach(() => vi.unstubAllGlobals());

  const CONTACT = {
    id: "kat_osman",
    name: "Kat Osman",
    whatsapp: "+44 7931 460 181",
    wa_capture: "on_demand",
  };

  function daemonReturns(messages: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ messages }),
      })
    );
  }

  it("returns the transcript for a tracked contact", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getById.mockReturnValue(CONTACT);
    daemonReturns([
      { id: "m1", timestamp: "2026-08-20T12:00:00.000Z", fromMe: false, body: "Hello" },
      { id: "m2", timestamp: "2026-08-20T12:05:00.000Z", fromMe: true, body: "Hi back" },
    ]);

    const res = await request(app).get("/api/contacts/kat_osman/conversation");

    expect(res.status).toBe(200);
    expect(res.body.contact.name).toBe("Kat Osman");
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0].body).toBe("Hello");
    expect(res.body.truncated).toBe(false);
  });

  it("builds the daemon JID from a number containing spaces", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getById.mockReturnValue(CONTACT);
    daemonReturns([]);

    await request(app).get("/api/contacts/kat_osman/conversation");

    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent("447931460181@s.whatsapp.net"));
  });

  it("keeps the most recent messages when over the limit", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getById.mockReturnValue(CONTACT);
    daemonReturns(
      Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        timestamp: new Date(Date.UTC(2026, 7, 20, 12, i)).toISOString(),
        fromMe: false,
        body: `Message ${i}`,
      }))
    );

    const res = await request(app).get("/api/contacts/kat_osman/conversation?limit=2");

    expect(res.body.total).toBe(5);
    expect(res.body.returned).toBe(2);
    expect(res.body.truncated).toBe(true);
    expect(res.body.messages.map((m: any) => m.body)).toEqual(["Message 3", "Message 4"]);
  });

  it("refuses when capture is switched off for the contact", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getById.mockReturnValue({ ...CONTACT, wa_capture: "off" });
    daemonReturns([]);

    const res = await request(app).get("/api/contacts/kat_osman/conversation");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("capture_disabled");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("409s when the contact has no WhatsApp number", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getById.mockReturnValue({ ...CONTACT, whatsapp: null });

    const res = await request(app).get("/api/contacts/kat_osman/conversation");

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_whatsapp_number");
  });

  it("404s for an unknown contact", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getById.mockReturnValue(undefined);

    const res = await request(app).get("/api/contacts/nobody/conversation");

    expect(res.status).toBe(404);
  });

  it("rejects an out-of-range window rather than hammering the daemon", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getById.mockReturnValue(CONTACT);
    daemonReturns([]);

    const res = await request(app).get("/api/contacts/kat_osman/conversation?days=9999");

    expect(res.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("502s when the daemon is unreachable", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getById.mockReturnValue(CONTACT);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const res = await request(app).get("/api/contacts/kat_osman/conversation");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("daemon_unavailable");
  });
});

// ── POST /api/contacts/sync-groups ────────────────────────────────────────────

describe("POST /api/contacts/sync-groups", () => {
  afterEach(() => vi.unstubAllGlobals());

  const CONTACTS = [
    { id: "kat_osman", name: "Kat Osman", whatsapp: "+44 7931 460 181", whatsapp_groups: null },
    { id: "no_number", name: "No Number", whatsapp: null, whatsapp_groups: null },
  ];

  function daemonChats(chats: Array<{ chatJid: string }>) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ chats }),
    }));
  }

  it("reports the groups a contact belongs to", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getAll.mockReturnValue(CONTACTS);
    daemonChats([{ chatJid: "123@g.us" }, { chatJid: "456@g.us" }]);

    const res = await request(app).post("/api/contacts/sync-groups").send({ dry_run: true });

    expect(res.status).toBe(200);
    expect(res.body.contactsChecked).toBe(1); // the contact with no number is skipped
    expect(res.body.results[0].groups).toEqual(["123@g.us", "456@g.us"]);
    expect(res.body.results[0].changed).toBe(true);
  });

  it("ignores 1:1 chats, keeping only group JIDs", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getAll.mockReturnValue([CONTACTS[0]]);
    daemonChats([{ chatJid: "123@g.us" }, { chatJid: "447931460181@s.whatsapp.net" }]);

    const res = await request(app).post("/api/contacts/sync-groups").send({ dry_run: true });

    expect(res.body.results[0].groups).toEqual(["123@g.us"]);
  });

  it("reports no change when the stored value already matches", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getAll.mockReturnValue([{ ...CONTACTS[0], whatsapp_groups: "123@g.us,456@g.us" }]);
    daemonChats([{ chatJid: "456@g.us" }, { chatJid: "123@g.us" }]);

    const res = await request(app).post("/api/contacts/sync-groups").send({ dry_run: true });

    // Sorted before comparison, so daemon ordering must not cause a rewrite.
    expect(res.body.contactsChanged).toBe(0);
  });

  it("writes nothing on a dry run", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getAll.mockReturnValue([CONTACTS[0]]);
    daemonChats([{ chatJid: "123@g.us" }]);

    await request(app).post("/api/contacts/sync-groups").send({ dry_run: true });

    expect(mockContacts.loadFromDatabase).not.toHaveBeenCalled();
  });

  it("limits the sync to one contact when a name is given", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getAll.mockReturnValue([
      ...CONTACTS,
      { id: "annie_tan", name: "Annie Tan", whatsapp: "+447957370446", whatsapp_groups: null },
    ]);
    daemonChats([{ chatJid: "123@g.us" }]);

    const res = await request(app)
      .post("/api/contacts/sync-groups")
      .send({ dry_run: true, contact_name: "Kat" });

    expect(res.body.contactsChecked).toBe(1);
    expect(res.body.results[0].contact).toBe("Kat Osman");
  });

  it("502s when the daemon cannot be reached", async () => {
    const { app, mockContacts } = makeRouter();
    mockContacts.getAll.mockReturnValue([CONTACTS[0]]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const res = await request(app).post("/api/contacts/sync-groups").send({ dry_run: true });

    expect(res.status).toBe(502);
  });
});
