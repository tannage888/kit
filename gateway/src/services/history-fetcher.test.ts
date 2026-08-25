/**
 * HistoryFetcher unit tests
 *
 * Mocks global.fetch — no Baileys socket or real HTTP needed.
 * The fetcher calls the external daemon REST endpoint; we mock that response.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HistoryFetcher } from "./history-fetcher.js";
import type { TrackedContact, WhatsAppMessage } from "../types.js";

// ── Config mock ───────────────────────────────────────────────────────────────

vi.mock("../config.js", () => ({
  config: {
    SWEEP_MAX_MESSAGES_PER_CONTACT: 500,
    SWEEP_CONVERSATION_GAP_HOURS: 8,
    SWEEP_MAX_THREAD_AGE_HOURS: 24,
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
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
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
      fakeMsg(NOW - 30 * HOUR, "Hey!", false),
      fakeMsg(NOW - 29 * HOUR, "How are you?", true),
      fakeMsg(NOW - 28 * HOUR, "Good thanks!", false),
    ];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - 3 * DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(3);
    expect(threads[0].contact.name).toBe("Alice");
  });

  it("splits messages into two threads when gap exceeds 8 hours", async () => {
    const thread1 = [
      fakeMsg(NOW - 40 * HOUR, "Morning message", false),
      fakeMsg(NOW - 39 * HOUR, "Morning reply", true),
    ];
    const thread2 = [
      fakeMsg(NOW - 20 * HOUR, "Afternoon message", false),
      fakeMsg(NOW - 19 * HOUR, "Afternoon reply", true),
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
      fakeMsg(NOW - 40 * HOUR, "Solo message in thread 1", false),
      fakeMsg(NOW - 20 * HOUR, "Message A", false),
      fakeMsg(NOW - 19 * HOUR, "Message B", true),
    ];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - 2 * DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(3);
    expect(threads[0].messages[0].body).toBe("Solo message in thread 1");
  });

  it("emits a trailing orphan as its own single-message thread", async () => {
    const msgs = [fakeMsg(NOW - 10 * HOUR, "Hey! Ping.", true)];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(1);
    expect(threads[0].messages[0].body).toBe("Hey! Ping.");
  });

  it("merges two sequential orphans separated by a large gap into one thread", async () => {
    const msgs = [
      fakeMsg(NOW - 8 * DAY, "Hey, how's things?", true),
      fakeMsg(NOW - 10 * HOUR, "Sorry for the late reply — all good!", false),
    ];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - 14 * DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(2);
  });

  it("stops collecting when hard cap is reached", async () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      fakeMsg(NOW - (30 - i) * HOUR, `Message ${i}`, i % 2 === 0)
    );
    const fetcher = makeFetcher(msgs);
    (fetcher as any).maxMessages = 5;

    const threads = await fetcher.fetchSince(JID, contact, NOW - 3 * DAY);
    const kept = threads.flatMap((t) => t.messages.map((m) => m.body));
    expect(kept.length).toBeLessThanOrEqual(5);
    // Keeps the most recent messages — taking the oldest would summarise
    // stale history and drop what just happened.
    expect(kept).toContain("Message 9");
    expect(kept).not.toContain("Message 0");
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
    const t1 = NOW - 30 * HOUR;
    const t2 = NOW - 29 * HOUR;
    const msgs = [
      fakeMsg(t1, "First", true),
      fakeMsg(t2, "Second", false),
    ];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - 3 * DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].startedAt).toBe(t1);
    expect(threads[0].lastActivityAt).toBe(t2);
  });

  // ── Settling: one conversation, one interaction ────────────────────────────

  it("holds back a conversation that is still in progress", async () => {
    const msgs = [
      fakeMsg(NOW - 3 * HOUR, "Hey", false),
      fakeMsg(NOW - 2 * HOUR, "Hi — how did it go?", true),
      fakeMsg(NOW - 30 * 60 * 1000, "Really well actually", false),
    ];
    const fetcher = makeFetcher(msgs);

    // Silent for only 30 minutes against an 8 hour gap: they are still talking.
    expect(await fetcher.fetchSince(JID, contact, NOW - DAY)).toEqual([]);
  });

  it("returns the conversation once it has gone quiet", async () => {
    const msgs = [
      fakeMsg(NOW - 12 * HOUR, "Hey", false),
      fakeMsg(NOW - 11 * HOUR, "Hi — how did it go?", true),
      fakeMsg(NOW - 10 * HOUR, "Really well actually", false),
    ];
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(3);
  });

  it("captures a conversation that never goes quiet once it passes the age limit", async () => {
    // Without this a chat with a message every few hours would never be logged.
    const msgs = Array.from({ length: 12 }, (_, i) =>
      fakeMsg(NOW - (26 - i * 2) * HOUR, `Message ${i}`, i % 2 === 0)
    );
    const fetcher = makeFetcher(msgs);
    const threads = await fetcher.fetchSince(JID, contact, NOW - 3 * DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(12);
  });

  it("settles a finished conversation while holding back a newer one", async () => {
    const finished = [
      fakeMsg(NOW - 30 * HOUR, "Yesterday A", false),
      fakeMsg(NOW - 29 * HOUR, "Yesterday B", true),
    ];
    const ongoing = [
      fakeMsg(NOW - 2 * HOUR, "Today A", false),
      fakeMsg(NOW - 20 * 60 * 1000, "Today B", true),
    ];
    const fetcher = makeFetcher([...finished, ...ongoing]);
    const threads = await fetcher.fetchSince(JID, contact, NOW - 3 * DAY);

    expect(threads).toHaveLength(1);
    expect(threads[0].messages.map((m) => m.body)).toEqual(["Yesterday A", "Yesterday B"]);
  });

  it("yields one thread across successive sweeps of a single conversation", async () => {
    // Regression: sweeps run every 3 hours against an 8 hour gap, so an
    // afternoon conversation used to be cut at each sweep boundary and
    // summarised several times over. Kat had five entries for one chat,
    // their created_at timestamps exactly one sweep interval apart.
    const conversation = [
      fakeMsg(NOW - 12 * HOUR, "Message 1", false),
      fakeMsg(NOW - 11 * HOUR, "Message 2", true),
      fakeMsg(NOW - 10 * HOUR, "Message 3", false),
      fakeMsg(NOW - 9 * HOUR, "Message 4", true),
    ];

    // Sweep while it is still running: nothing captured, watermark unmoved.
    vi.setSystemTime(NOW - 9 * HOUR + 60 * 1000);
    const midConversation = await makeFetcher(conversation).fetchSince(JID, contact, NOW - DAY);
    expect(midConversation).toEqual([]);

    // A later sweep, after it has gone quiet, captures the whole thing once.
    vi.setSystemTime(NOW);
    const afterwards = await makeFetcher(conversation).fetchSince(JID, contact, NOW - DAY);
    expect(afterwards).toHaveLength(1);
    expect(afterwards[0].messages).toHaveLength(4);
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
