/**
 * HistoryFetcher unit tests
 *
 * Uses a mock wa object with getStoredMessages — no Baileys socket needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HistoryFetcher } from "./history-fetcher.js";
import type { TrackedContact } from "../types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const contact: TrackedContact = {
  id: "contact-1",
  name: "Alice",
  whatsapp: "+447700900001",
  tier: 1,
  wa_capture: "auto",
  frequency: "Weekly",
  frequency_days: 7,
  last_contact: "2026-04-01",
};

const JID = "447700900001@s.whatsapp.net";

/** Create a fake Baileys IWebMessageInfo at the given epoch-ms */
function fakeRawMsg(
  timestampMs: number,
  body: string,
  fromMe = false,
  id = crypto.randomUUID()
) {
  return {
    key: { remoteJid: JID, fromMe, id },
    message: { conversation: body },
    messageTimestamp: Math.floor(timestampMs / 1000),
  };
}

// Config defaults used by HistoryFetcher
vi.mock("../config.js", () => ({
  config: {
    SWEEP_MAX_MESSAGES_PER_CONTACT: 500,
    SWEEP_CONVERSATION_GAP_HOURS: 8,
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a HistoryFetcher backed by a flat array of raw messages for the test JID. */
function makeFetcher(messages: object[]): HistoryFetcher {
  const wa = { getStoredMessages: vi.fn().mockReturnValue(messages) };
  return new HistoryFetcher(wa);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("HistoryFetcher", () => {
  const NOW = new Date("2026-04-12T12:00:00Z").getTime();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it("returns empty array when no messages exist", async () => {
    const fetcher = makeFetcher([]);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);
    expect(threads).toEqual([]);
  });

  it("returns empty array when all messages are older than watermark", async () => {
    const oldMsg = fakeRawMsg(NOW - 2 * DAY, "old message");
    const fetcher = makeFetcher([oldMsg]);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);
    expect(threads).toEqual([]);
  });

  it("returns a single thread for messages within the gap window", async () => {
    const msgs = [
      fakeRawMsg(NOW - 2 * HOUR, "Hey!", false),
      fakeRawMsg(NOW - 1 * HOUR, "How are you?", true),
      fakeRawMsg(NOW - 30 * 60 * 1000, "Good thanks!", false),
    ];
    const fetcher = makeFetcher(msgs);
    const watermark = NOW - DAY;
    const threads = await fetcher.fetchSince(JID, contact, watermark);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(3);
    expect(threads[0].contact.name).toBe("Alice");
  });

  it("splits messages into two threads when gap exceeds 8 hours", async () => {
    const thread1 = [
      fakeRawMsg(NOW - 20 * HOUR, "Morning message", false),
      fakeRawMsg(NOW - 19 * HOUR, "Morning reply", true),
    ];
    const thread2 = [
      fakeRawMsg(NOW - 2 * HOUR, "Afternoon message", false),
      fakeRawMsg(NOW - 1 * HOUR, "Afternoon reply", true),
    ];
    const fetcher = makeFetcher([...thread1, ...thread2]);
    const watermark = NOW - 2 * DAY;
    const threads = await fetcher.fetchSince(JID, contact, watermark);

    expect(threads).toHaveLength(2);
    expect(threads[0].messages).toHaveLength(2);
    expect(threads[1].messages).toHaveLength(2);
    expect(threads[0].startedAt).toBeLessThan(threads[1].startedAt);
  });

  it("discards threads with only one message", async () => {
    const msgs = [
      fakeRawMsg(NOW - 20 * HOUR, "Solo message in thread 1", false),
      fakeRawMsg(NOW - 2 * HOUR, "Message A", false),
      fakeRawMsg(NOW - 1 * HOUR, "Message B", true),
    ];
    const fetcher = makeFetcher(msgs);
    const watermark = NOW - 2 * DAY;
    const threads = await fetcher.fetchSince(JID, contact, watermark);

    // Thread 1 has only 1 message — discarded. Thread 2 has 2 — kept.
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(2);
  });

  it("stops collecting when hard cap is reached", async () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      fakeRawMsg(NOW - (10 - i) * HOUR, `Message ${i}`, i % 2 === 0)
    );
    const fetcher = makeFetcher(msgs);
    (fetcher as any).maxMessages = 5;

    const threads = await fetcher.fetchSince(JID, contact, NOW - 2 * DAY);
    const totalMessages = threads.reduce((sum, t) => sum + t.messages.length, 0);
    expect(totalMessages).toBeLessThanOrEqual(5);
  });

  it("skips group messages (JIDs ending in @g.us)", async () => {
    const groupMsg = {
      key: { remoteJid: "12345@g.us", fromMe: false, id: "group-msg" },
      message: { conversation: "Group message" },
      messageTimestamp: Math.floor((NOW - HOUR) / 1000),
    };
    const directMsg1 = fakeRawMsg(NOW - 2 * HOUR, "Direct A", false);
    const directMsg2 = fakeRawMsg(NOW - 1 * HOUR, "Direct B", true);
    const fetcher = makeFetcher([groupMsg, directMsg1, directMsg2]);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);

    const totalMessages = threads.reduce((sum, t) => sum + t.messages.length, 0);
    expect(totalMessages).toBe(2);
  });

  it("skips media-only messages with no text body", async () => {
    const mediaMsg = {
      key: { remoteJid: JID, fromMe: false, id: "media-msg" },
      message: { imageMessage: {} }, // no caption
      messageTimestamp: Math.floor((NOW - 2 * HOUR) / 1000),
    };
    const textMsg1 = fakeRawMsg(NOW - 90 * 60 * 1000, "Text A", false);
    const textMsg2 = fakeRawMsg(NOW - HOUR, "Text B", true);
    const fetcher = makeFetcher([mediaMsg, textMsg1, textMsg2]);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);

    const totalMessages = threads.reduce((sum, t) => sum + t.messages.length, 0);
    expect(totalMessages).toBe(2);
  });

  it("returns empty array when no messages are buffered for the JID", async () => {
    const wa = { getStoredMessages: vi.fn().mockReturnValue([]) };
    const fetcher = new HistoryFetcher(wa);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);
    expect(threads).toEqual([]);
  });

  it("sets correct startedAt and lastActivityAt on threads", async () => {
    const t1 = NOW - 3 * HOUR;
    const t2 = NOW - 2 * HOUR;
    const msgs = [
      fakeRawMsg(t1, "First", true),
      fakeRawMsg(t2, "Second", false),
    ];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].startedAt).toBe(t1);
    expect(threads[0].lastActivityAt).toBe(t2);
  });
});
