/**
 * MCP tool tests — Open Brain propagation.
 *
 * Kit writes to Supabase and to Open Brain. Open Brain thoughts are what feed
 * prep cards and draft context later, so any edit that lands in Supabase but
 * not in Open Brain leaves the two stores disagreeing — with the stale one
 * driving future context. These tests pin that propagation down.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// tools.ts reads these at module load via requireEnv().
process.env.SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-key";
process.env.OPEN_BRAIN_URL ??= "https://brain.supabase.co";
process.env.OPEN_BRAIN_SERVICE_KEY ??= "brain-key";

// ── Supabase stub ─────────────────────────────────────────────────────────────

const state: {
  contacts: any[];
  interactions: any[];
  updates: Array<{ table: string; fields: Record<string, unknown> }>;
} = { contacts: [], interactions: [], updates: [] };

function tableRows(table: string) {
  return table === "contacts" ? state.contacts : state.interactions;
}

/** Minimal thenable query builder covering the shapes tools.ts uses. */
function makeQuery(table: string) {
  let rows = [...tableRows(table)];
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return q;
    },
    or: () => q,
    is: (col: string, val: unknown) => {
      rows = rows.filter((r) => (r[col] ?? null) === val);
      return q;
    },
    not: (col: string, _op: string, _val: unknown) => {
      rows = rows.filter((r) => (r[col] ?? null) !== null);
      return q;
    },
    order: () => q,
    ilike: (col: string, pattern: string) => {
      const needle = pattern.replace(/%/g, "").toLowerCase();
      rows = rows.filter((r) => String(r[col] ?? "").toLowerCase().includes(needle));
      return q;
    },
    limit: (n: number) => {
      rows = rows.slice(0, n);
      return q;
    },
    single: async () => ({ data: rows[0] ?? null, error: null }),
    update: (fields: Record<string, unknown>) => {
      state.updates.push({ table, fields });
      return q;
    },
    insert: () => q,
    then: (resolve: (v: any) => void) => resolve({ data: rows, error: null }),
  };
  return q;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    schema: () => ({ from: (table: string) => makeQuery(table) }),
  }),
}));

// ── Context binder stub ───────────────────────────────────────────────────────

const captured: any[] = [];
let captureSucceeds = true;

vi.mock("../context-binding/index.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    ContextBinder: class {
      async getContext() {
        return [];
      }
      async captureThought(opts: any) {
        captured.push(opts);
        return {
          success: captureSucceeds,
          openbrain: captureSucceeds,
          supabaseFallback: false,
          error: captureSucceeds ? null : "stub failure",
        };
      }
    },
  };
});

const { updateContactFields, updateInteractionNotes, formatTranscript, getContact, kitPrepCard, kitDraftContext, sendMessage } = await import("./tools.js");
const { ThoughtType } = await import("../context-binding/index.js");

const CONTACT = {
  id: "becks_tan_potato",
  name: "Becks Tan (Potato)",
  tier: 1,
  frequency: "Monthly",
  frequency_days: 30,
  last_contact: "2026-08-16",
  active: true,
};

beforeEach(() => {
  state.contacts = [{ ...CONTACT }];
  state.interactions = [];
  state.updates = [];
  captured.length = 0;
  captureSucceeds = true;
});

// ── update-contact ────────────────────────────────────────────────────────────

describe("updateContactFields", () => {
  it("persists background and interests, which previously had no tool at all", async () => {
    await updateContactFields({
      contact_name: "Becks",
      origin_story: "My cousin. Lives in Singapore.",
      special_interests: "Did karate a long time ago.",
    });

    const update = state.updates.find((u) => u.table === "contacts");
    expect(update?.fields.origin_story).toBe("My cousin. Lives in Singapore.");
    expect(update?.fields.special_interests).toBe("Did karate a long time ago.");
  });

  it("propagates the change to Open Brain", async () => {
    await updateContactFields({
      contact_name: "Becks",
      origin_story: "My cousin. Lives in Singapore.",
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].thoughtType).toBe(ThoughtType.STATUS_CHANGE);
    expect(captured[0].content).toContain("My cousin. Lives in Singapore.");
    expect(captured[0].people).toContain("Becks Tan (Potato)");
  });

  it("does not capture anything when no fields changed", async () => {
    const msg = await updateContactFields({ contact_name: "Becks" });

    expect(msg).toContain("No changes");
    expect(captured).toHaveLength(0);
  });

  it("surfaces an Open Brain failure rather than reporting a clean success", async () => {
    captureSucceeds = false;

    const msg = await updateContactFields({ contact_name: "Becks", tier: 2 });

    expect(msg).toContain("Open Brain propagation failed");
  });
});

// ── update-interaction ────────────────────────────────────────────────────────

describe("updateInteractionNotes", () => {
  beforeEach(() => {
    state.interactions = [
      {
        id: "int-1",
        contact_id: "becks_tan_potato",
        date: "2026-08-16",
        channel: "whatsapp",
        notes: "Original — asked about smoking.",
      },
    ];
  });

  it("replaces the notes on the matching interaction", async () => {
    await updateInteractionNotes({
      contact_name: "Becks",
      date: "2026-08-16",
      notes: "Corrected — did not ask about smoking.",
    });

    const update = state.updates.find((u) => u.table === "interaction_log");
    expect(update?.fields.notes).toBe("Corrected — did not ask about smoking.");
  });

  it("appends a correction to Open Brain carrying both versions", async () => {
    await updateInteractionNotes({
      contact_name: "Becks",
      date: "2026-08-16",
      notes: "Corrected — did not ask about smoking.",
      reason: "verified against WhatsApp capture",
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].extraTopics).toContain("correction");
    // Both the new and superseded text must survive — Open Brain is append-only,
    // so the original thought is still out there and needs to be identifiable.
    expect(captured[0].content).toContain("Corrected — did not ask about smoking.");
    expect(captured[0].content).toContain("Original — asked about smoking.");
    expect(captured[0].content).toContain("verified against WhatsApp capture");
  });

  it("reports when there is no interaction on that date", async () => {
    const msg = await updateInteractionNotes({
      contact_name: "Becks",
      date: "2026-01-01",
      notes: "anything",
    });

    expect(msg).toContain("No interaction logged");
    expect(state.updates).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it("refuses to guess when a date has more than one interaction", async () => {
    state.interactions.push({
      id: "int-2",
      contact_id: "becks_tan_potato",
      date: "2026-08-16",
      channel: "call",
      notes: "A second one the same day.",
    });

    const msg = await updateInteractionNotes({
      contact_name: "Becks",
      date: "2026-08-16",
      notes: "anything",
    });

    expect(msg).toContain("refusing to update ambiguously");
    expect(state.updates).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it("warns loudly when Open Brain propagation fails, since the stores now differ", async () => {
    captureSucceeds = false;

    const msg = await updateInteractionNotes({
      contact_name: "Becks",
      date: "2026-08-16",
      notes: "Corrected.",
    });

    expect(msg).toContain("WARNING");
    expect(msg).toContain("disagree");
  });
});

// ── get-conversation ──────────────────────────────────────────────────────────

describe("formatTranscript", () => {
  const base = {
    contact: { id: "kat_osman", name: "Kat Osman" },
    from: "2026-08-08T00:00:00.000Z",
    to: "2026-08-22T00:00:00.000Z",
    total: 2,
    returned: 2,
    truncated: false,
  };

  const msg = (iso: string, fromMe: boolean, body: string) => ({
    timestamp: Date.parse(iso),
    fromMe,
    body,
  });

  it("attributes each message to the right speaker", () => {
    const out = formatTranscript(
      { ...base, messages: [msg("2026-08-20T12:00:00Z", false, "Hello"), msg("2026-08-20T12:05:00Z", true, "Hi back")] },
      "Kat Osman",
      14
    );

    expect(out).toContain("**12:00 Kat Osman:** Hello");
    expect(out).toContain("**12:05 Me:** Hi back");
  });

  it("groups messages under a heading per day", () => {
    const out = formatTranscript(
      { ...base, messages: [msg("2026-08-19T09:00:00Z", false, "Day one"), msg("2026-08-20T09:00:00Z", false, "Day two")] },
      "Kat Osman",
      14
    );

    expect(out).toContain("### 2026-08-19");
    expect(out).toContain("### 2026-08-20");
    expect(out.indexOf("### 2026-08-19")).toBeLessThan(out.indexOf("### 2026-08-20"));
  });

  it("marks empty bodies rather than rendering a blank line", () => {
    // Media, reactions and deletions all arrive with an empty body.
    const out = formatTranscript(
      { ...base, total: 1, returned: 1, messages: [msg("2026-08-20T12:00:00Z", false, "")] },
      "Kat Osman",
      14
    );

    expect(out).toContain("[no text content");
  });

  it("says so plainly when the window is empty", () => {
    const out = formatTranscript(
      { ...base, total: 0, returned: 0, messages: [] },
      "Kat Osman",
      7
    );

    expect(out).toContain("No messages with Kat Osman in the last 7 days");
  });

  it("flags truncation so a partial transcript is never mistaken for the whole", () => {
    const out = formatTranscript(
      { ...base, total: 500, returned: 2, truncated: true, messages: [msg("2026-08-20T12:00:00Z", false, "Hi")] },
      "Kat Osman",
      14
    );

    expect(out).toContain("most recent 2 of 500");
  });
});

// ── Group provenance downstream ───────────────────────────────────────────────

describe("group interactions are kept out of direct-conversation context", () => {
  beforeEach(() => {
    state.interactions = [
      { id: "i1", contact_id: "becks_tan_potato", date: "2026-08-24", channel: "whatsapp", notes: "We spoke directly.", group_jid: null, group_name: null },
      { id: "i2", contact_id: "becks_tan_potato", date: "2026-08-25", channel: "whatsapp", notes: "Chatter in the family group.", group_jid: "111@g.us", group_name: "The Tan Family" },
    ];
  });

  it("separates group interactions from direct ones", async () => {
    const detail = await getContact("Becks");

    expect(detail?.recent_interactions.map((i) => i.id)).toEqual(["i1"]);
    expect(detail?.recent_group_interactions.map((i) => i.id)).toEqual(["i2"]);
  });

  it("keeps group chatter out of the prep card's recent interactions", async () => {
    const card = await kitPrepCard("Becks");

    const recent = card.slice(card.indexOf("### Recent interactions"), card.indexOf("### Recent group activity"));
    expect(recent).toContain("We spoke directly.");
    expect(recent).not.toContain("Chatter in the family group.");
  });

  it("surfaces group activity in its own labelled prep-card section", async () => {
    const card = await kitPrepCard("Becks");

    expect(card).toContain("### Recent group activity (not direct conversation)");
    expect(card).toContain("The Tan Family");
    expect(card).toContain("Chatter in the family group.");
  });

  it("omits group activity from draft context entirely", async () => {
    // Drafting should reference what you actually said to each other.
    const ctx = await kitDraftContext("Becks");

    expect(ctx).toContain("We spoke directly.");
    expect(ctx).not.toContain("Chatter in the family group.");
  });
});

// ── update-interaction disambiguation ─────────────────────────────────────────

describe("updateInteractionNotes with several entries on one date", () => {
  beforeEach(() => {
    state.interactions = [
      { id: "direct-1", contact_id: "becks_tan_potato", date: "2026-08-25", channel: "whatsapp", notes: "Direct chat.", group_jid: null, group_name: null },
      { id: "group-1", contact_id: "becks_tan_potato", date: "2026-08-25", channel: "whatsapp", notes: "Group chatter.", group_jid: "111@g.us", group_name: "The Tan Family" },
    ];
  });

  it("prefers the direct conversation when it is the only non-group candidate", async () => {
    const msg = await updateInteractionNotes({
      contact_name: "Becks",
      date: "2026-08-25",
      notes: "Corrected.",
    });

    expect(msg).toContain("Updated the 2026-08-25 interaction");
    expect(state.updates.find((u) => u.table === "interaction_log")?.fields.notes).toBe("Corrected.");
  });

  it("updates the group entry when its id is given explicitly", async () => {
    const msg = await updateInteractionNotes({
      contact_name: "Becks",
      date: "2026-08-25",
      notes: "Corrected group note.",
      interaction_id: "group-1",
    });

    expect(msg).toContain("Updated the 2026-08-25 interaction");
  });

  it("lists the candidates when the date is genuinely ambiguous", async () => {
    state.interactions.push(
      { id: "direct-2", contact_id: "becks_tan_potato", date: "2026-08-25", channel: "call", notes: "Another direct chat.", group_jid: null, group_name: null } as any
    );

    const msg = await updateInteractionNotes({
      contact_name: "Becks",
      date: "2026-08-25",
      notes: "Corrected.",
    });

    expect(msg).toContain("refusing to update ambiguously");
    expect(msg).toContain("direct-1");
    expect(msg).toContain("direct-2");
    expect(msg).toContain('group "The Tan Family"');
    expect(state.updates).toHaveLength(0);
  });

  it("reports a bad interaction_id rather than updating the wrong row", async () => {
    const msg = await updateInteractionNotes({
      contact_name: "Becks",
      date: "2026-08-25",
      notes: "Corrected.",
      interaction_id: "does-not-exist",
    });

    expect(msg).toContain("No interaction with id does-not-exist");
    expect(state.updates).toHaveLength(0);
  });
});

// ── send-message ──────────────────────────────────────────────────────────────

/**
 * Sending is the one tool here that reaches a real person and cannot be taken
 * back, so these tests pin the guards rather than the happy path: who it will
 * refuse to send to, and what it records afterwards.
 */
describe("sendMessage", () => {
  let fetchMock: any;

  beforeEach(() => {
    state.contacts = [{ ...CONTACT, whatsapp: "+65 9182 8173" }];
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, messageId: "3EB0ABC" }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends to the number on the contact's record, stripped to strict E.164", async () => {
    const msg = await sendMessage({ contact_name: "Becks", text: "Dinner Saturday?" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // The gateway's send schema rejects anything that is not bare E.164, so the
    // spaces the contact file stores have to come out here.
    expect(body.to).toBe("+6591828173");
    expect(body.text).toBe("Dinner Saturday?");
    expect(msg).toContain("Sent to Becks Tan (Potato)");
  });

  it("refuses an unknown contact without sending anything", async () => {
    const msg = await sendMessage({ contact_name: "Nobody At All", text: "Hello" });

    expect(msg).toContain("not found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a contact with no number rather than guessing one", async () => {
    state.contacts = [{ ...CONTACT, whatsapp: null }];

    const msg = await sendMessage({ contact_name: "Becks", text: "Hello" });

    expect(msg).toContain("no WhatsApp number on record");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("will not send an empty message", async () => {
    const msg = await sendMessage({ contact_name: "Becks", text: "   " });

    expect(msg).toContain("empty");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs the send as an interaction and moves the contact out of the queue", async () => {
    await sendMessage({ contact_name: "Becks", text: "Dinner Saturday?" });

    const update = state.updates.find((u) => u.table === "contacts");
    expect(update?.fields.last_contact).toBeTruthy();
    expect(update?.fields.next_action).toBeTruthy();

    const thought = captured.find((c) => c.thoughtType === ThoughtType.INTERACTION);
    expect(thought?.content).toContain("Dinner Saturday?");
  });

  it("records nothing when logging is switched off", async () => {
    await sendMessage({ contact_name: "Becks", text: "Dinner Saturday?", log: false });

    expect(state.updates).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it("reports a disconnected daemon as not sent, and logs nothing", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: "whatsapp_not_initialised" }),
      text: async () => "",
    });

    const msg = await sendMessage({ contact_name: "Becks", text: "Dinner Saturday?" });

    expect(msg).toContain("not connected");
    expect(msg).toContain("nothing was sent");
    // Nothing left, so nothing to record — a logged interaction here would be a lie.
    expect(state.updates).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it("does not log when the gateway rejects the send", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_body" }),
      text: async () => "invalid_body",
    });

    const msg = await sendMessage({ contact_name: "Becks", text: "Dinner Saturday?" });

    expect(msg).toContain("was not sent");
    expect(state.updates).toHaveLength(0);
  });
});
