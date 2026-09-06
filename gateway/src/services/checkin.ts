/**
 * Daily check-in logic — pure functions only.
 *
 * buildCheckinReport() takes pre-fetched data and returns a formatted
 * markdown string. This keeps the DB fetch in tools.ts and makes this
 * module fully unit-testable without Supabase mocks.
 */

import type { EnergyLevel } from "./energy.js";
import {
  computeDriftStatus,
  computeSafetyIndicator,
  computeOccasions,
  type DriftStatus,
} from "./relationship-status.js";

// ── Input types ────────────────────────────────────────────────────────────────

export interface CheckinContact {
  id: string;
  name: string;
  tier: number;
  frequency_days: number;
  last_contact: string | null;
  next_action: string | null;
  social_battery_cost: string | null;
  birthday: string | null;
}

export interface CheckinFollowUp {
  contact_name: string;
  text: string;
}

// ── Output ────────────────────────────────────────────────────────────────────

export interface ContactCheckinItem {
  contact: CheckinContact;
  drift: DriftStatus;
  safetyMessage: string;
  occasions: string[];
}

export interface CheckinReport {
  energy: EnergyLevel;
  items: ContactCheckinItem[];
  reconnectionSuggestions: string[];
  followUpCount: number;
  followUps: CheckinFollowUp[];
  today: string;
}

// ── Main function ─────────────────────────────────────────────────────────────

const TIER_LABEL: Record<number, string> = {
  1: "Inner Circle",
  2: "Active",
  3: "Business",
};

const DRIFT_EMOJI: Record<DriftStatus, string> = {
  green:  "🟢",
  yellow: "🟡",
  red:    "🔴",
  black:  "⚫",
};

export function buildCheckinReport(
  energy: EnergyLevel,
  contacts: CheckinContact[],
  followUps: CheckinFollowUp[],
  today: string
): CheckinReport {
  // Score and annotate each contact
  type Scored = ContactCheckinItem & { _sort: number };

  const scored: Scored[] = contacts
    .filter((c) => c.last_contact !== undefined) // defensive
    .map((c) => {
      const drift = computeDriftStatus(c.last_contact, c.frequency_days, today, c.next_action);
      const safety = computeSafetyIndicator(drift);
      const occasionTriggers = computeOccasions(c.birthday, today);
      return {
        contact: c,
        drift,
        safetyMessage: safety.copy,
        occasions: occasionTriggers.map((o) => o.label),
        _sort: driftSortKey(drift) * 10 + (c.tier - 1),
      };
    })
    .filter((s) => s.drift !== "green"); // only show contacts that need attention

  // Sort: black first, then red, yellow; within same drift, lower tier = higher priority
  scored.sort((a, b) => a._sort - b._sort);

  // Apply energy-level cap
  const filtered = applyEnergyFilter(energy, scored);

  const reconnectionSuggestions = scored
    .filter((s) => s.drift === "black" && !filtered.includes(s))
    .map((s) => s.contact.name);

  return {
    energy,
    items: filtered,
    reconnectionSuggestions,
    followUpCount: followUps.length,
    followUps,
    today,
  };
}

export function formatCheckinReport(report: CheckinReport): string {
  const lines: string[] = [
    `## Kit Daily Check-in`,
    `**Today:** ${report.today} | **Energy:** ${report.energy}`,
    "",
  ];

  if (report.items.length === 0) {
    lines.push("✅ No contacts need attention right now.");
  } else {
    lines.push(`### Needs attention (${report.items.length})`);
    lines.push("");
    for (const item of report.items) {
      const tier = TIER_LABEL[item.contact.tier] ?? `Tier ${item.contact.tier}`;
      const emoji = DRIFT_EMOJI[item.drift];
      lines.push(`**${item.contact.name}** (${tier}) — ${item.drift} ${emoji}`);
      lines.push(`> ${item.safetyMessage}`);
      lines.push(`Last contact: ${item.contact.last_contact ?? "never"} | Next: ${item.contact.next_action ?? "not set"}`);
      for (const occ of item.occasions) {
        lines.push(`📅 ${occ}`);
      }
      lines.push("");
    }
  }

  if (report.followUps.length > 0) {
    lines.push(`### Open follow-ups (${report.followUpCount})`);
    for (const fu of report.followUps) {
      lines.push(`- **${fu.contact_name}:** ${fu.text}`);
    }
    lines.push("");
  }

  if (report.reconnectionSuggestions.length > 0) {
    lines.push("### Dormant contacts (use /kit-reconnect)");
    lines.push(report.reconnectionSuggestions.join(", "));
  }

  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function driftSortKey(drift: DriftStatus): number {
  return { black: 0, red: 1, yellow: 2, green: 3 }[drift];
}

type ScoredItem = ContactCheckinItem & { _sort: number };

function applyEnergyFilter(energy: EnergyLevel, scored: ScoredItem[]): ScoredItem[] {
  switch (energy) {
    case "high":
      return scored; // all overdue contacts

    case "medium": {
      // Up to 7; prefer Low battery cost contacts
      const low = scored.filter((s) => s.contact.social_battery_cost?.toLowerCase() === "low");
      const others = scored.filter((s) => s.contact.social_battery_cost?.toLowerCase() !== "low");
      return [...low, ...others].slice(0, 7);
    }

    case "low": {
      // Up to 3; only Low battery cost contacts
      return scored
        .filter((s) => s.contact.social_battery_cost?.toLowerCase() === "low")
        .slice(0, 3);
    }
  }
}
