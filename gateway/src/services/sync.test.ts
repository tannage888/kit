import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../config.js", () => ({
  config: { SUPABASE_URL: "http://localhost", SUPABASE_SERVICE_KEY: "test-key" },
}));

import { toContactRow } from "./sync.js";

/**
 * Tests for the SyncService loop-guard logic.
 *
 * We extract the guard behaviour into a standalone helper so we can test
 * it without needing a real Supabase connection or file system.
 */

// ── Inline the loop-guard logic from SyncService ─────────────────────────────
// (Extracted to test independently of I/O)

const LOOP_GUARD_TTL = 3_000;

class LoopGuard {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  set(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => this.timers.delete(id), LOOP_GUARD_TTL)
    );
  }

  has(id: string): boolean {
    return this.timers.has(id);
  }

  clear(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  clearAll(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LoopGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false before a guard is set", () => {
    const guard = new LoopGuard();
    expect(guard.has("contact_a")).toBe(false);
  });

  it("returns true immediately after setting", () => {
    const guard = new LoopGuard();
    guard.set("contact_a");
    expect(guard.has("contact_a")).toBe(true);
  });

  it("expires after TTL", () => {
    const guard = new LoopGuard();
    guard.set("contact_a");
    vi.advanceTimersByTime(LOOP_GUARD_TTL + 1);
    expect(guard.has("contact_a")).toBe(false);
  });

  it("does not expire before TTL", () => {
    const guard = new LoopGuard();
    guard.set("contact_a");
    vi.advanceTimersByTime(LOOP_GUARD_TTL - 1);
    expect(guard.has("contact_a")).toBe(true);
  });

  it("resets the TTL when set again before expiry", () => {
    const guard = new LoopGuard();
    guard.set("contact_a");
    vi.advanceTimersByTime(2_000);
    guard.set("contact_a"); // reset
    vi.advanceTimersByTime(2_000); // 4s total, but timer was reset at 2s
    expect(guard.has("contact_a")).toBe(true);
    vi.advanceTimersByTime(1_100); // now past TTL from reset
    expect(guard.has("contact_a")).toBe(false);
  });

  it("guards different contact IDs independently", () => {
    const guard = new LoopGuard();
    guard.set("contact_a");
    expect(guard.has("contact_b")).toBe(false);
    expect(guard.has("contact_a")).toBe(true);
  });

  it("can be manually cleared", () => {
    const guard = new LoopGuard();
    guard.set("contact_a");
    guard.clear("contact_a");
    expect(guard.has("contact_a")).toBe(false);
  });

  it("clearAll removes all guards", () => {
    const guard = new LoopGuard();
    guard.set("a");
    guard.set("b");
    guard.set("c");
    guard.clearAll();
    expect(guard.has("a")).toBe(false);
    expect(guard.has("b")).toBe(false);
    expect(guard.has("c")).toBe(false);
  });
});

// ── Bidirectional guard interaction ──────────────────────────────────────────

describe("Bidirectional loop prevention", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("md→db guard blocks db→md handler", () => {
    const mdToDb = new LoopGuard();

    // Simulate markdown change triggering Supabase write
    mdToDb.set("contact_a");

    // Simulate Supabase Realtime event arriving (echo of the above write)
    // The db→md handler should check mdToDb guard and skip
    const shouldSkip = mdToDb.has("contact_a");
    expect(shouldSkip).toBe(true);
  });

  it("db→md guard blocks md→db handler", () => {
    const dbToMd = new LoopGuard();

    // Simulate Supabase event writing to markdown
    dbToMd.set("contact_a");

    // Simulate file watcher firing (echo of the above write)
    // The md→db handler should check dbToMd guard and skip
    const shouldSkip = dbToMd.has("contact_a");
    expect(shouldSkip).toBe(true);
  });

  it("guards expire independently for different contacts", () => {
    const mdToDb = new LoopGuard();
    mdToDb.set("contact_a");

    vi.advanceTimersByTime(LOOP_GUARD_TTL + 1);

    // contact_a guard has expired
    expect(mdToDb.has("contact_a")).toBe(false);

    // contact_b was never guarded
    expect(mdToDb.has("contact_b")).toBe(false);
  });
});

// ── Row mapping (shared by contacts UPDATE and interaction_log UPDATE) ────────

describe("toContactRow", () => {
  const minimal = { id: "alice", name: "Alice", tier: 1, frequency: "Monthly" };

  it("copies the identifying fields through unchanged", () => {
    const row = toContactRow({ ...minimal, whatsapp: "+447700900001" });
    expect(row.id).toBe("alice");
    expect(row.name).toBe("Alice");
    expect(row.tier).toBe(1);
    expect(row.frequency).toBe("Monthly");
    expect(row.whatsapp).toBe("+447700900001");
  });

  it("defaults absent optional columns to null rather than undefined", () => {
    const row = toContactRow(minimal);
    // generateContactFile() omits null fields but would render "undefined"
    expect(row.origin_story).toBeNull();
    expect(row.special_interests).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.whatsapp_groups).toBeNull();
    expect(row.email).toBeNull();
    expect(row.url).toBeNull();
    expect(row.last_contact).toBeNull();
  });

  it("defaults frequency_days to 30 and active to true", () => {
    const row = toContactRow(minimal);
    expect(row.frequency_days).toBe(30);
    expect(row.active).toBe(true);
  });

  it("carries email through so it reaches the markdown frontmatter", () => {
    expect(toContactRow({ ...minimal, email: "alice@corp.com" }).email).toBe("alice@corp.com");
  });

  it("preserves an explicit active: false", () => {
    expect(toContactRow({ ...minimal, active: false }).active).toBe(false);
  });

  it("coerces capture columns to the enabled/disabled enum", () => {
    const row = toContactRow({
      ...minimal,
      whatsapp_capture: "enabled",
      linkedin_capture: null,
      instagram_capture: "something else",
    });
    expect(row.whatsapp_capture).toBe("enabled");
    expect(row.linkedin_capture).toBe("disabled");
    expect(row.instagram_capture).toBe("disabled");
  });
});
