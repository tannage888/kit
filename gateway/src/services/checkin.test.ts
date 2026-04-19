import { describe, it, expect } from "vitest";
import { buildCheckinReport, formatCheckinReport, type CheckinContact } from "./checkin.js";

const TODAY = "2026-04-19";

function makeContact(
  overrides: Partial<CheckinContact> & { id: string; name: string }
): CheckinContact {
  return {
    tier: 2,
    frequency_days: 30,
    last_contact: null,
    next_action: null,
    social_battery_cost: "Medium",
    birthday: null,
    ...overrides,
  };
}

// Contacts at various drift states
const blackContact = makeContact({
  id: "alice",
  name: "Alice",
  tier: 1,
  frequency_days: 30,
  last_contact: "2025-11-01", // ~170 days ago → black
  social_battery_cost: "Low",
});

const redContact = makeContact({
  id: "bob",
  name: "Bob",
  tier: 2,
  frequency_days: 30,
  last_contact: "2026-02-05", // ~73 days ago → red (30 < 43 ≤ 60)
  social_battery_cost: "Medium",
});

const yellowContact = makeContact({
  id: "carol",
  name: "Carol",
  tier: 2,
  frequency_days: 30,
  last_contact: "2026-03-14", // ~36 days ago → yellow
  social_battery_cost: "High",
});

const greenContact = makeContact({
  id: "dave",
  name: "Dave",
  tier: 3,
  frequency_days: 30,
  last_contact: "2026-04-05", // ~14 days ago → green
  social_battery_cost: "Low",
});

const allContacts = [blackContact, redContact, yellowContact, greenContact];

// ── buildCheckinReport ────────────────────────────────────────────────────────

describe("buildCheckinReport — energy: high", () => {
  it("includes all non-green contacts", () => {
    const report = buildCheckinReport("high", allContacts, [], TODAY);
    const names = report.items.map((i) => i.contact.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
    expect(names).toContain("Carol");
    expect(names).not.toContain("Dave"); // green
  });

  it("sorts black contacts first", () => {
    const report = buildCheckinReport("high", allContacts, [], TODAY);
    expect(report.items[0].contact.name).toBe("Alice");
    expect(report.items[0].drift).toBe("black");
  });
});

describe("buildCheckinReport — energy: medium", () => {
  it("caps at 7 contacts", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeContact({
        id: `c${i}`,
        name: `Contact ${i}`,
        last_contact: "2025-01-01",
        frequency_days: 30,
        social_battery_cost: "Medium",
      })
    );
    const report = buildCheckinReport("medium", many, [], TODAY);
    expect(report.items.length).toBeLessThanOrEqual(7);
  });

  it("prefers Low battery cost contacts", () => {
    const lowBattery = makeContact({
      id: "low1",
      name: "LowCost",
      last_contact: "2026-02-01",
      frequency_days: 30,
      social_battery_cost: "Low",
    });
    const highBattery = makeContact({
      id: "high1",
      name: "HighCost",
      last_contact: "2026-02-01",
      frequency_days: 30,
      social_battery_cost: "High",
    });
    const contacts = Array.from({ length: 6 }, (_, i) =>
      makeContact({
        id: `filler${i}`,
        name: `Filler ${i}`,
        last_contact: "2025-01-01",
        frequency_days: 30,
        social_battery_cost: "High",
      })
    );
    contacts.unshift(highBattery, lowBattery);

    const report = buildCheckinReport("medium", contacts, [], TODAY);
    // LowCost should appear before HighCost in the results
    const idx_low = report.items.findIndex((i) => i.contact.name === "LowCost");
    const idx_high = report.items.findIndex((i) => i.contact.name === "HighCost");
    if (idx_low !== -1 && idx_high !== -1) {
      expect(idx_low).toBeLessThan(idx_high);
    }
  });
});

describe("buildCheckinReport — energy: low", () => {
  it("caps at 3 contacts", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeContact({
        id: `c${i}`,
        name: `Contact ${i}`,
        last_contact: "2025-01-01",
        frequency_days: 30,
        social_battery_cost: "Low",
      })
    );
    const report = buildCheckinReport("low", many, [], TODAY);
    expect(report.items.length).toBeLessThanOrEqual(3);
  });

  it("only includes Low battery cost contacts", () => {
    const report = buildCheckinReport("low", allContacts, [], TODAY);
    // Only Alice (Low) should appear; Bob (Medium) and Carol (High) should not
    for (const item of report.items) {
      expect(item.contact.social_battery_cost?.toLowerCase()).toBe("low");
    }
  });
});

describe("buildCheckinReport — occasions", () => {
  it("surfaces birthday occasions in items", () => {
    const birthdayContact = makeContact({
      id: "eva",
      name: "Eva",
      last_contact: "2025-11-01",
      frequency_days: 30,
      birthday: "1990-04-19", // today!
    });
    const report = buildCheckinReport("high", [birthdayContact], [], TODAY);
    const evaItem = report.items.find((i) => i.contact.name === "Eva");
    expect(evaItem?.occasions.some((o) => o.toLowerCase().includes("birthday"))).toBe(true);
  });
});

describe("buildCheckinReport — reconnection suggestions", () => {
  it("includes black contacts not shown (when capped by energy=low)", () => {
    const multipleBlack = Array.from({ length: 5 }, (_, i) =>
      makeContact({
        id: `black${i}`,
        name: `Dormant ${i}`,
        last_contact: "2025-01-01",
        frequency_days: 30,
        social_battery_cost: i === 0 ? "Low" : "High",
      })
    );
    const report = buildCheckinReport("low", multipleBlack, [], TODAY);
    // Only the Low battery one shows; the rest should be reconnection suggestions
    expect(report.reconnectionSuggestions.length).toBeGreaterThan(0);
  });
});

describe("buildCheckinReport — follow-ups", () => {
  it("includes follow-ups in the report", () => {
    const report = buildCheckinReport(
      "high",
      allContacts,
      [{ contact_name: "Alice", text: "Send the article" }],
      TODAY
    );
    expect(report.followUpCount).toBe(1);
    expect(report.followUps[0].text).toBe("Send the article");
  });
});

// ── formatCheckinReport ───────────────────────────────────────────────────────

describe("formatCheckinReport", () => {
  it("produces a non-empty string", () => {
    const report = buildCheckinReport("high", allContacts, [], TODAY);
    const output = formatCheckinReport(report);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain("Kit Daily Check-in");
  });

  it("shows empty message when no contacts need attention", () => {
    const report = buildCheckinReport("high", [greenContact], [], TODAY);
    const output = formatCheckinReport(report);
    expect(output).toContain("No contacts need attention");
  });

  it("includes contact names and drift in output", () => {
    const report = buildCheckinReport("high", [blackContact], [], TODAY);
    const output = formatCheckinReport(report);
    expect(output).toContain("Alice");
    expect(output).toContain("black");
  });
});
