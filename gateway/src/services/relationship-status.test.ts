import { describe, it, expect } from "vitest";
import {
  computeDriftStatus,
  computeSafetyIndicator,
  computeOccasions,
} from "./relationship-status.js";

// ── computeDriftStatus ────────────────────────────────────────────────────────

const TODAY = "2026-04-19";
const MONTHLY = 30;  // frequency_days
const WEEKLY  = 7;
const QUARTERLY = 90;

describe("computeDriftStatus — Monthly contact (30 days)", () => {
  it.each([
    // [days_since, expected_status, description]
    [0,  "green",  "contacted today"],
    [15, "green",  "within window"],
    [30, "green",  "exactly at boundary"],
    [31, "yellow", "1 day overdue"],
    [60, "yellow", "30 days overdue (1 cycle)"],
    [61, "red",    "31 days overdue (> 1 cycle)"],
    [90, "red",    "60 days overdue (2 cycles)"],
    [91, "black",  "61 days overdue (> 2 cycles)"],
    [120, "black", "90 days overdue"],
  ])("%i days since last contact → %s (%s)", (daysSince, expected) => {
    const lastContact = subtractDays(TODAY, daysSince);
    expect(computeDriftStatus(lastContact, MONTHLY, TODAY)).toBe(expected);
  });

  it("returns black when last_contact is null", () => {
    expect(computeDriftStatus(null, MONTHLY, TODAY)).toBe("black");
  });
});

describe("computeDriftStatus — Weekly contact (7 days)", () => {
  it.each([
    [7,  "green",  "at boundary"],
    [8,  "yellow", "1 day overdue"],
    [14, "yellow", "7 days overdue (1 cycle)"],
    [15, "red",    "8 days overdue (1–2 cycles)"],
    [21, "red",    "14 days overdue (2 cycles)"],
    [22, "black",  "15 days overdue (> 2 cycles)"],
  ])("%i days since last contact → %s (%s)", (daysSince, expected) => {
    const lastContact = subtractDays(TODAY, daysSince);
    expect(computeDriftStatus(lastContact, WEEKLY, TODAY)).toBe(expected);
  });
});

describe("computeDriftStatus — Quarterly contact (90 days)", () => {
  it.each([
    [90,  "green",  "at boundary"],
    [91,  "yellow", "1 day overdue"],
    [180, "yellow", "90 days overdue (1 cycle)"],
    [181, "red",    "91 days overdue (> 1 cycle)"],
    [270, "red",    "180 days overdue (2 cycles)"],
    [271, "black",  "181 days overdue (> 2 cycles)"],
  ])("%i days since last contact → %s (%s)", (daysSince, expected) => {
    const lastContact = subtractDays(TODAY, daysSince);
    expect(computeDriftStatus(lastContact, QUARTERLY, TODAY)).toBe(expected);
  });
});

// ── computeSafetyIndicator ────────────────────────────────────────────────────

describe("computeSafetyIndicator", () => {
  it.each([
    ["green",  "All good"],
    ["yellow", "a little while"],
    ["red",    "a while"],
    ["black",  "long time"],
  ] as const)("%s drift produces copy containing '%s'", (drift, snippet) => {
    const indicator = computeSafetyIndicator(drift);
    expect(indicator.status).toBe(drift);
    expect(indicator.copy.toLowerCase()).toContain(snippet.toLowerCase());
  });

  it("returns a non-empty copy string for every status", () => {
    for (const drift of ["green", "yellow", "red", "black"] as const) {
      expect(computeSafetyIndicator(drift).copy.length).toBeGreaterThan(0);
    }
  });
});

// ── computeOccasions ──────────────────────────────────────────────────────────

describe("computeOccasions — birthday", () => {
  it("triggers on the birthday itself", () => {
    // Birthday: April 19 (this year = today)
    const occasions = computeOccasions("1990-04-19", TODAY);
    expect(occasions).toHaveLength(1);
    expect(occasions[0].type).toBe("birthday");
    expect(occasions[0].daysUntil).toBe(0);
    expect(occasions[0].label).toContain("today");
  });

  it("triggers 2 days before", () => {
    const occasions = computeOccasions("1990-04-21", TODAY);
    expect(occasions).toHaveLength(1);
    expect(occasions[0].daysUntil).toBe(2);
    expect(occasions[0].label).toContain("2 days");
  });

  it("triggers 1 day before", () => {
    const occasions = computeOccasions("1990-04-20", TODAY);
    expect(occasions).toHaveLength(1);
    expect(occasions[0].daysUntil).toBe(1);
  });

  it("triggers 1 day after (still within window)", () => {
    const occasions = computeOccasions("1990-04-18", TODAY);
    expect(occasions).toHaveLength(1);
    expect(occasions[0].daysUntil).toBe(-1);
    expect(occasions[0].label).toContain("1 day ago");
  });

  it("triggers 2 days after", () => {
    const occasions = computeOccasions("1990-04-17", TODAY);
    expect(occasions).toHaveLength(1);
    expect(occasions[0].daysUntil).toBe(-2);
  });

  it("does not trigger 3+ days before", () => {
    expect(computeOccasions("1990-04-22", TODAY)).toHaveLength(0);
    expect(computeOccasions("1990-04-30", TODAY)).toHaveLength(0);
  });

  it("does not trigger 3+ days after", () => {
    expect(computeOccasions("1990-04-16", TODAY)).toHaveLength(0);
  });

  it("returns empty array when birthday is null", () => {
    expect(computeOccasions(null, TODAY)).toHaveLength(0);
  });

  it("returns empty array when birthday is undefined", () => {
    expect(computeOccasions(undefined, TODAY)).toHaveLength(0);
  });

  it("handles birthday wrapping from December to January", () => {
    // Today: Dec 30, birthday: Jan 1 — 2 days away in next year
    const dec30 = "2026-12-30";
    const occasions = computeOccasions("1990-01-01", dec30);
    expect(occasions).toHaveLength(1);
    expect(occasions[0].daysUntil).toBe(2);
  });
});

// ── Helper ─────────────────────────────────────────────────────────────────��──

function subtractDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
