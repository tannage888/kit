import { createClient } from '@supabase/supabase-js';
import { Contact, FollowUp, InteractionLog } from '../types';
import { calcNextAction, today } from './dateUtils';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ---------------------------------------------------------------------------
// Seed state
// ---------------------------------------------------------------------------

export async function isSeeded(): Promise<boolean> {
  const { data } = await supabase
    .schema('kit')
    .from('kit_meta')
    .select('value')
    .eq('key', 'seeded')
    .single();
  return data?.value === '1';
}

export async function markSeeded(): Promise<void> {
  await supabase
    .schema('kit')
    .from('kit_meta')
    .upsert({ key: 'seeded', value: '1' });
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export async function seedContacts(
  contacts: Contact[],
  followUps: FollowUp[],
  interactions: InteractionLog[],
): Promise<void> {
  if (contacts.length) {
    const rows = contacts.map(c => ({
      ...c,
      active: c.active === 1 || c.active === true,
    }));
    await supabase.schema('kit').from('contacts').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  }

  if (followUps.length) {
    const rows = followUps.map(f => ({
      ...f,
      completed: f.completed === 1 || f.completed === true,
    }));
    await supabase.schema('kit').from('follow_ups').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  }

  if (interactions.length) {
    await supabase.schema('kit').from('interaction_log').upsert(interactions, { onConflict: 'id', ignoreDuplicates: true });
  }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function getAllActiveContacts(): Promise<Contact[]> {
  const { data, error } = await supabase
    .schema('kit')
    .from('contacts')
    .select('*')
    .eq('active', true)
    .order('tier', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normaliseContact);
}

export async function getContactById(id: string): Promise<Contact | null> {
  const { data, error } = await supabase
    .schema('kit')
    .from('contacts')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return normaliseContact(data);
}

export async function getOverdueContacts(): Promise<Contact[]> {
  const t = today();
  const { data, error } = await supabase
    .schema('kit')
    .from('contacts')
    .select('*')
    .eq('active', true)
    .lte('next_action', t)
    .order('next_action', { ascending: true })
    .order('tier', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normaliseContact);
}

export async function getDueThisWeek(): Promise<Contact[]> {
  const t = today();
  const end = new Date();
  end.setDate(end.getDate() + 7);
  const endStr = end.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .schema('kit')
    .from('contacts')
    .select('*')
    .eq('active', true)
    .gt('next_action', t)
    .lte('next_action', endStr)
    .order('next_action', { ascending: true })
    .order('tier', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normaliseContact);
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export async function getFollowUps(contactId: string): Promise<FollowUp[]> {
  const { data, error } = await supabase
    .schema('kit')
    .from('follow_ups')
    .select('*')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normaliseFollowUp);
}

export async function toggleFollowUp(id: string, completed: boolean): Promise<void> {
  const { error } = await supabase
    .from('follow_ups')
    .update({ completed })
    .eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Interaction log
// ---------------------------------------------------------------------------

export async function getInteractions(contactId: string): Promise<InteractionLog[]> {
  const { data, error } = await supabase
    .schema('kit')
    .from('interaction_log')
    .select('*')
    .eq('contact_id', contactId)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function logInteraction(
  contactId: string,
  contactName: string,
  notes: string,
  date: string,
): Promise<void> {
  const id = `${contactId}_${Date.now()}`;

  // Write to structured interaction log
  const { error: logError } = await supabase
    .schema('kit')
    .from('interaction_log')
    .insert({ id, contact_id: contactId, notes, date });
  if (logError) throw logError;

  // Update contact's last_contact and next_action
  const contact = await getContactById(contactId);
  if (contact) {
    const nextAction = calcNextAction(date, contact.frequency_days);
    const { error: updateError } = await supabase
      .schema('kit')
      .from('contacts')
      .update({ last_contact: date, next_action: nextAction })
      .eq('id', contactId);
    if (updateError) throw updateError;
  }

  // Mirror to Open Brain thoughts for AI querying
  await supabase.from('thoughts').insert({
    content: `Kit interaction — ${contactName} (${date}): ${notes}`,
    metadata: {
      source: 'kit',
      type: 'interaction',
      contact_id: contactId,
      person: contactName,
      date,
    },
  });
}

// ---------------------------------------------------------------------------
// Normalise Supabase rows → app types (boolean active → number, etc.)
// ---------------------------------------------------------------------------

function normaliseContact(row: any): Contact {
  return {
    ...row,
    active: row.active === true ? 1 : 0,
    last_contact: row.last_contact ?? null,
    next_action: row.next_action ?? null,
  };
}

function normaliseFollowUp(row: any): FollowUp {
  return {
    ...row,
    completed: row.completed === true ? 1 : 0,
  };
}
