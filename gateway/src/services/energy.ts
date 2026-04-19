import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export type EnergyLevel = "high" | "medium" | "low";

const VALID_LEVELS: ReadonlySet<string> = new Set(["high", "medium", "low"]);

export function isEnergyLevel(value: string): value is EnergyLevel {
  return VALID_LEVELS.has(value);
}

export class EnergyService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
  }

  async setEnergy(level: EnergyLevel): Promise<void> {
    const normalized = level.toLowerCase() as EnergyLevel;
    if (!isEnergyLevel(normalized)) {
      throw new Error(`Invalid energy level "${level}". Must be high, medium, or low.`);
    }

    const { error } = await this.supabase
      .schema("kit")
      .from("energy_state")
      .upsert({ day: todayISO(), level: normalized }, { onConflict: "day" });

    if (error) throw new Error(`Failed to save energy level: ${error.message}`);
  }

  async getEnergyForToday(): Promise<EnergyLevel | null> {
    const { data } = await this.supabase
      .schema("kit")
      .from("energy_state")
      .select("level")
      .eq("day", todayISO())
      .single();

    return (data?.level as EnergyLevel) ?? null;
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
