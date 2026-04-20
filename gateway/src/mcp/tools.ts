/**
 * Kit MCP tool implementations
 *
 * Direct Supabase queries used by the MCP server. Each function maps
 * to one callable tool exposed to Claude Desktop.
 *
 * Open Brain writes use the context binding protocol
 * (gateway/src/context-binding/) — each contact is an entity,
 * thoughts are typed (INTERACTION, NEXT_ACTION, OBSERVATION, etc.).
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ContextBinder, toCanonicalName, ThoughtType } from "../context-binding/index.js";
import { buildCheckinReport, formatCheckinReport, type CheckinContact, type CheckinFollowUp } from "../services/checkin.js";
import { buildPrepCard, buildDraftContext, type PrepContact, type PrepInteraction, type PrepFollowUp, type PrepBrainContext } from "../services/prep.js";
import { buildReconnectContext, type ReconnectContact, type ReconnectInteraction } from "../services/reconnect.js";

const _toolsDir = path.dirname(fileURLToPath(import.meta.url));
const PEOPLE_DIR = path.resolve(_toolsDir, "..", "..", "..", "People");

// ── Supabase clients (initialised eagerly at module load) ─────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const _kit = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_KEY")
);

function kitClient() { return _kit.schema("kit"); }

// ── Context binder (replaces raw brainClient writes) ─────────────────────────

const _binder = new ContextBinder({
  supabaseUrl: requireEnv("OPEN_BRAIN_URL"),
  supabaseKey: requireEnv("OPEN_BRAIN_SERVICE_KEY"),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Contact {
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

export interface Interaction {
  id: string;
  contact_id: string;
  date: string;
  channel: string | null;
  notes: string | null;
}

export interface FollowUp {
  id: string;
  contact_id: string;
  text: string;
  completed: boolean;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysOverdue(nextAction: string | null): number {
  if (!nextAction) return 0;
  const today = new Date(todayISO()).getTime();
  const due = new Date(nextAction).getTime();
  return Math.round((today - due) / 86_400_000);
}

function tierLabel(tier: number): string {
  if (tier === 1) return "Inner Circle";
  if (tier === 2) return "Active";
  return "Business";
}

/**
 * Resolve a contact by name fragment or exact ID.
 * Returns the best match or null.
 */
async function resolveContact(nameOrId: string): Promise<Contact | null> {
  const db = kitClient();

  // Try exact ID first
  const { data: byId } = await db
    .from("contacts")
    .select("*")
    .eq("id", nameOrId)
    .single();
  if (byId) return byId as Contact;

  // Case-insensitive name search
  const { data: byName } = await db
    .from("contacts")
    .select("*")
    .ilike("name", `%${nameOrId}%`)
    .eq("active", true)
    .limit(1);

  return byName?.[0] ?? null;
}

// ── Tool: get_queue ───────────────────────────────────────────────────────────

export interface QueueResult {
  overdue: Array<Contact & { days_overdue: number }>;
  due_this_week: Array<Contact & { days_overdue: number }>;
}

export async function getQueue(): Promise<QueueResult> {
  const db = kitClient();
  const today = todayISO();
  const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const [overdueRes, weekRes] = await Promise.all([
    db
      .from("contacts")
      .select("*")
      .eq("active", true)
      .lte("next_action", today)
      .order("next_action", { ascending: true }),
    db
      .from("contacts")
      .select("*")
      .eq("active", true)
      .gt("next_action", today)
      .lte("next_action", weekAhead)
      .order("next_action", { ascending: true }),
  ]);

  const overdue = (overdueRes.data ?? []).map((c) => ({
    ...(c as Contact),
    days_overdue: daysOverdue(c.next_action),
  }));

  const due_this_week = (weekRes.data ?? []).map((c) => ({
    ...(c as Contact),
    days_overdue: daysOverdue(c.next_action),
  }));

  return { overdue, due_this_week };
}

// ── Tool: get_contact ─────────────────────────────────────────────────────────

export interface ContactDetail {
  contact: Contact;
  tier_label: string;
  days_overdue: number;
  recent_interactions: Interaction[];
  open_follow_ups: FollowUp[];
  open_brain_context: Array<{
    content: string;
    type: string | null;
    date: string | null;
  }>;
}

export async function getContact(nameOrId: string): Promise<ContactDetail | null> {
  const contact = await resolveContact(nameOrId);
  if (!contact) return null;

  const db = kitClient();
  const entity = toCanonicalName(contact.name);

  const [interactionsRes, followUpsRes, brainContext] = await Promise.all([
    db
      .from("interaction_log")
      .select("*")
      .eq("contact_id", contact.id)
      .order("date", { ascending: false })
      .limit(5),
    db
      .from("follow_ups")
      .select("*")
      .eq("contact_id", contact.id)
      .eq("completed", false)
      .order("created_at", { ascending: true }),
    _binder.getContext({ entity, limit: 5 }).catch(() => []),
  ]);

  return {
    contact,
    tier_label: tierLabel(contact.tier),
    days_overdue: daysOverdue(contact.next_action),
    recent_interactions: (interactionsRes.data ?? []) as Interaction[],
    open_follow_ups: (followUpsRes.data ?? []) as FollowUp[],
    open_brain_context: brainContext.map((t) => ({
      content: t.content,
      type: t.thoughtType,
      date: t.createdAt?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

// ── Tool: search_contacts ─────────────────────────────────────────────────────

export async function searchContacts(query: string): Promise<Contact[]> {
  const { data } = await kitClient()
    .from("contacts")
    .select("*")
    .ilike("name", `%${query}%`)
    .order("name", { ascending: true });

  return (data ?? []) as Contact[];
}

// ── Tool: log_interaction ─────────────────────────────────────────────────────

export interface LogInteractionInput {
  contact_name: string;
  notes: string;
  date?: string; // defaults to today
  channel?: string; // defaults to "other"
  follow_ups?: string[]; // new follow-up items to create
}

export async function logInteraction(input: LogInteractionInput): Promise<string> {
  const contact = await resolveContact(input.contact_name);
  if (!contact) return `Contact "${input.contact_name}" not found.`;

  const db = kitClient();
  const date = input.date ?? todayISO();
  const channel = input.channel ?? "other";

  // Write to interaction_log
  const { error: logError } = await db.from("interaction_log").insert({
    id: crypto.randomUUID(),
    contact_id: contact.id,
    date,
    channel,
    notes: input.notes,
  });
  if (logError) throw new Error(`interaction_log insert failed: ${logError.message}`);

  // Update contacts.last_contact and next_action
  const nextAction = new Date(
    new Date(date).getTime() + contact.frequency_days * 86_400_000
  )
    .toISOString()
    .slice(0, 10);

  await db
    .from("contacts")
    .update({ last_contact: date, next_action: nextAction })
    .eq("id", contact.id);

  // Create any new follow-up items
  if (input.follow_ups?.length) {
    const rows = input.follow_ups.map((text) => ({
      contact_id: contact.id,
      text,
      completed: false,
    }));
    await db.from("follow_ups").insert(rows);
  }

  // Write to Open Brain via context binding protocol
  const entity = toCanonicalName(contact.name);
  const thoughtContent = [
    `Interaction with ${contact.name} on ${date} (${channel}).`,
    input.notes,
    input.follow_ups?.length
      ? `Follow-ups: ${input.follow_ups.join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  await _binder.captureThought({
    content: thoughtContent,
    entity,
    thoughtType: ThoughtType.INTERACTION,
    extraTopics: [channel],
    people: [contact.name],
    actions: input.follow_ups,
    source: "kit-mcp",
  });

  // Also capture individual follow-ups as NEXT_ACTION thoughts
  if (input.follow_ups?.length) {
    await Promise.all(
      input.follow_ups.map((text) =>
        _binder.captureThought({
          content: text,
          entity,
          thoughtType: ThoughtType.NEXT_ACTION,
          people: [contact.name],
          source: "kit-mcp",
        })
      )
    );
  }

  const followUpSummary =
    input.follow_ups?.length ? ` Added ${input.follow_ups.length} follow-up(s).` : "";
  return `Logged interaction with ${contact.name} on ${date}.${followUpSummary} Next action scheduled for ${nextAction}.`;
}

// ── Tool: add_follow_up ───────────────────────────────────────────────────────

export async function addFollowUp(contactNameOrId: string, text: string): Promise<string> {
  const contact = await resolveContact(contactNameOrId);
  if (!contact) return `Contact "${contactNameOrId}" not found.`;

  const entity = toCanonicalName(contact.name);

  // Write to Kit follow_ups table
  const { error } = await kitClient().from("follow_ups").insert({
    contact_id: contact.id,
    text,
    completed: false,
  });
  if (error) throw new Error(`follow_ups insert failed: ${error.message}`);

  // Write to Open Brain as NEXT_ACTION via context binding
  await _binder.captureThought({
    content: text,
    entity,
    thoughtType: ThoughtType.NEXT_ACTION,
    people: [contact.name],
    source: "kit-mcp",
  });

  return `Follow-up added for ${contact.name}: "${text}"`;
}

// ── Tool: sweep_now ───────────────────────────────────────────────────────────

export interface SweepNowResult {
  contactsSwept: number;
  contactsSkipped: number;
  threadsProcessed: number;
  errors: number;
  details: Array<{
    contactName: string;
    messagesFound: number;
    threadsProcessed: number;
    skipped: boolean;
    skipReason?: string;
    error?: string;
  }>;
}

/**
 * Trigger a WhatsApp history sweep via the gateway REST API.
 * The gateway must be running locally on PORT (default 3141).
 */
export async function sweepNow(contactName?: string): Promise<string> {
  const port = process.env.PORT ?? "3141";
  const url = `http://localhost:${port}/api/sweep/run`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contactName ? { contact_name: contactName } : {}),
    });
  } catch (err: any) {
    return `Could not reach the Kit gateway at ${url}. Is it running?\nError: ${err.message}`;
  }

  if (response.status === 409) {
    return "A sweep is already in progress — try again shortly.";
  }

  if (!response.ok) {
    const body = await response.text();
    return `Sweep failed (HTTP ${response.status}): ${body}`;
  }

  const result = await response.json() as SweepNowResult;

  const lines: string[] = [
    `## Sweep complete`,
    `- Contacts swept: ${result.contactsSwept}`,
    `- Threads processed: ${result.threadsProcessed}`,
    `- Contacts skipped: ${result.contactsSkipped}`,
    `- Errors: ${result.errors}`,
  ];

  if (result.details.length > 0) {
    lines.push("\n### Details");
    for (const d of result.details) {
      if (d.skipped) {
        lines.push(`- **${d.contactName}** — skipped (${d.skipReason ?? "unknown"})`);
      } else if (d.error) {
        lines.push(`- **${d.contactName}** — ${d.messagesFound} messages, ${d.threadsProcessed} threads ⚠️ ${d.error}`);
      } else if (d.messagesFound === 0) {
        lines.push(`- **${d.contactName}** — no new messages`);
      } else {
        lines.push(`- **${d.contactName}** — ${d.messagesFound} messages → ${d.threadsProcessed} thread(s) captured`);
      }
    }
  }

  return lines.join("\n");
}

// ── Tool: create_contact ──────────────────────────────────────────────────────

const TIER_FOLDER: Record<number, string> = {
  1: "1 - Inner Circle",
  2: "2 - Active",
  3: "3 - Business Contact",
};

const TIER_RELATIONSHIP: Record<number, string> = {
  1: "1-Inner Circle",
  2: "2-Active",
  3: "3-Business Contact",
};

const TIER_TAG: Record<number, string> = {
  1: "1-inner-circle",
  2: "2-active",
  3: "3-business-contact",
};

export interface CreateContactInput {
  name: string;
  tier: 1 | 2 | 3;
  frequency: string;
  origin_story?: string;
  notes?: string;
  social_battery_cost?: string;
  whatsapp?: string;
}

function buildMarkdown(input: CreateContactInput): string {
  const rel = TIER_RELATIONSHIP[input.tier];
  const tag = TIER_TAG[input.tier];
  const bg = input.origin_story ?? "<!-- Add background here -->";
  const notes = input.notes ?? "<!-- Add notes here -->";

  return `---
name: ${input.name}
relationship: ${rel}
frequency: ${input.frequency}
last_contact:
next_action:
tags: [people, ${tag}]
---

# ${input.name}

## At a Glance

**Relationship:** ${rel}
**Contact Frequency:** ${input.frequency}
**Last Contact:**
**Next Action:**

## Background

${bg}

## Notes

${notes}

## Interaction Log

<!-- Add notes after each contact below -->
`;
}

export async function createContact(input: CreateContactInput): Promise<string> {
  const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  // Check for duplicates
  const { data: existing } = await kitClient().from("contacts").select("id").eq("id", id).single();
  if (existing) return `Contact "${input.name}" already exists (id: ${id}).`;

  const frequencyDays: Record<string, number> = {
    weekly: 7, fortnightly: 14, "bi-weekly": 14, monthly: 30,
    "bi-monthly": 60, quarterly: 90, "twice yearly": 180,
    "bi-annual": 180, annual: 365, yearly: 365,
  };
  const frequency_days = frequencyDays[input.frequency.toLowerCase()] ?? 30;

  // Write markdown file
  const folder = path.join(PEOPLE_DIR, TIER_FOLDER[input.tier]);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, `${input.name}.md`);
  fs.writeFileSync(filePath, buildMarkdown(input), "utf-8");

  // Upsert to Supabase
  const { error } = await kitClient().from("contacts").upsert({
    id,
    name: input.name,
    tier: input.tier,
    frequency: input.frequency,
    frequency_days,
    last_contact: null,
    next_action: null,
    social_battery_cost: input.social_battery_cost ?? null,
    origin_story: input.origin_story ?? null,
    notes: input.notes ?? null,
    whatsapp: input.whatsapp ?? null,
    active: true,
    wa_capture: "on_demand",
  });
  if (error) throw new Error(`DB upsert failed: ${error.message}`);

  // Capture to Open Brain
  const entity = toCanonicalName(input.name);
  const parts = [`New contact created: ${input.name} (Tier ${input.tier}, ${input.frequency}).`];
  if (input.origin_story) parts.push(input.origin_story);
  if (input.notes) parts.push(input.notes);

  await _binder.captureThought({
    content: parts.join("\n"),
    entity,
    thoughtType: ThoughtType.OBSERVATION,
    people: [input.name],
    source: "kit-mcp",
  });

  return `Created contact "${input.name}" (${id}). Markdown written to People/${TIER_FOLDER[input.tier]}/${input.name}.md. DB row inserted. Open Brain observation captured.`;
}

// ── Tool: kit_prep_card ───────────────────────────────────────────────────────

export async function kitPrepCard(contactNameOrId: string): Promise<string> {
  const detail = await getContact(contactNameOrId);
  if (!detail) return `Contact "${contactNameOrId}" not found.`;

  const { contact: c, recent_interactions, open_follow_ups, open_brain_context } = detail;

  const prepContact: PrepContact = {
    id: c.id,
    name: c.name,
    tier: c.tier,
    frequency: c.frequency,
    last_contact: c.last_contact,
    next_action: c.next_action,
    social_battery_cost: c.social_battery_cost,
    origin_story: c.origin_story,
    special_interests: (c as any).special_interests ?? null,
    sensitive_topics: (c as any).sensitive_topics ?? null,
    preferred_channel: (c as any).preferred_channel ?? null,
    notes: c.notes,
  };

  const interactions: PrepInteraction[] = recent_interactions.map((i) => ({
    date: i.date,
    channel: i.channel,
    notes: i.notes,
  }));

  const followUps: PrepFollowUp[] = open_follow_ups.map((fu) => ({
    text: fu.text,
    completed: fu.completed,
  }));

  const brainCtx: PrepBrainContext[] = open_brain_context.map((t) => ({
    content: t.content,
    type: t.type,
    date: t.date,
  }));

  return buildPrepCard(prepContact, interactions, followUps, brainCtx);
}

// ── Tool: kit_draft_context ───────────────────────────────────────────────────

export async function kitDraftContext(contactNameOrId: string, intent?: string): Promise<string> {
  const detail = await getContact(contactNameOrId);
  if (!detail) return `Contact "${contactNameOrId}" not found.`;

  const { contact: c, recent_interactions, open_follow_ups, open_brain_context } = detail;

  const prepContact: PrepContact = {
    id: c.id,
    name: c.name,
    tier: c.tier,
    frequency: c.frequency,
    last_contact: c.last_contact,
    next_action: c.next_action,
    social_battery_cost: c.social_battery_cost,
    origin_story: c.origin_story,
    special_interests: (c as any).special_interests ?? null,
    sensitive_topics: (c as any).sensitive_topics ?? null,
    preferred_channel: (c as any).preferred_channel ?? null,
    notes: c.notes,
  };

  const interactions: PrepInteraction[] = recent_interactions.map((i) => ({
    date: i.date,
    channel: i.channel,
    notes: i.notes,
  }));

  const followUps: PrepFollowUp[] = open_follow_ups.map((fu) => ({
    text: fu.text,
    completed: fu.completed,
  }));

  const brainCtx: PrepBrainContext[] = open_brain_context.map((t) => ({
    content: t.content,
    type: t.type,
    date: t.date,
  }));

  return buildDraftContext(prepContact, interactions, followUps, brainCtx, intent);
}

// ── Tool: kit_reconnect_context ───────────────────────────────────────────────

export async function kitReconnectContext(contactNameOrId: string): Promise<string> {
  const detail = await getContact(contactNameOrId);
  if (!detail) return `Contact "${contactNameOrId}" not found.`;

  const { contact: c, recent_interactions } = detail;

  const rc: ReconnectContact = {
    name: c.name,
    tier: c.tier,
    frequency: c.frequency,
    last_contact: c.last_contact,
    origin_story: c.origin_story,
    special_interests: (c as any).special_interests ?? null,
    sensitive_topics: (c as any).sensitive_topics ?? null,
    preferred_channel: (c as any).preferred_channel ?? null,
    notes: c.notes,
  };

  const interactions: ReconnectInteraction[] = recent_interactions.slice(0, 1).map((i) => ({
    date: i.date,
    channel: i.channel,
    notes: i.notes,
  }));

  return buildReconnectContext(rc, interactions);
}

// ── Tool: kit_daily_checkin ───────────────────────────────────────────────────

export async function dailyCheckin(): Promise<string> {
  const db = kitClient();
  const today = todayISO();

  // 1. Read today's energy level
  const { data: energyRow } = await db
    .from("energy_state")
    .select("level")
    .eq("day", today)
    .single();

  if (!energyRow?.level) {
    return [
      "⚡ No energy level set for today.",
      "",
      "Run `/kit-energy high`, `/kit-energy medium`, or `/kit-energy low` first,",
      "then run `/kit-checkin` again.",
    ].join("\n");
  }

  const energy = energyRow.level as "high" | "medium" | "low";

  // 2. Load contacts with the fields we need
  const { data: rows } = await db
    .from("contacts")
    .select("id, name, tier, frequency_days, last_contact, next_action, social_battery_cost, birthday")
    .eq("active", true);

  const contacts: CheckinContact[] = (rows ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    tier: r.tier,
    frequency_days: r.frequency_days ?? 30,
    last_contact: r.last_contact ?? null,
    next_action: r.next_action ?? null,
    social_battery_cost: r.social_battery_cost ?? null,
    birthday: r.birthday ?? null,
  }));

  // 3. Load all open follow-ups
  const { data: fuRows } = await db
    .from("follow_ups")
    .select("contact_id, text, contacts!inner(name)")
    .eq("completed", false);

  const followUps: CheckinFollowUp[] = (fuRows ?? []).map((r: any) => ({
    contact_name: r.contacts?.name ?? r.contact_id,
    text: r.text,
  }));

  // 4. Build and format the report
  const report = buildCheckinReport(energy, contacts, followUps, today);
  return formatCheckinReport(report);
}

// ── Tool: set_energy / get_energy ────────────────────────────────────────────

export type EnergyLevel = "high" | "medium" | "low";

export async function setEnergy(level: string): Promise<string> {
  const normalized = level.toLowerCase();
  if (!["high", "medium", "low"].includes(normalized)) {
    return `Invalid energy level "${level}". Use: high, medium, or low.`;
  }

  const today = todayISO();
  const { error } = await kitClient()
    .from("energy_state")
    .upsert({ day: today, level: normalized }, { onConflict: "day" });

  if (error) throw new Error(`Failed to save energy level: ${error.message}`);
  return `Energy set to **${normalized}** for today (${today}).`;
}

export async function getEnergy(): Promise<string> {
  const today = todayISO();
  const { data } = await kitClient()
    .from("energy_state")
    .select("level")
    .eq("day", today)
    .single();

  if (!data?.level) {
    return `No energy level set for today (${today}). Use \`/kit-energy high|medium|low\` to set it.`;
  }
  return `Today's energy level: **${data.level}** (${today}).`;
}

// ── Tool: complete_follow_up ──────────────────────────────────────────────────

export async function completeFollowUp(
  contactNameOrId: string,
  followUpText: string
): Promise<string> {
  const contact = await resolveContact(contactNameOrId);
  if (!contact) return `Contact "${contactNameOrId}" not found.`;

  const db = kitClient();

  // Find the matching open follow-up
  const { data } = await db
    .from("follow_ups")
    .select("id, text")
    .eq("contact_id", contact.id)
    .eq("completed", false)
    .ilike("text", `%${followUpText}%`)
    .limit(1);

  if (!data?.length) {
    return `No open follow-up matching "${followUpText}" found for ${contact.name}.`;
  }

  const { error } = await db
    .from("follow_ups")
    .update({ completed: true })
    .eq("id", data[0].id);

  if (error) throw new Error(`follow_ups update failed: ${error.message}`);

  return `Marked as done for ${contact.name}: "${data[0].text}"`;
}

// ── Tool: kit_pending_captures ────────────────────────────────────────────────

export async function getPendingCaptures(): Promise<string> {
  const port = process.env.PORT ?? "3141";
  const url = `http://localhost:${port}/api/captures/pending`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err: any) {
    return `Could not reach the Kit gateway at ${url}. Is it running?\nError: ${err.message}`;
  }

  if (!response.ok) {
    return `Failed to fetch pending captures (HTTP ${response.status}).`;
  }

  const reviews = await response.json() as Array<{
    contactId: string;
    result: { contactName: string; summary: string; topics: string; messageCount: number };
  }>;

  if (reviews.length === 0) {
    return "No captures pending review.";
  }

  const lines = [`## Pending Captures (${reviews.length})`];
  for (const r of reviews) {
    lines.push(
      `\n### ${r.result.contactName} (id: \`${r.contactId}\`)`,
      `**Messages:** ${r.result.messageCount} | **Topics:** ${r.result.topics}`,
      `**Summary:** ${r.result.summary}`
    );
  }
  lines.push("\nUse `/kit-captures confirm <id>` or `/kit-captures dismiss <id>` to action them.");
  return lines.join("\n");
}

// ── Tool: kit_confirm_capture ─────────────────────────────────────────────────

export async function confirmCapture(contactId: string): Promise<string> {
  const port = process.env.PORT ?? "3141";
  const url = `http://localhost:${port}/api/captures/confirm/${encodeURIComponent(contactId)}`;

  let response: Response;
  try {
    response = await fetch(url, { method: "POST" });
  } catch (err: any) {
    return `Could not reach the Kit gateway. Is it running?\nError: ${err.message}`;
  }

  if (response.status === 404) return `No pending capture found for contact id \`${contactId}\`.`;
  if (!response.ok) return `Confirm failed (HTTP ${response.status}).`;

  return `Capture confirmed and saved for contact \`${contactId}\`.`;
}

// ── Tool: kit_dismiss_capture ─────────────────────────────────────────────────

export async function dismissCapture(contactId: string): Promise<string> {
  const port = process.env.PORT ?? "3141";
  const url = `http://localhost:${port}/api/captures/dismiss/${encodeURIComponent(contactId)}`;

  let response: Response;
  try {
    response = await fetch(url, { method: "POST" });
  } catch (err: any) {
    return `Could not reach the Kit gateway. Is it running?\nError: ${err.message}`;
  }

  if (response.status === 404) return `No pending capture found for contact id \`${contactId}\`.`;
  if (!response.ok) return `Dismiss failed (HTTP ${response.status}).`;

  return `Capture dismissed for contact \`${contactId}\`.`;
}
