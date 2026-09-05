import { describe, it, expect, vi } from "vitest";
import { ImportIngestor } from "./import-ingestor.js";
import type { TrackedContact } from "../types.js";

const JID = "447700900001@s.whatsapp.net";
const DAEMON = "http://127.0.0.1:3142";

function makeContact(overrides: Partial<TrackedContact> = {}): TrackedContact {
  return {
    id: "contact-1",
    name: "Alice",
    whatsapp: "+447700900001",
    tier: 1,
    wa_capture: "on_demand",
    frequency: "Monthly",
    frequency_days: 30,
    last_contact: "2026-03-01",
    whatsapp_capture: "enabled",
    linkedin_username: null,
    linkedin_capture: "disabled",
    instagram_username: null,
    instagram_capture: "disabled",
    whatsapp_groups: null,
    email: null,
  url: null,
    active: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as unknown as Response;
}

function transcript(messages: Array<{ id: string; body: string; fromMe?: boolean; ts?: string }>) {
  return {
    messages: messages.map((m) => ({
      id: m.id,
      timestamp: m.ts ?? "2026-04-25T10:00:00.000Z",
      fromMe: m.fromMe ?? false,
      body: m.body,
    })),
    watermark: { previous: null, new: "2026-04-25T10:30:00.000Z" },
  };
}

function makeDeps(opts: {
  contact?: TrackedContact | undefined;
  triggerCapture?: boolean;
  fetchImpl?: ReturnType<typeof vi.fn>;
}) {
  const contacts = {
    getByJid: vi.fn().mockReturnValue(opts.contact),
  };
  const router = {
    handleMessage: vi.fn(),
    triggerCapture: vi.fn().mockResolvedValue(opts.triggerCapture ?? true),
  };
  const fetchFn = opts.fetchImpl ?? vi.fn();
  const ingestor = new ImportIngestor(
    contacts as any,
    router as any,
    DAEMON,
    fetchFn as any
  );
  return { ingestor, contacts, router, fetchFn };
}

describe("ImportIngestor.ingest", () => {
  it("happy path: fetches transcript, routes each message, drains, acks", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          transcript([
            { id: "m1", body: "Hey" },
            { id: "m2", body: "Want to grab lunch?", fromMe: true },
          ])
        )
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const { ingestor, router } = makeDeps({
      contact: makeContact(),
      triggerCapture: true,
      fetchImpl: fetchFn,
    });

    const result = await ingestor.ingest(JID);

    expect(result).toEqual({ status: "ok", ingested: 2, captureQueued: true });
    expect(router.handleMessage).toHaveBeenCalledTimes(2);
    expect(router.handleMessage).toHaveBeenNthCalledWith(1, {
      remoteJid: JID,
      fromMe: false,
      body: "Hey",
      timestamp: Date.parse("2026-04-25T10:00:00.000Z"),
      messageId: "m1",
    });
    expect(router.triggerCapture).toHaveBeenCalledWith("contact-1", {
      source: "zip-import",
    });

    // Verify ack call
    const ackCall = fetchFn.mock.calls[1]!;
    expect(ackCall[0]).toBe(`${DAEMON}/api/chats/${encodeURIComponent(JID)}/ack`);
    expect(ackCall[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ watermark: "2026-04-25T10:30:00.000Z" }),
    });
  });

  it("skips when chatJid does not match a tracked contact", async () => {
    const { ingestor, router, fetchFn } = makeDeps({ contact: undefined });

    const result = await ingestor.ingest(JID);

    expect(result).toEqual({ status: "skipped", reason: "unknown_contact" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(router.handleMessage).not.toHaveBeenCalled();
  });

  it("skips when whatsapp_capture is disabled", async () => {
    const { ingestor, router, fetchFn } = makeDeps({
      contact: makeContact({ whatsapp_capture: "disabled" }),
    });

    const result = await ingestor.ingest(JID);

    expect(result).toEqual({ status: "skipped", reason: "capture_disabled" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(router.handleMessage).not.toHaveBeenCalled();
  });

  it("skips when transcript is empty (no new messages since last ack)", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse(transcript([])));
    const { ingestor, router } = makeDeps({
      contact: makeContact(),
      fetchImpl: fetchFn,
    });

    const result = await ingestor.ingest(JID);

    expect(result).toEqual({ status: "skipped", reason: "empty_transcript" });
    expect(router.handleMessage).not.toHaveBeenCalled();
    expect(router.triggerCapture).not.toHaveBeenCalled();
    // No ack on empty — nothing changed.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns captureQueued=false when wa_capture:off drops everything but still acks", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(transcript([{ id: "m1", body: "Hi" }])))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    // triggerCapture returns false because handleMessage dropped the message
    // (router buffer is empty)
    const { ingestor, router } = makeDeps({
      contact: makeContact({ wa_capture: "off" }),
      triggerCapture: false,
      fetchImpl: fetchFn,
    });

    const result = await ingestor.ingest(JID);

    expect(result).toEqual({ status: "ok", ingested: 1, captureQueued: false });
    expect(router.handleMessage).toHaveBeenCalledTimes(1);
    expect(router.triggerCapture).toHaveBeenCalledWith("contact-1", {
      source: "zip-import",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2); // transcript + ack
  });

  it("throws when daemon transcript fetch fails", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, false, 500));
    const { ingestor } = makeDeps({
      contact: makeContact(),
      fetchImpl: fetchFn,
    });

    await expect(ingestor.ingest(JID)).rejects.toThrow(/transcript fetch failed/i);
  });

  it("does not throw when ack call fails — best-effort", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(transcript([{ id: "m1", body: "Hi" }])))
      .mockRejectedValueOnce(new Error("network"));
    const { ingestor } = makeDeps({
      contact: makeContact(),
      triggerCapture: true,
      fetchImpl: fetchFn,
    });

    const result = await ingestor.ingest(JID);
    expect(result.status).toBe("ok");
  });
});
