import { describe, it, expect } from "vitest";
import {
  slugify,
  frequencyToDays,
  extractSection,
  parseInteractionLog,
  parseFollowUps,
  extractPhone,
  setFrontmatterField,
  prependInteractionEntry,
  appendFollowUp,
  completeFollowUp,
  uncompleteFollowUp,
} from "./markdown.js";

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(slugify("Chris Hemsworth")).toBe("chris_hemsworth");
  });

  it("strips leading/trailing underscores", () => {
    expect(slugify("  Adele  ")).toBe("adele");
  });

  it("collapses multiple non-alphanumeric chars", () => {
    expect(slugify("Benedict Cumberbatch")).toBe("benedict_cumberbatch");
  });

  it("handles single name", () => {
    expect(slugify("Beyoncé")).toBe("beyonc");
  });
});

// ---------------------------------------------------------------------------
// frequencyToDays
// ---------------------------------------------------------------------------

describe("frequencyToDays", () => {
  it.each([
    ["Weekly", 7],
    ["Fortnightly", 14],
    ["Bi-Weekly", 14],
    ["Monthly", 30],
    ["Bi-Monthly", 60],
    ["Quarterly", 90],
    ["Twice Yearly", 180],
    ["Bi-Annual", 180],
    ["Annual", 365],
    ["Yearly", 365],
  ])("%s → %i days", (input, expected) => {
    expect(frequencyToDays(input)).toBe(expected);
  });

  it("parses 'every 2 weeks'", () => {
    expect(frequencyToDays("every 2 weeks")).toBe(14);
  });

  it("parses 'every 3 months'", () => {
    expect(frequencyToDays("every 3 months")).toBe(90);
  });

  it("defaults to 30 for unknown input", () => {
    expect(frequencyToDays("whenever")).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// extractSection
// ---------------------------------------------------------------------------

const sampleDoc = `---
name: Test
---

## Background
This is the background.

## Interaction Log

### 2026-04-01 — App
Some notes here.

## Notes
Extra notes.
`;

describe("extractSection", () => {
  it("extracts a named section", () => {
    expect(extractSection(sampleDoc, "Background")).toBe("This is the background.");
  });

  it("returns null for a missing section", () => {
    expect(extractSection(sampleDoc, "Interests")).toBeNull();
  });

  it("tries multiple header names in order", () => {
    expect(extractSection(sampleDoc, "Missing", "Background")).toBe("This is the background.");
  });

  it("returns null when all headers miss", () => {
    expect(extractSection(sampleDoc, "Missing", "Also Missing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseInteractionLog
// ---------------------------------------------------------------------------

const logDoc = `## Interaction Log

### 2026-04-01 — App
Caught up over coffee. Discussed the project.

**Follow-ups:**
- Send the doc

### 2026-03-15 — WhatsApp
Quick check-in.
`;

describe("parseInteractionLog", () => {
  it("parses multiple entries", () => {
    const rows = parseInteractionLog(logDoc, "test_contact");
    expect(rows).toHaveLength(2);
  });

  it("extracts correct dates", () => {
    const rows = parseInteractionLog(logDoc, "test_contact");
    expect(rows[0].date).toBe("2026-04-01");
    expect(rows[1].date).toBe("2026-03-15");
  });

  it("strips **Follow-ups:** block from notes", () => {
    const rows = parseInteractionLog(logDoc, "test_contact");
    expect(rows[0].notes).not.toContain("Follow-ups");
    expect(rows[0].notes).toContain("Caught up over coffee");
  });

  it("sets correct contact_id", () => {
    const rows = parseInteractionLog(logDoc, "test_contact");
    expect(rows.every((r) => r.contact_id === "test_contact")).toBe(true);
  });

  it("returns empty array when no Interaction Log section", () => {
    expect(parseInteractionLog("# No log here\n", "x")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseFollowUps
// ---------------------------------------------------------------------------

const followUpDoc = `Some content.

**Follow-ups:**
- Send the doc
- ~~Call them back~~
- Book a table
`;

describe("parseFollowUps", () => {
  it("parses all follow-up bullets", () => {
    const rows = parseFollowUps(followUpDoc, "contact_id");
    expect(rows).toHaveLength(3);
  });

  it("marks strikethrough items as completed", () => {
    const rows = parseFollowUps(followUpDoc, "contact_id");
    expect(rows.find((r) => r.text === "Call them back")?.completed).toBe(true);
  });

  it("marks non-strikethrough items as incomplete", () => {
    const rows = parseFollowUps(followUpDoc, "contact_id");
    expect(rows.find((r) => r.text === "Send the doc")?.completed).toBe(false);
  });

  it("returns empty array when no follow-ups block", () => {
    expect(parseFollowUps("# No follow ups\n", "x")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractPhone
// ---------------------------------------------------------------------------

describe("extractPhone", () => {
  it("extracts wa.me number", () => {
    expect(extractPhone("Contact on [WhatsApp](https://wa.me/447700900123)")).toBe("447700900123");
  });

  it("extracts UK mobile number", () => {
    expect(extractPhone("Call me on +447700900123")).toBe("+447700900123");
  });

  it("returns null when no phone present", () => {
    expect(extractPhone("No phone here")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setFrontmatterField
// ---------------------------------------------------------------------------

const frontmatterDoc = `---
name: Test Person
last_contact: 2026-03-01
next_action: 2026-04-01
---

Body content here.
`;

describe("setFrontmatterField", () => {
  it("updates an existing field in place", () => {
    const result = setFrontmatterField(frontmatterDoc, "last_contact", "2026-04-03");
    expect(result).toContain("last_contact: 2026-04-03");
    expect(result).not.toContain("last_contact: 2026-03-01");
  });

  it("does not change any other content", () => {
    const result = setFrontmatterField(frontmatterDoc, "last_contact", "2026-04-03");
    expect(result).toContain("Body content here.");
    expect(result).toContain("name: Test Person");
  });

  it("adds a missing field into the frontmatter block", () => {
    const result = setFrontmatterField(frontmatterDoc, "frequency", "Monthly");
    expect(result).toContain("frequency: Monthly");
  });
});

// ---------------------------------------------------------------------------
// prependInteractionEntry
// ---------------------------------------------------------------------------

const existingLog = `---
name: Test
---

## Background
Some background.

## Interaction Log

### 2026-03-01 — App
Older entry.
`;

describe("prependInteractionEntry", () => {
  it("prepends a new entry before existing ones", () => {
    const result = prependInteractionEntry(
      existingLog,
      "### 2026-04-03 — App\nNew entry."
    );
    const newIdx = result.indexOf("2026-04-03");
    const oldIdx = result.indexOf("2026-03-01");
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it("preserves all existing content", () => {
    const result = prependInteractionEntry(existingLog, "### 2026-04-03 — App\nNew.");
    expect(result).toContain("Older entry.");
    expect(result).toContain("Some background.");
  });

  it("creates the section if it does not exist", () => {
    const noLog = "---\nname: Test\n---\n\nJust a body.\n";
    const result = prependInteractionEntry(noLog, "### 2026-04-03 — App\nFirst entry.");
    expect(result).toContain("## Interaction Log");
    expect(result).toContain("First entry.");
  });
});

// ---------------------------------------------------------------------------
// appendFollowUp
// ---------------------------------------------------------------------------

const withFollowUps = `## Notes
Some notes.

**Follow-ups:**
- Existing item
`;

describe("appendFollowUp", () => {
  it("appends to an existing Follow-ups block", () => {
    const result = appendFollowUp(withFollowUps, "New item");
    expect(result).toContain("- New item");
    expect(result).toContain("- Existing item");
  });

  it("creates a Follow-ups block if none exists", () => {
    const result = appendFollowUp("No follow-ups here.", "New item");
    expect(result).toContain("**Follow-ups:**");
    expect(result).toContain("- New item");
  });
});

// ---------------------------------------------------------------------------
// completeFollowUp / uncompleteFollowUp
// ---------------------------------------------------------------------------

const followUpList = `**Follow-ups:**
- Send the doc
- Book a table
`;

describe("completeFollowUp", () => {
  it("wraps the matching bullet in strikethrough", () => {
    const result = completeFollowUp(followUpList, "Send the doc");
    expect(result).toContain("- ~~Send the doc~~");
  });

  it("leaves other bullets unchanged", () => {
    const result = completeFollowUp(followUpList, "Send the doc");
    expect(result).toContain("- Book a table");
    expect(result).not.toContain("~~Book a table~~");
  });

  it("is a no-op when text not found", () => {
    expect(completeFollowUp(followUpList, "Non-existent")).toBe(followUpList);
  });
});

describe("uncompleteFollowUp", () => {
  const completed = `**Follow-ups:**\n- ~~Send the doc~~\n- Book a table\n`;

  it("removes strikethrough from the matching bullet", () => {
    const result = uncompleteFollowUp(completed, "Send the doc");
    expect(result).toContain("- Send the doc");
    expect(result).not.toContain("~~Send the doc~~");
  });

  it("leaves other bullets unchanged", () => {
    const result = uncompleteFollowUp(completed, "Send the doc");
    expect(result).toContain("- Book a table");
  });
});
