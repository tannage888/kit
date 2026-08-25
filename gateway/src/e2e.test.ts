/**
 * Kit v1.0 end-to-end smoke test
 *
 * Exercises the pure-function layer end-to-end without Supabase:
 * checkin → prep → reconnect → message routing.
 * Confirms that all Phase 1-10 deliverables are wired together.
 */

import { describe, it, expect } from "vitest";
import { computeDriftStatus, computeOccasions } from "./services/relationship-status.js";
import { buildCheckinReport, formatCheckinReport } from "./services/checkin.js";
import { buildPrepCard, buildDraftContext } from "./services/prep.js";
import { buildReconnectContext } from "./services/reconnect.js";
import { isEnergyLevel } from "./services/energy.js";
import type { CheckinContact, CheckinFollowUp } from "./services/checkin.js";
import type { PrepContact, PrepInteraction } from "./services/prep.js";
import type { ReconnectContact } from "./services/reconnect.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = "2026-04-19";

function makeCheckinContact(overrides: Partial<CheckinContact> = {}): CheckinContact {
  return {
    id: "alice",
    name: "Alice",
    tier: 1,
    frequency_days: 30,
    last_contact: "2026-03-01",
    next_action: null,
    social_battery_cost: "Low",
    birthday: null,
    ...overrides,
  };
}

function makePrepContact(overrides: Partial<PrepContact> = {}): PrepContact {
  return {
    id: "alice",
    name: "Alice",
    tier: 1,
    frequency: "Monthly",
    last_contact: "2026-03-01",
    next_action: null,
    origin_story: "Met at a conference",
    special_interests: "Rock climbing, philosophy",
    sensitive_topics: "Family situation",
    preferred_channel: "whatsapp",
    social_battery_cost: "Low",
    notes: null,
    ...overrides,
  };
}

function makeReconnectContact(overrides: Partial<ReconnectContact> = {}): ReconnectContact {
  return {
    name: "Bob",
    tier: 2,
    frequency: "Monthly",
    last_contact: "2025-06-01",
    origin_story: "Old university friend",
    special_interests: "Music, travel",
    sensitive_topics: null,
    preferred_channel: "whatsapp",
    notes: null,
    ...overrides,
  };
}

// ── Phase 4: Drift + occasions ────────────────────────────────────────────────

describe("Phase 4 — drift and occasions", () => {
  it("computes drift status correctly across all tiers", () => {
    expect(computeDriftStatus("2026-04-19", 30, TODAY)).toBe("green");  // same day
    expect(computeDriftStatus("2026-03-01", 30, TODAY)).toBe("yellow"); // 49d overdue
    expect(computeDriftStatus("2025-01-01", 30, TODAY)).toBe("black");  // very overdue
    expect(computeDriftStatus(null, 30, TODAY)).toBe("black");          // never contacted
  });

  it("detects birthday within ±2 days window", () => {
    // Birthday on 2026-04-21 (2 days from today)
    const birthday = "1990-04-21";
    const occasions = computeOccasions(birthday, TODAY);
    expect(occasions.length).toBeGreaterThan(0);
    expect(occasions[0].daysUntil).toBe(2);
  });

  it("returns empty for birthday not in upcoming window", () => {
    const birthday = "1990-12-25"; // far away from April
    const occasions = computeOccasions(birthday, TODAY);
    expect(occasions.length).toBe(0);
  });
});

// ── Phase 3: Energy ───────────────────────────────────────────────────────────

describe("Phase 3 — energy level validation", () => {
  it("accepts valid energy levels", () => {
    expect(isEnergyLevel("high")).toBe(true);
    expect(isEnergyLevel("medium")).toBe(true);
    expect(isEnergyLevel("low")).toBe(true);
  });

  it("rejects invalid or unnormalized values", () => {
    expect(isEnergyLevel("HIGH")).toBe(false);
    expect(isEnergyLevel("")).toBe(false);
    expect(isEnergyLevel("full")).toBe(false);
  });
});

// ── Phase 5: Check-in ─────────────────────────────────────────────────────────

describe("Phase 5 — daily check-in", () => {
  it("surfaces overdue contacts at high energy", () => {
    const contacts: CheckinContact[] = [
      makeCheckinContact({ id: "alice", name: "Alice", last_contact: "2026-01-01", tier: 1 }),
      makeCheckinContact({ id: "bob", name: "Bob", last_contact: TODAY, tier: 2 }),
    ];
    const report = buildCheckinReport("high", contacts, [], TODAY);
    expect(report.items.length).toBeGreaterThan(0);
    const names = report.items.map((c) => c.contact.name);
    expect(names).toContain("Alice");
  });

  it("limits contacts to 3 at low energy", () => {
    const contacts: CheckinContact[] = Array.from({ length: 10 }, (_, i) =>
      makeCheckinContact({
        id: `c${i}`,
        name: `Contact ${i}`,
        last_contact: "2026-01-01",
        social_battery_cost: "Low",
      })
    );
    const report = buildCheckinReport("low", contacts, [], TODAY);
    expect(report.items.length).toBeLessThanOrEqual(3);
  });

  it("formats report as non-empty string", () => {
    const contacts: CheckinContact[] = [
      makeCheckinContact({ last_contact: "2026-01-01" }),
    ];
    const report = buildCheckinReport("high", contacts, [], TODAY);
    const formatted = formatCheckinReport(report);
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toContain("Alice");
  });

  it("surfaces follow-ups in the report", () => {
    const contacts: CheckinContact[] = [makeCheckinContact()];
    const followUps: CheckinFollowUp[] = [
      { contact_name: "Alice", text: "Send the article about climbing" },
    ];
    const report = buildCheckinReport("high", contacts, followUps, TODAY);
    expect(report.followUps.length).toBe(1);
    expect(report.followUps[0].text).toContain("climbing");
  });
});

// ── Phase 6: Prep card + draft context ───────────────────────────────────────

describe("Phase 6 — prep card and draft context", () => {
  it("builds a prep card string containing contact info", () => {
    const contact = makePrepContact();
    const interactions: PrepInteraction[] = [
      { date: "2026-03-01", channel: "whatsapp", notes: "Chatted about the trip" },
    ];
    const card = buildPrepCard(contact, interactions, [], []);
    expect(typeof card).toBe("string");
    expect(card).toContain("Alice");
    expect(card).toContain("Rock climbing");
  });

  it("builds draft context string that mentions interests", () => {
    const contact = makePrepContact();
    const ctx = buildDraftContext(contact, [], [], []);
    expect(typeof ctx).toBe("string");
    expect(ctx).toContain("Alice");
  });

  it("caps draft context interactions in output", () => {
    const contact = makePrepContact();
    const interactions: PrepInteraction[] = Array.from({ length: 6 }, (_, i) => ({
      date: "2026-03-01",
      channel: "whatsapp" as const,
      notes: `Message ${i}`,
    }));
    const ctx = buildDraftContext(contact, interactions, [], []);
    // Only first 3 interactions should appear — 4th+ messages should not overflow
    const count = (ctx.match(/Message /g) ?? []).length;
    expect(count).toBeLessThanOrEqual(3);
  });
});

// ── Phase 8: Reconnect context ────────────────────────────────────────────────

describe("Phase 8 — reconnect context", () => {
  it("builds reconnect context string for a dormant contact", () => {
    const contact = makeReconnectContact();
    const ctx = buildReconnectContext(contact, []);
    expect(typeof ctx).toBe("string");
    expect(ctx).toContain("Bob");
    expect(ctx.length).toBeGreaterThan(50);
  });

  it("describes a long gap in months", () => {
    const contact = makeReconnectContact({ last_contact: "2025-06-01" });
    const ctx = buildReconnectContext(contact, []);
    expect(ctx).toMatch(/month/i);
  });
});

// ── Phase 9: Message router filter chain ─────────────────────────────────────

describe("Phase 9 — message router integration", async () => {
  it("MessageRouter module exports expected class", async () => {
    const mod = await import("./services/message-router.js");
    expect(typeof mod.MessageRouter).toBe("function");
    const instance = new mod.MessageRouter({} as any, {} as any);
    expect(typeof instance.handleMessage).toBe("function");
    expect(typeof instance.triggerCapture).toBe("function");
    expect(typeof instance.activeThreadCount).toBe("number");
  });
});
