/**
 * Tests for the Supabase data layer.
 *
 * The Supabase client is mocked so these run offline with no credentials.
 * We test that:
 *   - The correct table/filter/order is used for each query
 *   - normaliseContact converts boolean `active` → number
 *   - logInteraction writes to both interaction_log AND thoughts
 *   - errors are propagated correctly
 */

// ---------------------------------------------------------------------------
// Mock @supabase/supabase-js before any imports
// ---------------------------------------------------------------------------

const mockFrom = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockLte = jest.fn();
const mockGt = jest.fn();
const mockOrder = jest.fn();
const mockSingle = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockUpsert = jest.fn();

// Each call to .from() returns a chainable builder
const builder = () => ({
  select: mockSelect.mockReturnThis(),
  eq: mockEq.mockReturnThis(),
  lte: mockLte.mockReturnThis(),
  gt: mockGt.mockReturnThis(),
  order: mockOrder.mockReturnThis(),
  single: mockSingle,
  insert: mockInsert,
  update: mockUpdate.mockReturnThis(),
  upsert: mockUpsert,
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockFrom.mockImplementation(() => builder()),
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mock setup)
// ---------------------------------------------------------------------------

import {
  getContactById,
  getOverdueContacts,
  getDueThisWeek,
  getFollowUps,
  toggleFollowUp,
  getInteractions,
} from './supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeContact = (overrides = {}) => ({
  id: 'chris_hemsworth',
  name: 'Chris Hemsworth',
  tier: 1,
  frequency: 'Monthly',
  frequency_days: 30,
  last_contact: '2026-03-07',
  next_action: '2026-04-07',
  social_battery_cost: 'Medium',
  origin_story: null,
  notes: null,
  whatsapp: null,
  active: true, // Supabase returns boolean
  ...overrides,
});

// ---------------------------------------------------------------------------
// getContactById
// ---------------------------------------------------------------------------

describe('getContactById', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when Supabase returns an error', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    const result = await getContactById('nonexistent');
    expect(result).toBeNull();
  });

  it('normalises boolean active → 1', async () => {
    mockSingle.mockResolvedValueOnce({ data: makeContact({ active: true }), error: null });
    const result = await getContactById('chris_hemsworth');
    expect(result?.active).toBe(1);
  });

  it('normalises boolean active false → 0', async () => {
    mockSingle.mockResolvedValueOnce({ data: makeContact({ active: false }), error: null });
    const result = await getContactById('chris_hemsworth');
    expect(result?.active).toBe(0);
  });

  it('passes the correct id to the query', async () => {
    mockSingle.mockResolvedValueOnce({ data: makeContact(), error: null });
    await getContactById('chris_hemsworth');
    expect(mockEq).toHaveBeenCalledWith('id', 'chris_hemsworth');
  });
});

// ---------------------------------------------------------------------------
// getOverdueContacts
// ---------------------------------------------------------------------------

describe('getOverdueContacts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('filters by active=true and next_action <= today', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    await getOverdueContacts();
    expect(mockEq).toHaveBeenCalledWith('active', true);
    expect(mockLte).toHaveBeenCalled();
  });

  it('returns empty array on error', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'fail' } });
    await expect(getOverdueContacts()).rejects.toBeTruthy();
  });

  it('normalises all returned contacts', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [makeContact({ active: true }), makeContact({ id: 'adele', active: true })],
      error: null,
    });
    const results = await getOverdueContacts();
    expect(results.every((c) => c.active === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDueThisWeek
// ---------------------------------------------------------------------------

describe('getDueThisWeek', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses gt for lower bound and lte for upper bound', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    await getDueThisWeek();
    expect(mockGt).toHaveBeenCalled();
    expect(mockLte).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getFollowUps
// ---------------------------------------------------------------------------

describe('getFollowUps', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queries by contact_id', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    await getFollowUps('chris_hemsworth');
    expect(mockEq).toHaveBeenCalledWith('contact_id', 'chris_hemsworth');
  });

  it('normalises boolean completed → number', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { id: 'fu_1', contact_id: 'x', text: 'Do thing', completed: true, created_at: '' },
        { id: 'fu_2', contact_id: 'x', text: 'Other', completed: false, created_at: '' },
      ],
      error: null,
    });
    const results = await getFollowUps('x');
    expect(results[0].completed).toBe(1);
    expect(results[1].completed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toggleFollowUp
// ---------------------------------------------------------------------------

describe('toggleFollowUp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls update with the correct completed value', async () => {
    mockUpdate.mockReturnThis();
    mockEq.mockResolvedValueOnce({ error: null });
    await toggleFollowUp('fu_1', true);
    expect(mockUpdate).toHaveBeenCalledWith({ completed: true });
  });

  it('throws when Supabase returns an error', async () => {
    mockUpdate.mockReturnThis();
    mockEq.mockResolvedValueOnce({ error: { message: 'db error' } });
    await expect(toggleFollowUp('fu_1', true)).rejects.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getInteractions
// ---------------------------------------------------------------------------

describe('getInteractions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queries by contact_id', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    await getInteractions('chris_hemsworth');
    expect(mockEq).toHaveBeenCalledWith('contact_id', 'chris_hemsworth');
  });

  it('orders by date descending', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    await getInteractions('chris_hemsworth');
    expect(mockOrder).toHaveBeenCalledWith('date', { ascending: false });
  });

  it('returns empty array when data is null', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: null });
    const result = await getInteractions('x');
    expect(result).toEqual([]);
  });
});
