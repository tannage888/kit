/**
 * SweepScheduler unit tests
 *
 * All external dependencies are mocked — Supabase, HistoryFetcher,
 * CapturePipeline, and WhatsAppConnection. We test the scheduling
 * logic and per-contact sweep behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SweepScheduler } from "./sweep-scheduler.js";
import type { TrackedContact, ConversationThread } from "../types.js";

// ── Mock config ───────────────────────────────────────────────────────────────

vi.mock("../config.js", () => ({
  config: {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_KEY: "test-key",
    SWEEP_INTERVAL_HOURS: 3,
    SWEEP_INITIAL_LOOKBACK_DAYS: 7,
    PORT: 3141,
  },
}));

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const mockSupabaseSingle = vi.fn();
const mockSupabaseUpsert = vi.fn().mockResolvedValue({ error: null });

// Build a chainable eq object so .eq().eq().single() works for group watermarks
const makeEqChainable = (): any => ({
  eq: () => makeEqChainable(),
  single: mockSupabaseSingle,
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    schema: () => ({
      from: () => ({
        select: () => makeEqChainable(),
        upsert: mockSupabaseUpsert,
      }),
    }),
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeContact(overrides: Partial<TrackedContact> = {}): TrackedContact {
  return {
    id: "contact-1",
    name: "Alice",
    whatsapp: "+447700900001",
    tier: 1,
    wa_capture: "auto",
    frequency: "Monthly",
    frequency_days: 30,
    last_contact: "2026-03-01",
    whatsapp_capture: "disabled",
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

function makeThread(contact: TrackedContact, messageCount = 3): ConversationThread {
  const now = Date.now();
  const messages = Array.from({ length: messageCount }, (_, i) => ({
    remoteJid: "447700900001@s.whatsapp.net",
    fromMe: i % 2 === 0,
    body: `Message ${i}`,
    timestamp: now - (messageCount - i) * 60_000,
    messageId: `msg-${i}`,
    // Inbound messages come from the contact. Group threads are only
    // captured when the contact themselves spoke.
    senderJid: i % 2 === 0 ? undefined : "447700900001@s.whatsapp.net",
  }));
  return {
    contact,
    messages,
    startedAt: messages[0].timestamp,
    lastActivityAt: messages[messages.length - 1].timestamp,
    channel: "whatsapp" as const,
  };
}

// ── Build scheduler with mocked deps ─────────────────────────────────────────

function makeScheduler(contacts: TrackedContact[], threads: ConversationThread[][]) {
  const mockContacts = {
    getAll: vi.fn().mockReturnValue(contacts),
  };

  let threadIndex = 0;
  const mockFetcher = {
    fetchSince: vi.fn().mockImplementation(async () => {
      return threads[threadIndex++] ?? [];
    }),
  };

  // A committed capture resolves to its CaptureResult; null means the thread
  // was already logged and was skipped, which is only counted as such.
  const mockCapture = {
    processAndCommit: vi.fn().mockResolvedValue({ contactName: "Test Contact" }),
  };

  const scheduler = new SweepScheduler(
    mockContacts as any,
    mockCapture as any,
    mockFetcher as any
  );

  return { scheduler, mockContacts, mockFetcher, mockCapture };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SweepScheduler", () => {
  beforeEach(() => {
    // Vitest 4 no longer clears call history between tests — reset explicitly
    mockSupabaseSingle.mockClear();
    mockSupabaseUpsert.mockClear();
    mockSupabaseSingle.mockResolvedValue({ data: null, error: null });
    mockSupabaseUpsert.mockResolvedValue({ error: null });
    vi.useFakeTimers();
    // Default: daemon reports connected
    vi.spyOn(global, "fetch").mockImplementation(async (url: any) => ({
      ok: true,
      json: async () =>
        String(url).includes("sync-groups")
          ? { ok: true, contactsChanged: 0, totalGroupLinks: 0 }
          : String(url).includes("/api/chats")
            ? { chats: [] }
            : { connection: "connected" },
    }) as unknown as Response);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("skips contacts with wa_capture=off", async () => {
    const contact = makeContact({ wa_capture: "off" });
    const { scheduler, mockFetcher } = makeScheduler([contact], []);

    const result = await scheduler.runSweep();

    expect(result?.contactsSkipped).toBe(1);
    expect(result?.contactsSwept).toBe(0);
    expect(mockFetcher.fetchSince).not.toHaveBeenCalled();
  });

  it("skips contacts with no WhatsApp number", async () => {
    const contact = makeContact({ whatsapp: "" });
    const { scheduler, mockFetcher } = makeScheduler([contact], []);

    const result = await scheduler.runSweep();

    expect(result?.contactsSkipped).toBe(1);
    expect(mockFetcher.fetchSince).not.toHaveBeenCalled();
  });

  it("records zero threads when no new messages found", async () => {
    const contact = makeContact();
    const { scheduler, mockCapture } = makeScheduler([contact], [[]]); // empty thread list

    const result = await scheduler.runSweep();

    expect(result?.contactsSwept).toBe(1);
    expect(result?.threadsProcessed).toBe(0);
    expect(mockCapture.processAndCommit).not.toHaveBeenCalled();
  });

  it("processes threads and commits them", async () => {
    const contact = makeContact();
    const thread = makeThread(contact);
    const { scheduler, mockCapture } = makeScheduler([contact], [[thread]]);

    const result = await scheduler.runSweep();

    expect(result?.contactsSwept).toBe(1);
    expect(result?.threadsProcessed).toBe(1);
    expect(mockCapture.processAndCommit).toHaveBeenCalledWith(thread);
  });

  it("processes multiple threads for a single contact", async () => {
    const contact = makeContact();
    const threads = [makeThread(contact), makeThread(contact)];
    const { scheduler, mockCapture } = makeScheduler([contact], [threads]);

    const result = await scheduler.runSweep();

    expect(result?.threadsProcessed).toBe(2);
    expect(mockCapture.processAndCommit).toHaveBeenCalledTimes(2);
  });

  it("saves watermark after successful sweep", async () => {
    const contact = makeContact();
    const thread = makeThread(contact);
    const { scheduler } = makeScheduler([contact], [[thread]]);

    await scheduler.runSweep();

    expect(mockSupabaseUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: "contact-1" }),
      expect.any(Object)
    );
  });

  it("reconciles group membership before reading the contact list", async () => {
    // Membership drives which group JIDs get swept. Syncing after getAll()
    // would mean a newly joined group waits a further interval to appear.
    const contact = makeContact();
    const { scheduler, mockContacts } = makeScheduler([contact], [[]]);

    await scheduler.runSweep();

    const calls = (global.fetch as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((u: string) => u.includes("sync-groups"))).toBe(true);
    expect(mockContacts.getAll).toHaveBeenCalled();
  });

  it("still sweeps when the membership sync fails", async () => {
    const contact = makeContact();
    const { scheduler, mockFetcher } = makeScheduler([contact], [[]]);
    vi.spyOn(global, "fetch").mockImplementation(async (url: any) => {
      if (String(url).includes("sync-groups")) throw new Error("ECONNREFUSED");
      return { ok: true, json: async () => ({ connection: "connected" }) } as unknown as Response;
    });

    const result = await scheduler.runSweep();

    // Stale membership misses new groups; it must not stop the sweep.
    expect(result?.contactsSwept).toBe(1);
    expect(mockFetcher.fetchSince).toHaveBeenCalled();
  });

  it("aborts when WhatsApp is not connected", async () => {
    const contact = makeContact();
    const { scheduler, mockFetcher } = makeScheduler([contact], [[]]);
    // Override the default "connected" mock for this test
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ connection: "disconnected" }),
    } as unknown as Response);

    const result = await scheduler.runSweep();

    expect(result?.contactsSwept).toBe(0);
    expect(mockFetcher.fetchSince).not.toHaveBeenCalled();
  });

  it("returns null when a sweep is already running", async () => {
    const contact = makeContact();
    // Make fetchSince hang so the first sweep doesn't complete
    const mockContacts = { getAll: vi.fn().mockReturnValue([contact]) };
    const mockFetcher = {
      fetchSince: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 10_000))
      ),
    };
    const mockCapture = { processAndCommit: vi.fn() };

    const scheduler = new SweepScheduler(
      mockContacts as any,
      mockCapture as any,
      mockFetcher as any
    );

    // Kick off a sweep but don't await it yet
    const first = scheduler.runSweep();
    // Immediately try a second — should return null
    const second = await scheduler.runSweep();
    expect(second).toBeNull();

    // Advance timers to let first complete
    vi.runAllTimersAsync();
    await first;
  });

  it("records capture errors without stopping the sweep", async () => {
    const contact = makeContact();
    const thread = makeThread(contact);
    const { scheduler, mockCapture } = makeScheduler([contact], [[thread]]);
    mockCapture.processAndCommit.mockRejectedValue(new Error("Claude API timeout"));

    const result = await scheduler.runSweep();

    expect(result?.errors).toBe(1);
    expect(result?.details[0].error).toContain("Claude API timeout");
    // Sweep still completed (not thrown)
    expect(result?.contactsSwept).toBe(1);
  });

  it("filters to a single contact when contact_name is provided", async () => {
    const alice = makeContact({ id: "1", name: "Alice" });
    const bob = makeContact({ id: "2", name: "Bob", whatsapp: "+447700900002" });
    const { scheduler, mockFetcher } = makeScheduler([alice, bob], [[], []]);

    const result = await scheduler.runSweep("alice");

    expect(result?.details).toHaveLength(1);
    expect(result?.details[0].contactName).toBe("Alice");
    expect(mockFetcher.fetchSince).toHaveBeenCalledTimes(1);
  });

  it("uses default lookback when no prior sweep state exists", async () => {
    const contact = makeContact();
    const { scheduler, mockFetcher } = makeScheduler([contact], [[]]);
    mockSupabaseSingle.mockResolvedValue({ data: null }); // no prior state

    await scheduler.runSweep();

    const [, , sinceMs] = mockFetcher.fetchSince.mock.calls[0];
    // Should be approximately 7 days ago (SWEEP_INITIAL_LOOKBACK_DAYS)
    const expectedLookback = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(sinceMs).toBeGreaterThan(expectedLookback - 5000);
    expect(sinceMs).toBeLessThan(expectedLookback + 5000);
  });

  it("uses stored watermark when prior sweep state exists", async () => {
    const storedTs = Date.now() - 3 * 24 * 60 * 60 * 1000;
    mockSupabaseSingle.mockResolvedValue({
      data: { last_message_ts: storedTs, last_swept_at: new Date().toISOString() },
    });

    const contact = makeContact();
    const { scheduler, mockFetcher } = makeScheduler([contact], [[]]);

    await scheduler.runSweep();

    const [, , sinceMs] = mockFetcher.fetchSince.mock.calls[0];
    expect(sinceMs).toBe(storedTs);
  });

  it("skips a group thread the contact never spoke in", async () => {
    // Groups are swept once per tracked member, so most threads contain none
    // of this contact's own messages — filing those under their name would
    // record other people's conversation as theirs.
    const contact = makeContact({ whatsapp_groups: "120363199811716353@g.us" });
    const silent = makeThread(contact);
    for (const m of silent.messages) {
      m.fromMe = false;
      m.senderJid = "447700900999@s.whatsapp.net";
    }
    const { scheduler, mockCapture } = makeScheduler([contact], [[], [silent]]);

    const result = await scheduler.runSweep();

    expect(mockCapture.processAndCommit).not.toHaveBeenCalled();
    expect(result?.threadsProcessed).toBe(0);
    // The watermark still advances, so the thread is not re-examined forever.
    expect(mockSupabaseUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ group_jid: "120363199811716353@g.us" }),
      expect.any(Object)
    );
  });

  it("sweeps group JIDs when whatsapp_groups is set", async () => {
    const contact = makeContact({ whatsapp_groups: "120363199811716353@g.us" });
    const oneToOneThread = makeThread(contact);
    const groupThread = makeThread(contact);
    const { scheduler, mockFetcher, mockCapture } = makeScheduler(
      [contact],
      [[oneToOneThread], [groupThread]]
    );

    const result = await scheduler.runSweep();

    // fetchSince called twice: once for 1:1, once for the group JID
    expect(mockFetcher.fetchSince).toHaveBeenCalledTimes(2);
    expect(mockFetcher.fetchSince.mock.calls[1][0]).toBe("120363199811716353@g.us");

    // Both watermarks saved — one for 1:1, one for group
    expect(mockSupabaseUpsert).toHaveBeenCalledTimes(2);
    expect(mockSupabaseUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ group_jid: "120363199811716353@g.us" }),
      expect.any(Object)
    );

    // Counts aggregated across 1:1 and group
    expect(result?.threadsProcessed).toBe(2);
    expect(result?.details[0]?.messagesFound).toBe(
      oneToOneThread.messages.length + groupThread.messages.length
    );
    expect(mockCapture.processAndCommit).toHaveBeenCalledTimes(2);
  });

  it("skips group sweep when whatsapp_groups is null", async () => {
    const contact = makeContact({ whatsapp_groups: null });
    const thread = makeThread(contact);
    const { scheduler, mockFetcher } = makeScheduler([contact], [[thread]]);

    await scheduler.runSweep();

    // fetchSince only called once — no group JIDs to sweep
    expect(mockFetcher.fetchSince).toHaveBeenCalledTimes(1);
    expect(mockFetcher.fetchSince.mock.calls[0][0]).toContain("@s.whatsapp.net");
  });
});
