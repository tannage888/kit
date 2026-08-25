/**
 * HistoryFetcher unit tests
 *
 * Mocks global.fetch — no Baileys socket or real HTTP needed.
 * The fetcher calls the external daemon REST endpoint; we mock that response.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HistoryFetcher } from "./history-fetcher.js";
import type { TrackedContact, WhatsAppMessage } from "../types.js";

// ── Config mock ───────────────────────────────────────────────────────────────

vi.mock("../config.js", () => ({
  config: {
    SWEEP_MAX_MESSAGES_PER_CONTACT: 500,
    SWEEP_CONVERSATION_GAP_HOURS: 8,
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GATEWAY_URL = "http://127.0.0.1:3142";
const JID = "447700900001@s.whatsapp.net";

const contact: TrackedContact = {
  id: "contact-1",
  name: "Alice",
  whatsapp: "+447700900001",
  tier: 1,
  wa_capture: "auto",
  frequency: "Weekly",
  frequency_days: 7,
  last_contact: "2026-04-01",
  whatsapp_capture: "disabled",
  linkedin_username: null,
  linkedin_capture: "disabled",
  instagram_username: null,
  instagram_capture: "disabled",
  whatsapp_groups: null,
  url: null,
  active: true,
};

function fakeMsg(
  timestampMs: number,
  body: string,
  fromMe = false
): WhatsAppMessage {
  return {
    remoteJid: JID,
    fromMe,
    body,
    timestamp: timestampMs,
    messageId: crypto.randomUUID(),
  };
}

function makeFetcher(messages: WhatsAppMessage[]): HistoryFetcher {
  vi.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ messages }),
  } as unknown as Response);
  return new HistoryFetcher(GATEWAY_URL);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("HistoryFetcher", () => {
  const NOW = new Date("2026-04-12T12:00:00Z").getTime();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when no messages exist", async () => {
    const fetcher = makeFetcher([]);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);
    expect(threads).toEqual([]);
  });

  it("returns empty array when all messages are older than watermark", async () => {
    const oldMsg = fakeMsg(NOW - 2 * DAY, "old message");
    const fetcher = makeFetcher([oldMsg]);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);
    expect(threads).toEqual([]);
  });

  it("returns a single thread for messages within the gap window", async () => {
    const msgs = [
      fakeMsg(NOW - 2 * HOUR, "Hey!", false),
      fakeMsg(NOW - 1 * HOUR, "How are you?", true),
      fakeMsg(NOW - 30 * 60 * 1000, "Good thanks!", false),
    ];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(3);
    expect(threads[0].contact.name).toBe("Alice");
  });

  it("splits messages into two threads when gap exceeds 8 hours", async () => {
    const thread1 = [
      fakeMsg(NOW - 20 * HOUR, "Morning message", false),
      fakeMsg(NOW - 19 * HOUR, "Morning reply", true),
    ];
    const thread2 = [
      fakeMsg(NOW - 2 * HOUR, "Afternoon message", false),
      fakeMsg(NOW - 1 * HOUR, "Afternoon reply", true),
    ];
    const fetcher = makeFetcher([...thread1, ...thread2]);
    const threads = await fetcher.fetchSince(JID, contact, NOW - 2 * DAY);

    expect(threads).toHaveLength(2);
    expect(threads[0].messages).toHaveLength(2);
    expect(threads[1].messages).toHaveLength(2);
    expect(threads[0].startedAt).toBeLessThan(threads[1].startedAt);
  });

  it("absorbs a preceding orphan block into the next thread", async () => {
    const msgs = [
      fakeMsg(NOW - 20 * HOUR, "Solo message in thread 1", false),
      fakeMsg(NOW - 2 * HOUR, "Message A", false),
      fakeMsg(NOW - 1 * HOUR, "Message B", true),
    ];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - 2 * DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(3);
    expect(threads[0].messages[0].body).toBe("Solo message in thread 1");
  });

  it("emits a trailing orphan as its own single-message thread", async () => {
    const msgs = [fakeMsg(NOW - 1 * HOUR, "Hey! Ping.", true)];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(1);
    expect(threads[0].messages[0].body).toBe("Hey! Ping.");
  });

  it("merges two sequential orphans separated by a large gap into one thread", async () => {
    const msgs = [
      fakeMsg(NOW - 8 * DAY, "Hey, how's things?", true),
      fakeMsg(NOW - 1 * HOUR, "Sorry for the late reply — all good!", false),
    ];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - 14 * DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(2);
  });

  it("stops collecting when hard cap is reached", async () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      fakeMsg(NOW - (10 - i) * HOUR, `Message ${i}`, i % 2 === 0)
    );
    const fetcher = makeFetcher(msgs);
    (fetcher as any).maxMessages = 5;

    const threads = await fetcher.fetchSince(JID, contact, NOW - 2 * DAY);
    const totalMessages = threads.reduce((sum, t) => sum + t.messages.length, 0);
    expect(totalMessages).toBeLessThanOrEqual(5);
  });

  it("throws when daemon returns non-2xx status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);
    const fetcher = new HistoryFetcher(GATEWAY_URL);
    await expect(fetcher.fetchSince(JID, contact, NOW - DAY)).rejects.toThrow("503");
  });

  it("returns empty array when no messages are buffered for the JID", async () => {
    const fetcher = makeFetcher([]);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);
    expect(threads).toEqual([]);
  });

  it("sets correct startedAt and lastActivityAt on threads", async () => {
    const t1 = NOW - 3 * HOUR;
    const t2 = NOW - 2 * HOUR;
    const msgs = [
      fakeMsg(t1, "First", true),
      fakeMsg(t2, "Second", false),
    ];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].startedAt).toBe(t1);
    expect(threads[0].lastActivityAt).toBe(t2);
  });

  it("calls the daemon with the correct URL and from parameter", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] }),
    } as unknown as Response);

    const fetcher = new HistoryFetcher(GATEWAY_URL);
    const sinceMs = NOW - DAY;
    await fetcher.fetchSince(JID, contact, sinceMs);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent(JID));
    expect(calledUrl).toContain("from=");
  });
});
