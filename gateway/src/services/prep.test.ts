import { describe, it, expect } from "vitest";
import { buildPrepCard, buildDraftContext, type PrepContact } from "./prep.js";

const TODAY = "2026-04-19";

const contact: PrepContact = {
  id: "alice",
  name: "Alice Example",
  tier: 1,
  frequency: "Monthly",
  last_contact: "2026-03-15",
  next_action: "2026-04-15",
  social_battery_cost: "Low",
  origin_story: "Met at a tech conference in 2022.",
  special_interests: "Hiking, board games, Python",
  sensitive_topics: "Her divorce — do not mention",
  preferred_channel: "whatsapp",
  notes: "Very thoughtful, values depth over small talk.",
};

const interactions = [
  { date: "2026-03-15", channel: "WhatsApp", notes: "Talked about the hiking trip." },
  { date: "2026-02-10", channel: "call", notes: "Brief check-in, she seemed busy." },
];

const followUps = [
  { text: "Send the trail map", completed: false },
  { text: "Ask about her new role", completed: false },
];

const brainContext = [
  { content: "Alice mentioned wanting to do the Pennine Way", type: "OBSERVATION", date: "2026-03-15" },
  { content: "Ask about her sister's wedding", type: "NEXT_ACTION", date: "2026-02-10" },
];

// ── buildPrepCard ─────────────────────────────────────────────────────────────

describe("buildPrepCard", () => {
  it("includes the contact's name in the header", () => {
    const card = buildPrepCard(contact, interactions, followUps, brainContext);
    expect(card).toContain("Alice Example");
  });

  it("includes tier and battery cost", () => {
    const card = buildPrepCard(contact, interactions, followUps, brainContext);
    expect(card).toContain("Inner Circle");
    expect(card).toContain("Low");
  });

  it("includes origin story", () => {
    const card = buildPrepCard(contact, interactions, followUps, brainContext);
    expect(card).toContain("tech conference");
  });

  it("includes special interests", () => {
    const card = buildPrepCard(contact, interactions, followUps, brainContext);
    expect(card).toContain("Hiking");
    expect(card).toContain("board games");
  });

  it("includes sensitive topics", () => {
    const card = buildPrepCard(contact, interactions, followUps, brainContext);
    expect(card).toContain("divorce");
  });

  it("includes open follow-ups", () => {
    const card = buildPrepCard(contact, interactions, followUps, brainContext);
    expect(card).toContain("trail map");
    expect(card).toContain("new role");
  });

  it("includes recent interactions", () => {
    const card = buildPrepCard(contact, interactions, followUps, brainContext);
    expect(card).toContain("hiking trip");
    expect(card).toContain("2026-03-15");
  });

  it("includes Open Brain context", () => {
    const card = buildPrepCard(contact, interactions, followUps, brainContext);
    expect(card).toContain("Pennine Way");
  });

  it("handles missing optional fields gracefully", () => {
    const minimal: PrepContact = {
      ...contact,
      origin_story: null,
      special_interests: null,
      sensitive_topics: null,
      notes: null,
      preferred_channel: null,
    };
    const card = buildPrepCard(minimal, [], [], []);
    expect(card).toContain("Alice Example");
    expect(card).not.toContain("Background");
    expect(card).not.toContain("Interests");
  });
});

// ── buildDraftContext ─────────────────────────────────────────────────────────

describe("buildDraftContext", () => {
  it("includes the intent when provided", () => {
    const ctx = buildDraftContext(contact, interactions, followUps, brainContext, "Check in about her new job");
    expect(ctx).toContain("Check in about her new job");
  });

  it("does not include intent section when not provided", () => {
    const ctx = buildDraftContext(contact, interactions, followUps, brainContext);
    expect(ctx).not.toContain("Your intent");
  });

  it("includes time since last contact", () => {
    const ctx = buildDraftContext(contact, interactions, followUps, brainContext);
    // last_contact is 2026-03-15, today running test at some point after that
    expect(ctx).toMatch(/weeks?|months?|days?/i);
  });

  it("caps interactions at 3", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-0${(i % 9) + 1}-01`,
      channel: "call",
      notes: `Interaction ${i}`,
    }));
    const ctx = buildDraftContext(contact, many, [], []);
    const occurrences = (ctx.match(/Interaction \d/g) ?? []).length;
    expect(occurrences).toBeLessThanOrEqual(3);
  });

  it("includes pending follow-ups", () => {
    const ctx = buildDraftContext(contact, interactions, followUps, brainContext);
    expect(ctx).toContain("trail map");
  });

  it("ends with a drafting instruction", () => {
    const ctx = buildDraftContext(contact, interactions, followUps, brainContext);
    expect(ctx).toContain("personal and natural");
  });

  it("handles contact with no history", () => {
    const ctx = buildDraftContext(
      { ...contact, last_contact: null, origin_story: null },
      [], [], []
    );
    expect(ctx).toContain("no prior contact");
  });
});
