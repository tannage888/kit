/**
 * Pure relationship status functions — no I/O.
 *
 * These are called by /kit-checkin and other tools to compute per-contact
 * presentation state from raw contact data. All inputs are plain values;
 * no Supabase or filesystem reads.
 */

export type DriftStatus = "green" | "yellow" | "red" | "black";

export interface SafetyIndicator {
  status: DriftStatus;
  copy: string;
}

export interface OccasionTrigger {
  type: "birthday";
  label: string;
  daysUntil: number;
}

// ── Drift ─────────────────────────────────────────────────────────────────────

/**
 * Compute a contact's drift status.
 *
 * Thresholds (spec FR-04) — proportional to frequency:
 *   green  — not overdue (days since last contact ≤ frequency_days)
 *   yellow — overdue by up to one frequency cycle (overdue_days ≤ frequency_days)
 *   red    — overdue by 1–2 frequency cycles (overdue_days ≤ 2 × frequency_days)
 *   black  — overdue by more than 2 cycles ("relationship at risk")
 *
 * Examples:
 *   Weekly (7d):    green ≤7, yellow 8–14, red 15–21, black 22+
 *   Monthly (30d):  green ≤30, yellow 31–60, red 61–90, black 91+
 *   Quarterly (90d): green ≤90, yellow 91–180, red 181–270, black 271+
 *
 * A `nextAction` date in the future is a deliberate "not yet" — a follow-up
 * Mark has consciously scheduled — so the contact reads green until it
 * arrives. For contacts whose next_action is just last_contact + cadence this
 * changes nothing, because that date passes exactly when they fall overdue.
 * It only matters when the date has been pushed out on purpose.
 *
 * @param lastContact  ISO date string (YYYY-MM-DD) or null (never contacted)
 * @param frequencyDays  Target contact interval in days (7 | 30 | 90 etc.)
 * @param today  ISO date string for "today" (allows deterministic testing)
 * @param nextAction  ISO date of the scheduled follow-up, or null
 */
export function computeDriftStatus(
  lastContact: string | null,
  frequencyDays: number,
  today: string,
  nextAction?: string | null
): DriftStatus {
  if (!lastContact) return "black";

  // Never contacted stays black above: a scheduled date does not stand in for
  // a relationship that has not started.
  if (nextAction && diffDays(today, nextAction) > 0) return "green";

  const daysSince = diffDays(lastContact, today);
  const overdueDays = daysSince - frequencyDays;

  if (overdueDays <= 0) return "green";
  if (overdueDays <= frequencyDays) return "yellow";
  if (overdueDays <= 2 * frequencyDays) return "red";
  return "black";
}

// ── Safety indicator ──────────────────────────────────────────────────────────

const SAFETY_COPY: Record<DriftStatus, string> = {
  green:  "All good — reaching out is perfectly normal right now.",
  yellow: "It's been a little while — a message would be well received.",
  red:    "It's been a while. Reaching out now is not unusual and likely welcomed.",
  black:  "It's been a long time, but reconnecting is always possible. A warm message acknowledging the gap works well.",
};

export function computeSafetyIndicator(drift: DriftStatus): SafetyIndicator {
  return { status: drift, copy: SAFETY_COPY[drift] };
}

// ── Occasions ─────────────────────────────────────────────────────────────────

/**
 * Returns any upcoming occasions for the contact.
 * Currently only birthday triggers (±2 days).
 */
export function computeOccasions(
  birthday: string | null | undefined,
  today: string
): OccasionTrigger[] {
  if (!birthday) return [];

  const daysUntil = daysUntilBirthday(birthday, today);
  if (daysUntil === null) return [];

  if (daysUntil >= -2 && daysUntil <= 2) {
    const label =
      daysUntil === 0 ? "Birthday today! 🎂" :
      daysUntil > 0   ? `Birthday in ${daysUntil} day${daysUntil === 1 ? "" : "s"} 🎂` :
                        `Birthday was ${Math.abs(daysUntil)} day${daysUntil === -1 ? "" : "s"} ago 🎂`;

    return [{ type: "birthday", label, daysUntil }];
  }

  return [];
}

// ── Private helpers ───────────────────────────────────────────────────────────

function diffDays(from: string, to: string): number {
  return Math.floor(
    (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000
  );
}

/**
 * Days from today until the contact's next birthday (this year or next).
 * Returns null if the birthday string can't be parsed.
 * Negative means birthday was in the recent past (within the trigger window).
 */
function daysUntilBirthday(birthday: string, today: string): number | null {
  const bdMatch = birthday.match(/(\d{2})-(\d{2})$/); // MM-DD or YYYY-MM-DD
  if (!bdMatch) return null;

  const month = parseInt(bdMatch[1], 10) - 1; // 0-indexed
  const day   = parseInt(bdMatch[2], 10);

  // Parse today as UTC to avoid local-timezone shift
  const todayDate = new Date(today + "T00:00:00Z");
  const year      = todayDate.getUTCFullYear();

  // Build birthday dates in UTC to stay consistent
  const thisYearISO = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const diff = diffDays(today, thisYearISO);

  // diff > 0 means birthday is in the future; diff < 0 means it was in the past
  if (diff >= -2) return diff;

  // Birthday has passed more than 2 days ago — check next year
  const nextYearISO = `${year + 1}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return diffDays(today, nextYearISO);
}
