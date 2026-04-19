import { describe, it, expect } from "vitest";
import { buildReconnectContext, type ReconnectContact } from "./reconnect.js";

const baseContact: ReconnectContact = {
  name: "Alex",
  tier: 1,
  frequency: "Monthly",
  last_contact: "2025-10-01",
  origin_story: "Met at university, stayed close.",
  special_interests: "Cycling, photography",
  sensitive_topics: "Avoid mentioning their old job",
  preferred_channel: "whatsapp",
  notes: null,
};

describe("buildReconnectContext", () => {
  it("includes the contact name", () => {
    const ctx = buildReconnectContext(baseContact, []);
    expect(ctx).toContain("Alex");
  });

  it("includes tier label", () => {
    const ctx = buildReconnectContext(baseContact, []);
    expect(ctx).toContain("Inner Circle");
  });

  it("formats gap in human terms (months for 6+ months)", () => {
    const ctx = buildReconnectContext(baseContact, []);
    expect(ctx).toMatch(/\d+ months?/);
  });

  it("includes origin story", () => {
    const ctx = buildReconnectContext(baseContact, []);
    expect(ctx).toContain("university");
  });

  it("includes special interests", () => {
    const ctx = buildReconnectContext(baseContact, []);
    expect(ctx).toContain("Cycling");
  });

  it("includes sensitive topics", () => {
    const ctx = buildReconnectContext(baseContact, []);
    expect(ctx).toContain("old job");
  });

  it("includes last interaction when provided", () => {
    const ctx = buildReconnectContext(baseContact, [
      { date: "2025-10-01", channel: "call", notes: "Discussed career change" },
    ]);
    expect(ctx).toContain("Discussed career change");
    expect(ctx).toContain("2025-10-01");
  });

  it("includes reassurance copy for inner circle", () => {
    const ctx = buildReconnectContext(baseContact, []);
    expect(ctx).toContain("Inner Circle");
    expect(ctx.toLowerCase()).toContain("direct and warm");
  });

  it("produces different opener style for tier 3", () => {
    const bizContact: ReconnectContact = { ...baseContact, tier: 3 };
    const ctx = buildReconnectContext(bizContact, []);
    expect(ctx.toLowerCase()).toContain("business contact");
  });

  it("handles null last_contact gracefully", () => {
    const noHistory: ReconnectContact = { ...baseContact, last_contact: null };
    const ctx = buildReconnectContext(noHistory, []);
    expect(ctx).toContain("a long time");
  });

  it("handles missing optional fields", () => {
    const minimal: ReconnectContact = {
      ...baseContact,
      origin_story: null,
      special_interests: null,
      sensitive_topics: null,
    };
    const ctx = buildReconnectContext(minimal, []);
    expect(ctx).toContain("Alex");
    expect(ctx).not.toContain("How you know them");
    expect(ctx).not.toContain("Interests");
  });
});
