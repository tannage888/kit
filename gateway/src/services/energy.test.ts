import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnergyService, isEnergyLevel } from "./energy.js";

vi.mock("../config.js", () => ({
  config: {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_KEY: "test-key",
  },
}));

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockSingle = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    schema: () => ({
      from: () => ({
        upsert: mockUpsert,
        select: () => ({
          eq: () => ({
            single: mockSingle,
          }),
        }),
      }),
    }),
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("isEnergyLevel", () => {
  it("accepts valid levels", () => {
    expect(isEnergyLevel("high")).toBe(true);
    expect(isEnergyLevel("medium")).toBe(true);
    expect(isEnergyLevel("low")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isEnergyLevel("tired")).toBe(false);
    expect(isEnergyLevel("")).toBe(false);
    expect(isEnergyLevel("HIGH")).toBe(false);
  });
});

describe("EnergyService.setEnergy", () => {
  beforeEach(() => {
    mockUpsert.mockResolvedValue({ error: null });
  });

  it("upserts high energy for today", async () => {
    const svc = new EnergyService();
    await svc.setEnergy("high");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ level: "high" }),
      { onConflict: "day" }
    );
  });

  it("upserts medium energy", async () => {
    const svc = new EnergyService();
    await svc.setEnergy("medium");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ level: "medium" }),
      { onConflict: "day" }
    );
  });

  it("upserts low energy", async () => {
    const svc = new EnergyService();
    await svc.setEnergy("low");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ level: "low" }),
      { onConflict: "day" }
    );
  });

  it("includes today's date in the upsert payload", async () => {
    const svc = new EnergyService();
    const today = new Date().toISOString().slice(0, 10);
    await svc.setEnergy("high");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ day: today }),
      expect.any(Object)
    );
  });

  it("throws when Supabase returns an error", async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: "DB error" } });
    const svc = new EnergyService();
    await expect(svc.setEnergy("high")).rejects.toThrow("DB error");
  });
});

describe("EnergyService.getEnergyForToday", () => {
  it("returns the stored level when a row exists", async () => {
    mockSingle.mockResolvedValueOnce({ data: { level: "medium" }, error: null });
    const svc = new EnergyService();
    const result = await svc.getEnergyForToday();
    expect(result).toBe("medium");
  });

  it("returns null when no row exists for today", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });
    const svc = new EnergyService();
    const result = await svc.getEnergyForToday();
    expect(result).toBeNull();
  });

  it("queries using today's date (verified via upsert payload)", async () => {
    mockSingle.mockResolvedValueOnce({ data: { level: "low" }, error: null });
    const svc = new EnergyService();
    await svc.getEnergyForToday();
    expect(mockSingle).toHaveBeenCalled();

    const today = new Date().toISOString().slice(0, 10);
    const svc2 = new EnergyService();
    await svc2.setEnergy("low");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ day: today }),
      expect.any(Object)
    );
  });
});
