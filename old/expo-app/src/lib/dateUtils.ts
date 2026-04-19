/** Returns today as YYYY-MM-DD */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Days between two YYYY-MM-DD strings (positive = a is after b) */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(a).getTime() - new Date(b).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Days overdue: positive = overdue, negative = upcoming
 * next_action vs today
 */
export function daysOverdue(next_action: string | null): number {
  if (!next_action) return 0;
  return daysBetween(today(), next_action);
}

/** next_action date = base + frequency_days */
export function calcNextAction(base: string, frequency_days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + frequency_days);
  return d.toISOString().slice(0, 10);
}

/** Map frequency string to days */
export function frequencyToDays(frequency: string): number {
  const f = frequency.toLowerCase().trim();
  if (f === 'weekly') return 7;
  if (f === 'fortnightly' || f === 'bi-weekly') return 14;
  if (f === 'monthly') return 30;
  if (f === 'bi-monthly' || f === 'every two months') return 60;
  if (f === 'quarterly') return 90;
  if (f === 'twice yearly' || f === 'bi-annual' || f === 'bi-annually') return 180;
  if (f === 'annual' || f === 'annually' || f === 'yearly') return 365;
  // fallback: try to parse "every N weeks/months/days"
  const match = f.match(/every\s+(\d+)\s+(day|week|month)/);
  if (match) {
    const n = parseInt(match[1], 10);
    if (match[2] === 'day') return n;
    if (match[2] === 'week') return n * 7;
    if (match[2] === 'month') return n * 30;
  }
  return 30; // safe default
}

/** Format YYYY-MM-DD to readable "3 Apr 2026" */
export function formatDate(date: string | null): string {
  if (!date) return '—';
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Returns tier label */
export function tierLabel(tier: number): string {
  if (tier === 1) return 'Inner Circle';
  if (tier === 2) return 'Active';
  return 'Business';
}
