/**
 * Group capture privacy.
 *
 * A group thread contains people who never opted into Kit. Only the user and
 * the tracked contact may be named in what gets stored. Two mechanisms
 * enforce that: transcript labelling (no third-party identity reaches Claude)
 * and the summariser prompt (Claude does not describe whoever is left).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_KEY: "test-key",
    OPEN_BRAIN_URL: "https://brain.supabase.co",
    OPEN_BRAIN_SERVICE_KEY: "brain-key",
    ANTHROPIC_API_KEY: "test-anthropic-key",
  },
}));

const { speakerLabel, OTHER_PARTICIPANT_LABEL, contactParticipated, buildInteractionThought } = await import("./capture.js");
const CONTACT = {
  id: "kat_osman",
  name: "Kat Osman",
  whatsapp: "+44 7931 460 181",
  tier: 1,
} as any;

const msg = (over: Record<string, unknown> = {}) => ({
  fromMe: false,
  body: "hello",
  timestamp: 1_787_228_418_000,
  messageId: "m1",
  ...over,
}) as any;

const thread = (over: Record<string, unknown> = {}) => ({
  contact: CONTACT,
  messages: [],
  startedAt: 0,
  lastActivityAt: 0,
  channel: "whatsapp",
  ...over,
}) as any;

describe("speakerLabel", () => {
  it("labels the user's own messages as Me", () => {
    expect(speakerLabel(msg({ fromMe: true }), thread())).toBe("Me");
  });

  it("attributes every inbound 1:1 message to the contact", () => {
    // No sender id on a 1:1 thread — there is only one other person in it.
    expect(speakerLabel(msg(), thread())).toBe("Kat Osman");
  });

  it("names the tracked contact in a group when the sender matches", () => {
    const m = msg({ senderJid: "447931460181@s.whatsapp.net" });
    expect(speakerLabel(m, thread({ groupJid: "123@g.us" }))).toBe("Kat Osman");
  });

  it("matches the contact despite spaces in the stored number", () => {
    // Numbers are stored "+44 7931 460 181" but arrive as bare digits.
    const m = msg({ senderJid: "447931460181@s.whatsapp.net" });
    expect(speakerLabel(m, thread({ groupJid: "123@g.us" }))).not.toBe(OTHER_PARTICIPANT_LABEL);
  });

  it("anonymises other group members", () => {
    const m = msg({ senderJid: "447700900999@s.whatsapp.net" });
    expect(speakerLabel(m, thread({ groupJid: "123@g.us" }))).toBe(OTHER_PARTICIPANT_LABEL);
  });

  it("anonymises an unresolved sender rather than guessing it is the contact", () => {
    // An unmapped @lid must never be assumed to be the tracked contact —
    // that would attribute a stranger's words to them.
    expect(speakerLabel(msg({ senderJid: "231395758719056@lid" }), thread({ groupJid: "123@g.us" })))
      .toBe(OTHER_PARTICIPANT_LABEL);
    expect(speakerLabel(msg(), thread({ groupJid: "123@g.us" })))
      .toBe(OTHER_PARTICIPANT_LABEL);
  });

  it("anonymises everyone when the contact has no number to match against", () => {
    const noNumber = thread({ groupJid: "123@g.us", contact: { ...CONTACT, whatsapp: null } });
    expect(speakerLabel(msg({ senderJid: "447931460181@s.whatsapp.net" }), noNumber))
      .toBe(OTHER_PARTICIPANT_LABEL);
  });

  it("never leaks a third party's identity into a transcript line", () => {
    const groupThread = thread({ groupJid: "123@g.us" });
    const rendered = [
      msg({ fromMe: true, body: "mine" }),
      msg({ senderJid: "447931460181@s.whatsapp.net", body: "hers" }),
      msg({ senderJid: "447700900999@s.whatsapp.net", body: "theirs" }),
      msg({ senderJid: "88493690757356@lid", body: "unknown" }),
    ].map((m) => `${speakerLabel(m, groupThread)}: ${m.body}`);

    expect(rendered).toEqual([
      "Me: mine",
      "Kat Osman: hers",
      `${OTHER_PARTICIPANT_LABEL}: theirs`,
      `${OTHER_PARTICIPANT_LABEL}: unknown`,
    ]);
    expect(rendered.join("\n")).not.toContain("447700900999");
    expect(rendered.join("\n")).not.toContain("88493690757356");
  });
});

describe("contactParticipated", () => {
  const KAT = "447931460181@s.whatsapp.net";
  const OTHER = "447700900999@s.whatsapp.net";

  it("is true for any 1:1 thread", () => {
    // A 1:1 thread has no sender ids and only one other person in it.
    expect(contactParticipated(thread({ messages: [msg()] }))).toBe(true);
  });

  it("is true when the contact spoke in the group", () => {
    const t = thread({ groupJid: "123@g.us", messages: [msg({ senderJid: OTHER }), msg({ senderJid: KAT })] });
    expect(contactParticipated(t)).toBe(true);
  });

  it("is false when only other people spoke", () => {
    const t = thread({ groupJid: "123@g.us", messages: [msg({ senderJid: OTHER }), msg({ senderJid: "999@lid" })] });
    expect(contactParticipated(t)).toBe(false);
  });

  it("does not count the user's own messages as the contact participating", () => {
    // Otherwise posting in a group would log an interaction with everyone in it.
    const t = thread({ groupJid: "123@g.us", messages: [msg({ fromMe: true, senderJid: KAT })] });
    expect(contactParticipated(t)).toBe(false);
  });

  it("is false when the thread is empty", () => {
    expect(contactParticipated(thread({ groupJid: "123@g.us", messages: [] }))).toBe(false);
  });
});

// ── Open Brain provenance ─────────────────────────────────────────────────────

describe("buildInteractionThought", () => {
  const base = {
    contactName: "Jacob Tan",
    date: "2026-08-24",
    topics: "Talked about Warhammer painting.",
    followUps: "",
    sentiment: "positive" as const,
    channel: "whatsapp" as const,
    summary: "",
  };

  it("describes a 1:1 capture as a direct conversation", () => {
    const t = buildInteractionThought(base);

    expect(t).toContain("WhatsApp conversation with Jacob Tan on 2026-08-24.");
    expect(t).not.toMatch(/group/i);
  });

  it("labels a group capture as a group chat, naming the group", () => {
    // Open Brain is append-only and drives future prep context, so an
    // unmarked group thought misleads permanently.
    const t = buildInteractionThought({
      ...base,
      groupJid: "111@g.us",
      groupName: "Legion of 40K Chums!",
    });

    expect(t).toContain('group conversation in "Legion of 40K Chums!"');
    expect(t).toContain("not a direct conversation");
    expect(t).toContain("Talked about Warhammer painting.");
  });

  it("falls back to the JID when the group name is unknown", () => {
    const t = buildInteractionThought({ ...base, groupJid: "111@g.us" });

    expect(t).toContain('group conversation in "111@g.us"');
  });
});
