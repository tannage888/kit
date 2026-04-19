import {
  daysBetween,
  daysOverdue,
  calcNextAction,
  formatDate,
  tierLabel,
  frequencyToDays,
} from './dateUtils';

// ---------------------------------------------------------------------------
// daysBetween
// ---------------------------------------------------------------------------

describe('daysBetween', () => {
  it('returns 0 for same date', () => {
    expect(daysBetween('2026-04-03', '2026-04-03')).toBe(0);
  });

  it('returns positive when a is after b', () => {
    expect(daysBetween('2026-04-10', '2026-04-03')).toBe(7);
  });

  it('returns negative when a is before b', () => {
    expect(daysBetween('2026-04-03', '2026-04-10')).toBe(-7);
  });

  it('handles month boundaries', () => {
    expect(daysBetween('2026-05-01', '2026-04-30')).toBe(1);
  });

  it('handles year boundaries', () => {
    expect(daysBetween('2026-01-01', '2025-12-31')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// daysOverdue
// ---------------------------------------------------------------------------

describe('daysOverdue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-03'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 0 for null next_action', () => {
    expect(daysOverdue(null)).toBe(0);
  });

  it('returns positive when overdue', () => {
    expect(daysOverdue('2026-03-27')).toBe(7);
  });

  it('returns 0 when due today', () => {
    expect(daysOverdue('2026-04-03')).toBe(0);
  });

  it('returns negative when upcoming', () => {
    expect(daysOverdue('2026-04-10')).toBe(-7);
  });
});

// ---------------------------------------------------------------------------
// calcNextAction
// ---------------------------------------------------------------------------

describe('calcNextAction', () => {
  it('adds frequency_days to base date', () => {
    expect(calcNextAction('2026-04-03', 30)).toBe('2026-05-03');
  });

  it('handles month rollover', () => {
    expect(calcNextAction('2026-01-31', 30)).toBe('2026-03-02');
  });

  it('handles weekly frequency', () => {
    expect(calcNextAction('2026-04-03', 7)).toBe('2026-04-10');
  });

  it('handles quarterly frequency', () => {
    expect(calcNextAction('2026-01-01', 90)).toBe('2026-04-01');
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('returns em-dash for null', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('formats a date as "D Mon YYYY"', () => {
    expect(formatDate('2026-04-03')).toBe('3 Apr 2026');
  });

  it('formats single-digit days without padding', () => {
    expect(formatDate('2026-04-01')).toBe('1 Apr 2026');
  });
});

// ---------------------------------------------------------------------------
// tierLabel
// ---------------------------------------------------------------------------

describe('tierLabel', () => {
  it('returns Inner Circle for tier 1', () => {
    expect(tierLabel(1)).toBe('Inner Circle');
  });

  it('returns Active for tier 2', () => {
    expect(tierLabel(2)).toBe('Active');
  });

  it('returns Business for tier 3', () => {
    expect(tierLabel(3)).toBe('Business');
  });

  it('returns Business for unknown tier', () => {
    expect(tierLabel(99)).toBe('Business');
  });
});

// ---------------------------------------------------------------------------
// frequencyToDays
// ---------------------------------------------------------------------------

describe('frequencyToDays', () => {
  it.each([
    ['Weekly', 7],
    ['Fortnightly', 14],
    ['Monthly', 30],
    ['Quarterly', 90],
    ['Annual', 365],
  ])('%s → %i days', (input, expected) => {
    expect(frequencyToDays(input)).toBe(expected);
  });

  it('defaults to 30 for unknown input', () => {
    expect(frequencyToDays('whenever I feel like it')).toBe(30);
  });
});
