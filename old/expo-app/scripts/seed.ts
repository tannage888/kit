/**
 * seed.ts — parses all markdown contacts from People/ and upserts them
 * directly into Supabase (Open Brain). Idempotent — safe to re-run.
 *
 * Run: npm run seed
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ---- Types -----------------------------------------------------------------

interface ContactRow {
  id: string;
  name: string;
  tier: number;
  frequency: string;
  frequency_days: number;
  last_contact: string | null;
  next_action: string | null;
  social_battery_cost: string | null;
  origin_story: string | null;
  notes: string | null;
  whatsapp: string | null;
  active: boolean;
}

interface FollowUpRow {
  id: string;
  contact_id: string;
  text: string;
  completed: boolean;
  created_at: string;
}

interface InteractionRow {
  id: string;
  contact_id: string;
  notes: string;
  date: string;
  created_at: string;
}

// ---- Helpers ---------------------------------------------------------------

function frequencyToDays(frequency: string): number {
  const f = frequency.toLowerCase().trim();
  if (f === 'weekly') return 7;
  if (f === 'fortnightly' || f === 'bi-weekly') return 14;
  if (f === 'monthly') return 30;
  if (f === 'bi-monthly' || f === 'every two months') return 60;
  if (f === 'quarterly') return 90;
  if (f === 'twice yearly' || f === 'bi-annual' || f === 'bi-annually') return 180;
  if (f === 'annual' || f === 'annually' || f === 'yearly') return 365;
  const match = f.match(/every\s+(\d+)\s+(day|week|month)/);
  if (match) {
    const n = parseInt(match[1], 10);
    if (match[2] === 'day') return n;
    if (match[2] === 'week') return n * 7;
    if (match[2] === 'month') return n * 30;
  }
  return 30;
}

function relationshipToTier(rel: string): number {
  if (rel.startsWith('1') || rel.toLowerCase().includes('inner')) return 1;
  if (rel.startsWith('2') || rel.toLowerCase().includes('active')) return 2;
  return 3;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function extractSection(body: string, ...headers: string[]): string | null {
  for (const header of headers) {
    const regex = new RegExp(
      `^##\\s+${header}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$)`,
      'mi'
    );
    const match = body.match(regex);
    if (match) return match[1].trim() || null;
  }
  return null;
}

function parseInteractionLog(body: string, contactId: string): InteractionRow[] {
  const logSection = extractSection(body, 'Interaction Log');
  if (!logSection) return [];

  const rows: InteractionRow[] = [];
  const entries = logSection.split(/(?=^###\s)/m).filter(e => e.trim() && !e.trim().startsWith('<!--'));

  for (const entry of entries) {
    const lines = entry.trim().split('\n');
    const header = lines[0].replace(/^###\s*/, '').trim();
    const content = lines.slice(1).join('\n').trim();
    if (!content) continue;

    const dateMatch = header.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const date = dateMatch[1];

    const notesOnly = content.replace(/\*\*Follow-ups:\*\*[\s\S]*?(?=\n\n|\n###|$)/m, '').trim();
    if (!notesOnly) continue;

    rows.push({
      id: `${contactId}_${date}_${rows.length}`,
      contact_id: contactId,
      notes: notesOnly,
      date,
      created_at: `${date}T00:00:00.000Z`,
    });
  }

  return rows;
}

function parseFollowUps(body: string, contactId: string): FollowUpRow[] {
  const rows: FollowUpRow[] = [];
  const followUpRegex = /\*\*Follow-ups:\*\*\n([\s\S]*?)(?=\n\n###|\n\n##|$)/gm;
  let match;

  while ((match = followUpRegex.exec(body)) !== null) {
    const block = match[1];
    const items = block.match(/^[-*]\s+(.+)$/gm);
    if (!items) continue;
    for (const item of items) {
      const text = item.replace(/^[-*]\s+/, '').trim();
      if (!text) continue;
      rows.push({
        id: `fu_${contactId}_${rows.length}`,
        contact_id: contactId,
        text,
        completed: false,
        created_at: new Date().toISOString(),
      });
    }
  }

  return rows;
}

function extractPhone(body: string): string | null {
  const waMatch = body.match(/wa\.me\/(\d+)/);
  if (waMatch) return waMatch[1];
  const phoneMatch = body.match(/(?:\+44|07)\d{9,10}/);
  if (phoneMatch) return phoneMatch[0].replace(/\s+/g, '');
  return null;
}

function toISODate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// ---- Main ------------------------------------------------------------------

const PEOPLE_DIR = path.join(__dirname, '..', 'People');
const TIERS = [
  { dir: '1 - Inner Circle', tier: 1 },
  { dir: '2 - Active', tier: 2 },
  { dir: '3 - Business Contact', tier: 3 },
];

const contacts: ContactRow[] = [];
const followUps: FollowUpRow[] = [];
const interactions: InteractionRow[] = [];

for (const { dir, tier } of TIERS) {
  const tierPath = path.join(PEOPLE_DIR, dir);
  if (!fs.existsSync(tierPath)) {
    console.warn(`Directory not found: ${tierPath}`);
    continue;
  }

  const files = fs.readdirSync(tierPath).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const filePath = path.join(tierPath, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data: fm, content } = matter(raw);

    const name: string = fm.name ?? file.replace('.md', '');
    const id = slugify(name);
    const frequency: string = fm.frequency ?? 'Monthly';
    const frequency_days = frequencyToDays(frequency);
    const tierFromFm = fm.relationship ? relationshipToTier(fm.relationship) : tier;

    let social_battery_cost: string | null = null;
    if (fm.social_battery) {
      const sb = String(fm.social_battery);
      social_battery_cost = sb.charAt(0).toUpperCase() + sb.slice(1).toLowerCase();
    }

    const origin_story = extractSection(content, 'How We Met', 'Background', 'Role & Context');

    const noteParts: string[] = [];
    const interests = extractSection(content, 'Interests & Hooks', 'Interests');
    if (interests) noteParts.push(`**Interests:** ${interests}`);
    const sensitive = extractSection(content, 'Sensitive Topics');
    if (sensitive) noteParts.push(`**Sensitive:** ${sensitive}`);
    const notesSection = extractSection(content, 'Notes', 'Family');
    if (notesSection) noteParts.push(notesSection);

    const whatsapp = extractPhone(content);

    contacts.push({
      id,
      name,
      tier: tierFromFm,
      frequency,
      frequency_days,
      last_contact: fm.last_contact ? toISODate(fm.last_contact) : null,
      next_action: fm.next_action ? toISODate(fm.next_action) : null,
      social_battery_cost,
      origin_story: origin_story ?? null,
      notes: noteParts.length ? noteParts.join('\n\n') : null,
      whatsapp,
      active: true,
    });

    const contactFollowUps = parseFollowUps(content, id);
    const contactInteractions = parseInteractionLog(content, id);

    followUps.push(...contactFollowUps);
    interactions.push(...contactInteractions);

    console.log(`  ✓ ${name} (tier ${tierFromFm}, ${contactInteractions.length} interactions)`);
  }
}

// ---- Upsert to Supabase ----------------------------------------------------

console.log('\nUpserting to Supabase...');

async function run() {
  if (contacts.length) {
    const { error } = await supabase
      .schema('kit')
      .from('contacts')
      .upsert(contacts, { onConflict: 'id' });
    if (error) { console.error('contacts:', error.message); process.exit(1); }
    console.log(`  ✓ ${contacts.length} contacts`);
  }

  if (followUps.length) {
    const { error } = await supabase
      .schema('kit')
      .from('follow_ups')
      .upsert(followUps, { onConflict: 'id' });
    if (error) { console.error('follow_ups:', error.message); process.exit(1); }
    console.log(`  ✓ ${followUps.length} follow-ups`);
  }

  if (interactions.length) {
    const { error } = await supabase
      .schema('kit')
      .from('interaction_log')
      .upsert(interactions, { onConflict: 'id' });
    if (error) { console.error('interaction_log:', error.message); process.exit(1); }
    console.log(`  ✓ ${interactions.length} interaction log entries`);
  }

  // Mark seeded
  await supabase.schema('kit').from('kit_meta').upsert({ key: 'seeded', value: '1' });

  console.log('\nSeed complete.');
}

run();
