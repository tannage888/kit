/**
 * Messages Kit sent itself are logged once, not twice.
 *
 * send-message writes its own interaction the moment a message leaves,
 * recording the WhatsApp message id. The 3-hourly sweep then reads that same
 * message back off WhatsApp. Before wa_message_id existed the sweep had no way
 * to recognise it and summarised it as a second, independent interaction —
 * Graham Boutilier's 2026-09-01 carried both the "Sent via WhatsApp: ..." row
 * and a sweep summary of the same exchange written the next morning.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// config.js is mocked below, but other modules loaded into this same worker
// read the real one at import time and exit the process if it is unset.
process.env.SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-key";
process.env.OPEN_BRAIN_URL ??= "https://brain.supabase.co";
process.env.OPEN_BRAIN_SERVICE_KEY ??= "brain-key";
process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";

vi.mock("../config.js", () => ({
  config: {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_KEY: "test-key",
    OPEN_BRAIN_URL: "https://brain.supabase.co",
    OPEN_BRAIN_SERVICE_KEY: "brain-key",
    ANTHROPIC_API_KEY: "test-anthropic-key",
  },
}));

// ── Supabase stub ─────────────────────────────────────────────────────────────

const state: {
  /** wa_message_ids already present in interaction_log */
  logged: string[];
  inserts: Array<Record<string, unknown>>;
  /** Set to make the wa_message_id lookup fail, as on an unmigrated database */
  lookupError: string | null;
} = { logged: [], inserts: [], lookupError: null };

function makeQuery(table: string) {
  let rows: any[] = [];
  const q: any = {
    select: () => q,
    eq: () => q,
    in: (_col: string, values: string[]) => {
      rows = state.logged
        .filter((id) => values.includes(id))
        .map((id) => ({ wa_message_id: id }));
      return q;
    },
    insert: async (row: Record<string, unknown>) => {
      if (table === "interaction_log") state.inserts.push(row);
      return { error: null };
    },
    update: () => q,
    then: (resolve: (v: any) => void) =>
      resolve(
        state.lookupError
          ? { data: null, error: { message: state.lookupError } }
          : { data: rows, error: null }
      ),
  };
  return q;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    schema: () => ({ from: (table: string) => makeQuery(table) }),
    from: (table: string) => makeQuery(table),
  }),
}));

// ── Anthropic stub ────────────────────────────────────────────────────────────

const summariseCalls: string[] = [];

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async ({ messages }: any) => {
        summariseCalls.push(messages[0].content);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                topics: "Summary of the thread.",
                follow_ups: "",
                sentiment: "neutral",
              }),
            },
          ],
        };
      },
    };
  },
}));

// ── Context binder stub ───────────────────────────────────────────────────────

vi.mock("../context-binding/index.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ContextBinder: class {
      async captureThought() {
        return { success: true };
      }
    },
  };
});

const { CapturePipeline } = await import("./capture.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONTACT = {
  id: "graham_boutilier",
  name: "Graham Boutilier",
  whatsapp: "+44 7700 900123",
  tier: 2,
} as any;

const mockContacts = { updateLastContact: vi.fn() } as any;

const msg = (messageId: string, over: Record<string, unknown> = {}) =>
  ({
    fromMe: true,
    body: "hello",
    timestamp: Date.parse("2026-09-01T14:35:00Z"),
    messageId,
    ...over,
  }) as any;

const threadOf = (...messages: any[]) =>
  ({
    contact: CONTACT,
    messages,
    startedAt: messages[0].timestamp,
    lastActivityAt: messages[messages.length - 1].timestamp,
    channel: "whatsapp",
  }) as any;

beforeEach(() => {
  state.logged = [];
  state.inserts = [];
  state.lookupError = null;
  summariseCalls.length = 0;
  mockContacts.updateLastContact.mockClear();
});

describe("processAndCommit — already-logged messages", () => {
  it("skips a thread whose only message Kit already logged when it sent it", async () => {
    state.logged = ["WA-SENT-1"];
    const pipeline = new CapturePipeline(mockContacts);

    const result = await pipeline.processAndCommit(threadOf(msg("WA-SENT-1")));

    expect(result).toBeNull();
    expect(state.inserts).toHaveLength(0);
    // Never reached Claude — a skipped thread costs nothing to summarise.
    expect(summariseCalls).toHaveLength(0);
  });

  it("still captures the reply that arrived after a logged send", async () => {
    state.logged = ["WA-SENT-1"];
    const pipeline = new CapturePipeline(mockContacts);

    const reply = msg("WA-REPLY-1", {
      fromMe: false,
      body: "Thanks — that means a lot.",
      timestamp: Date.parse("2026-09-01T18:02:00Z"),
    });

    const result = await pipeline.processAndCommit(threadOf(msg("WA-SENT-1"), reply));

    expect(result).not.toBeNull();
    expect(state.inserts).toHaveLength(1);
    // Only the reply is summarised — the send is already on the record verbatim.
    expect(summariseCalls[0]).toContain("Thanks — that means a lot.");
    expect(summariseCalls[0]).not.toContain("hello");
  });

  it("dates the entry from the messages that survived, not the logged one", async () => {
    state.logged = ["WA-SENT-1"];
    const pipeline = new CapturePipeline(mockContacts);

    const nextDay = msg("WA-REPLY-1", {
      fromMe: false,
      timestamp: Date.parse("2026-09-02T09:15:00Z"),
    });

    await pipeline.processAndCommit(threadOf(msg("WA-SENT-1"), nextDay));

    expect(state.inserts[0].date).toBe("2026-09-02");
  });

  it("captures normally when nothing in the thread has been logged", async () => {
    const pipeline = new CapturePipeline(mockContacts);

    const result = await pipeline.processAndCommit(
      threadOf(msg("WA-1"), msg("WA-2", { fromMe: false }))
    );

    expect(result).not.toBeNull();
    expect(state.inserts).toHaveLength(1);
  });

  it("fails open when the lookup errors, so an unmigrated database still captures", async () => {
    state.lookupError = 'column "wa_message_id" does not exist';
    const pipeline = new CapturePipeline(mockContacts);

    const result = await pipeline.processAndCommit(threadOf(msg("WA-1")));

    expect(result).not.toBeNull();
    expect(state.inserts).toHaveLength(1);
  });
});
