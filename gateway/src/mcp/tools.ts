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

import { createClient } from "@supabase/supabase-js";
import { ContextBinder, toCanonicalName, ThoughtType } from "../context-binding/index.js";
import { buildCheckinReport, formatCheckinReport, type CheckinContact, type CheckinFollowUp } from "../services/checkin.js";
import { buildPrepCard, buildDraftContext, type PrepContact, type PrepInteraction, type PrepFollowUp, type PrepBrainContext } from "../services/prep.js";
import { buildReconnectContext, type ReconnectContact, type ReconnectInteraction } from "../services/reconnect.js";
import { normaliseEmail } from "../utils/markdown.js";

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
  email: string | null;
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

// ── Tool: get-queue ───────────────────────────────────────────────────────────

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

// ── Tool: get-contact ─────────────────────────────────────────────────────────

export interface ContactDetail {
  contact: Contact;
  tier_label: string;
  days_overdue: number;
  recent_interactions: Interaction[];
  /** Group-chat interactions, kept apart so they are never read as direct conversation. */
  recent_group_interactions: Interaction[];
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

  const [interactionsRes, followUpsRes, brainContext, groupInteractionsRes] = await Promise.all([
    db
      .from("interaction_log")
      .select("*")
      .eq("contact_id", contact.id)
      .is("group_jid", null)
      .order("date", { ascending: false })
      .limit(5),
    db
      .from("follow_ups")
      .select("*")
      .eq("contact_id", contact.id)
      .eq("completed", false)
      .order("created_at", { ascending: true }),
    _binder.getContext({ entity, limit: 5 }).catch(() => []),
    db
      .from("interaction_log")
      .select("*")
      .eq("contact_id", contact.id)
      .not("group_jid", "is", null)
      .order("date", { ascending: false })
      .limit(5),
  ]);

  return {
    contact,
    tier_label: tierLabel(contact.tier),
    days_overdue: daysOverdue(contact.next_action),
    recent_interactions: (interactionsRes.data ?? []) as Interaction[],
    recent_group_interactions: (groupInteractionsRes.data ?? []) as Interaction[],
    open_follow_ups: (followUpsRes.data ?? []) as FollowUp[],
    open_brain_context: brainContext.map((t) => ({
      content: t.content,
      type: t.thoughtType,
      date: t.createdAt?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

// ── Tool: search-contacts ─────────────────────────────────────────────────────

export async function searchContacts(query: string): Promise<Contact[]> {
  const { data } = await kitClient()
    .from("contacts")
    .select("*")
    .ilike("name", `%${query}%`)
    .order("name", { ascending: true });

  return (data ?? []) as Contact[];
}

// ── Tool: log-interaction ─────────────────────────────────────────────────────

export interface LogInteractionInput {
  contact_name: string;
  notes: string;
  date?: string; // defaults to today
  channel?: string; // defaults to "other"
  follow_ups?: string[]; // new follow-up items to create
  /**
   * The WhatsApp message this entry records, when it is one message Kit sent
   * itself. The sweep reads sent messages back off WhatsApp, so without this
   * it summarises them again and the send is logged twice.
   */
  wa_message_id?: string;
}

export async function logInteraction(input: LogInteractionInput): Promise<string> {
  const contact = await resolveContact(input.contact_name);
  if (!contact) return `Contact "${input.contact_name}" not found.`;

  const db = kitClient();
  const date = input.date ?? todayISO();
  const channel = input.channel ?? "other";

  // Write to interaction_log
  // Only send wa_message_id when there is one, so a database without the
  // migration applied still accepts every other write rather than failing
  // on an unknown column.
  const { error: logError } = await db.from("interaction_log").insert({
    id: crypto.randomUUID(),
    contact_id: contact.id,
    date,
    channel,
    notes: input.notes,
    ...(input.wa_message_id ? { wa_message_id: input.wa_message_id } : {}),
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

// ── Tool: add-follow-up ───────────────────────────────────────────────────────

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

// ── Tool: sweep-now ───────────────────────────────────────────────────────────

// ── Tool: get-conversation ────────────────────────────────────────────────────

export interface ConversationMessage {
  timestamp: number;
  fromMe: boolean;
  body: string;
}

export interface ConversationResponse {
  contact: { id: string; name: string };
  from: string;
  to: string;
  total: number;
  returned: number;
  truncated: boolean;
  messages: ConversationMessage[];
}

/**
 * Render a transcript as markdown, grouped by day.
 *
 * Exported for testing. Kept separate from the fetch so the formatting —
 * the part with the edge cases — can be tested without a live gateway.
 */
export function formatTranscript(
  data: ConversationResponse,
  contactName: string,
  days: number
): string {
  if (data.messages.length === 0) {
    return `No messages with ${contactName} in the last ${days} day${days === 1 ? "" : "s"}.`;
  }

  const lines: string[] = [
    `## Conversation with ${contactName}`,
    `${data.returned} message${data.returned === 1 ? "" : "s"} over the last ${days} day${days === 1 ? "" : "s"}.` +
      (data.truncated
        ? ` Showing the most recent ${data.returned} of ${data.total} — ask for a shorter window or a higher limit to see more.`
        : ""),
  ];

  let currentDay = "";
  for (const m of data.messages) {
    const when = new Date(m.timestamp);
    const day = when.toISOString().slice(0, 10);
    if (day !== currentDay) {
      currentDay = day;
      lines.push("", `### ${day}`);
    }
    const time = when.toISOString().slice(11, 16);
    const who = m.fromMe ? "Me" : contactName;
    // Media and other non-text messages arrive with an empty body.
    const body = m.body?.trim() ? m.body.trim() : "[no text content — media, reaction or deleted]";
    lines.push(`**${time} ${who}:** ${body.replace(/\n/g, "\n> ")}`);
  }

  return lines.join("\n");
}

/**
 * Fetch the raw message transcript for a contact via the gateway.
 *
 * Read-only: unlike sweep-now this summarises nothing and writes nothing —
 * it answers "what did they actually say?".
 */
export async function getConversation(input: {
  contact_name: string;
  days?: number;
  limit?: number;
}): Promise<string> {
  const contact = await resolveContact(input.contact_name);
  if (!contact) return `Contact "${input.contact_name}" not found.`;

  const days = input.days ?? 14;
  const limit = input.limit ?? 200;
  const port = process.env.PORT ?? "3141";
  const url =
    `http://localhost:${port}/api/contacts/${encodeURIComponent(contact.id)}/conversation` +
    `?days=${days}&limit=${limit}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err: any) {
    return `Could not reach the Kit gateway at ${url}. Is it running?\nError: ${err.message}`;
  }

  if (response.status === 404) return `${contact.name} is not in the live contact registry.`;
  if (response.status === 409) return `${contact.name} has no WhatsApp number on record.`;
  if (response.status === 403) {
    return `Capture is switched off for ${contact.name}, so their messages are not readable. Set wa_capture to on_demand or auto to change that.`;
  }
  if (response.status === 502) {
    return `The WhatsApp daemon did not respond. Check it is running on port 3142.`;
  }
  if (!response.ok) {
    return `Could not read the conversation (HTTP ${response.status}): ${await response.text()}`;
  }

  const data = (await response.json()) as ConversationResponse;
  return formatTranscript(data, contact.name, days);
}

// ── Tool: send-message ────────────────────────────────────────────────────────

export interface SendMessageResult {
  ok: boolean;
  messageId: string | null;
}

/**
 * Send a WhatsApp message to a Kit contact.
 *
 * Deliberately contact-only: the number is read from the contact record and
 * never taken from the caller, so a mistyped name fails closed with "not
 * found" rather than delivering a message to a stranger.
 *
 * Sending is not capture. A contact with `wa_capture: off` has opted out of
 * having *their* messages stored, which says nothing about whether you may
 * write to them, so that flag is deliberately not checked here.
 */
export async function sendMessage(input: {
  contact_name: string;
  text: string;
  log?: boolean;
}): Promise<string> {
  const text = input.text?.trim() ?? "";
  if (!text) return "Nothing to send — the message text is empty.";

  const contact = await resolveContact(input.contact_name);
  if (!contact) {
    return `Contact "${input.contact_name}" not found. Add them with create-contact first.`;
  }
  if (!contact.whatsapp) {
    return `${contact.name} has no WhatsApp number on record. Add one with update-contact before sending.`;
  }

  const port = process.env.PORT ?? "3141";
  const url = `http://localhost:${port}/api/send`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The stored number is human-formatted ("+65 9182 8173"); the gateway
      // wants strict E.164.
      body: JSON.stringify({ to: contact.whatsapp.replace(/\s+/g, ""), text }),
    });
  } catch (err: any) {
    return `Could not reach the Kit gateway at ${url}. Is it running?\nError: ${err.message}`;
  }

  if (response.status === 503) {
    return `The WhatsApp daemon is not connected, so nothing was sent to ${contact.name}. Check it is running on port 3142 and still paired.`;
  }
  if (!response.ok) {
    return `Message to ${contact.name} was not sent (HTTP ${response.status}): ${await response.text()}`;
  }

  const data = (await response.json()) as SendMessageResult;

  // Logging is best-effort by design: the message has already left, so a
  // bookkeeping failure must not read back to the user as a send failure.
  let logNote = "";
  if (input.log !== false) {
    try {
      await logInteraction({
        contact_name: contact.id,
        notes: `Sent via WhatsApp: ${text}`,
        channel: "whatsapp",
        // Lets the sweep recognise its own send when it reads the message
        // back, instead of summarising it as a second interaction.
        wa_message_id: data?.messageId ?? undefined,
      });
      logNote = "\nLogged as an interaction — last contact and next action updated.";
    } catch (err: any) {
      logNote = `\nSent, but logging it failed: ${err.message}`;
    }
  }

  const id = data?.messageId ? ` (id ${data.messageId})` : "";
  return `Sent to ${contact.name}${id}.${logNote}\n\n> ${text.replace(/\n/g, "\n> ")}`;
}

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

// ── Tool: create-contact ──────────────────────────────────────────────────────

export interface CreateContactInput {
  name: string;
  tier: 1 | 2 | 3;
  frequency: string;
  origin_story?: string;
  notes?: string;
  social_battery_cost?: string;
  whatsapp?: string;
  email?: string;
  whatsapp_capture?: "enabled" | "disabled";
  wa_capture?: "auto" | "on_demand" | "off";
}


export async function createContact(input: CreateContactInput): Promise<string> {
  // Delegate to the gateway REST API so the contact is immediately registered
  // in the live ContactRegistry (no restart or chokidar-trigger needed).
  const port = Number(process.env.PORT ?? 3141);
  const url = `http://localhost:${port}/api/contacts/create`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (err) {
    return `Could not reach the Kit gateway at ${url}. Is it running?\nError: ${(err as Error).message}`;
  }

  const body = (await response.json()) as any;

  if (response.status === 409) return `Contact "${input.name}" already exists.`;
  if (!response.ok) return `Failed to create contact: ${body?.detail ?? response.statusText}`;

  // Capture to Open Brain now that the contact row is confirmed in Supabase.
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

  const tier_folder = ({ 1: "1 - Inner Circle", 2: "2 - Active", 3: "3 - Business Contact" } as const)[input.tier];
  return `Created contact "${input.name}" (${body.id}). Markdown written to People/${tier_folder}/${input.name}.md. DB row inserted. Contact immediately active in Kit.`;
}

// ── Tool: kit-prep-card ───────────────────────────────────────────────────────

export async function kitPrepCard(contactNameOrId: string): Promise<string> {
  const detail = await getContact(contactNameOrId);
  if (!detail) return `Contact "${contactNameOrId}" not found.`;

  const { contact: c, recent_interactions, recent_group_interactions, open_follow_ups, open_brain_context } = detail;

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

  const groupInteractions: PrepInteraction[] = recent_group_interactions.map((i) => ({
    date: i.date,
    channel: i.channel,
    notes: i.notes,
    group_name: (i as any).group_name ?? null,
  }));

  return buildPrepCard(prepContact, interactions, followUps, brainCtx, groupInteractions);
}

// ── Tool: kit-draft-context ───────────────────────────────────────────────────

export async function kitDraftContext(contactNameOrId: string, intent?: string): Promise<string> {
  const detail = await getContact(contactNameOrId);
  if (!detail) return `Contact "${contactNameOrId}" not found.`;

  // Group activity is deliberately excluded — drafting should reference what
  // you actually said to each other, not what they said to a group.
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

// ── Tool: kit-reconnect-context ───────────────────────────────────────────────

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

// ── Tool: kit-daily-checkin ───────────────────────────────────────────────────

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

// ── Tool: complete-follow-up ──────────────────────────────────────────────────

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

// ── Tool: set-contact-active ──────────────────────────────────────────────────

export async function setContactActive(
  contactNameOrId: string,
  active: boolean
): Promise<string> {
  // Can't use resolveContact() — it filters active=true, which excludes
  // already-inactive contacts we'd want to re-activate.
  const db = kitClient();
  const { data } = await db
    .from("contacts")
    .select("id, name, active")
    .or(`id.eq.${contactNameOrId},name.ilike.%${contactNameOrId}%`)
    .limit(1);

  const contact = data?.[0];
  if (!contact) return `Contact "${contactNameOrId}" not found.`;

  if (contact.active === active) {
    return `${contact.name} is already ${active ? "active" : "inactive"}.`;
  }

  const { error } = await db
    .from("contacts")
    .update({ active })
    .eq("id", contact.id);

  if (error) throw new Error(`contacts update failed: ${error.message}`);

  return active
    ? `${contact.name} is now active again.`
    : `${contact.name} marked inactive — will be skipped by check-ins, sweeps, and follow-up prompts.`;
}

// ── Tool: update-contact ──────────────────────────────────────────────────────

/**
 * Canonical contact frequencies and their cadence in days.
 * Inlined here (rather than imported from services/contacts.ts) so the MCP
 * stdio process never pulls in config.ts, which exits the process if
 * ANTHROPIC_API_KEY is absent — the MCP server doesn't need that key.
 */
const FREQUENCY_DAYS: Record<string, number> = {
  Weekly: 7,
  Fortnightly: 14,
  Monthly: 30,
  "Bi-monthly": 60,
  Quarterly: 90,
  "Twice Yearly": 180,
  Annual: 365,
};

/** Normalise a free-form frequency word to its canonical label, or null if unknown. */
function normaliseFrequency(input: string): string | null {
  switch (input.trim().toLowerCase()) {
    case "weekly":                                  return "Weekly";
    case "fortnightly": case "bi-weekly":           return "Fortnightly";
    case "monthly":                                 return "Monthly";
    case "bi-monthly": case "every two months":     return "Bi-monthly";
    case "quarterly":                               return "Quarterly";
    case "twice yearly": case "bi-annual":
    case "bi-annually":                             return "Twice Yearly";
    case "annual": case "annually": case "yearly":  return "Annual";
    default:                                        return null;
  }
}

/** Human-readable list for error messages — derived, so it cannot drift. */
const FREQUENCY_LABELS = Object.keys(FREQUENCY_DAYS).join(", ");

export interface UpdateContactInput {
  contact_name: string;
  frequency?: string;
  tier?: number;
  social_battery_cost?: string;
  notes?: string;
  origin_story?: string;
  special_interests?: string;
  whatsapp?: string;
  email?: string;
  active?: boolean;
}

/**
 * Update a contact's editable settings: frequency/cadence, tier, social
 * battery cost, notes, WhatsApp number, or active status. Changing frequency
 * re-derives next_action from the existing last_contact under the new cadence.
 * Persists to Supabase; the gateway's sync service propagates to the markdown.
 */
export async function updateContactFields(input: UpdateContactInput): Promise<string> {
  const db = kitClient();

  // Resolve without the active filter so archived contacts can be edited too.
  const { data } = await db
    .from("contacts")
    .select("*")
    .or(`id.eq.${input.contact_name},name.ilike.%${input.contact_name}%`)
    .limit(1);

  const contact = data?.[0] as Contact | undefined;
  if (!contact) return `Contact "${input.contact_name}" not found.`;

  const dbFields: Record<string, unknown> = {};
  const changes: string[] = [];

  if (input.frequency !== undefined) {
    const freq = normaliseFrequency(input.frequency);
    if (!freq) {
      return `Invalid frequency "${input.frequency}". Use one of: ${FREQUENCY_LABELS}.`;
    }
    const freqDays = FREQUENCY_DAYS[freq] as number;
    dbFields.frequency = freq;
    dbFields.frequency_days = freqDays;
    // Re-derive the next action from the last contact date under the new cadence.
    if (contact.last_contact) {
      dbFields.next_action = new Date(
        new Date(contact.last_contact).getTime() + freqDays * 86_400_000
      )
        .toISOString()
        .slice(0, 10);
    }
    changes.push(`frequency → ${freq}`);
  }

  if (input.tier !== undefined) {
    if (![1, 2, 3].includes(input.tier)) {
      return `Invalid tier ${input.tier}. Use 1 (Inner Circle), 2 (Active), or 3 (Business).`;
    }
    dbFields.tier = input.tier;
    changes.push(`tier → ${input.tier} (${tierLabel(input.tier)})`);
  }

  if (input.social_battery_cost !== undefined) {
    dbFields.social_battery_cost = input.social_battery_cost;
    changes.push(`battery cost → ${input.social_battery_cost}`);
  }

  if (input.notes !== undefined) {
    dbFields.notes = input.notes;
    changes.push("notes updated");
  }

  if (input.origin_story !== undefined) {
    dbFields.origin_story = input.origin_story;
    changes.push("background updated");
  }

  if (input.special_interests !== undefined) {
    dbFields.special_interests = input.special_interests;
    changes.push("interests & hooks updated");
  }

  if (input.whatsapp !== undefined) {
    dbFields.whatsapp = input.whatsapp || null;
    changes.push(input.whatsapp ? `WhatsApp → ${input.whatsapp}` : "WhatsApp cleared");
  }

  if (input.email !== undefined) {
    const email = normaliseEmail(input.email);
    dbFields.email = email;
    changes.push(email ? `email → ${email}` : "email cleared");
  }

  if (input.active !== undefined) {
    dbFields.active = input.active;
    changes.push(input.active ? "reactivated" : "archived");
  }

  if (changes.length === 0) {
    return `No changes specified for ${contact.name}.`;
  }

  const { error } = await db.from("contacts").update(dbFields).eq("id", contact.id);
  if (error) throw new Error(`contacts update failed: ${error.message}`);

  // Propagate to Open Brain so its view of the contact does not drift from Kit's.
  const obResult = await _binder.captureThought({
    content: [
      `Contact record updated for ${contact.name}: ${changes.join(", ")}.`,
      input.origin_story !== undefined ? `Background: ${input.origin_story}` : "",
      input.special_interests !== undefined
        ? `Interests & hooks: ${input.special_interests}`
        : "",
      input.notes !== undefined ? `Notes: ${input.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    entity: toCanonicalName(contact.name),
    thoughtType: ThoughtType.STATUS_CHANGE,
    people: [contact.name],
    source: "kit-mcp",
  });

  const suffix = obResult.success ? "" : " (Open Brain propagation failed)";
  return `Updated ${contact.name}: ${changes.join(", ")}.${suffix}`;
}

// ── Tool: update-interaction ──────────────────────────────────────────────────

export interface UpdateInteractionInput {
  contact_name: string;
  date: string;
  notes: string;
  /** Disambiguates when several interactions share a date (1:1 plus group entries). */
  interaction_id?: string;
  /** Why the note is being corrected — recorded in the Open Brain correction. */
  reason?: string;
}

/**
 * Correct the notes on an already-logged interaction.
 *
 * Open Brain thoughts are append-only, so the original interaction thought is
 * left intact and a CORRECTION thought is appended alongside it. Without this,
 * editing interaction_log directly leaves Kit and Open Brain disagreeing — and
 * Open Brain is what feeds future prep and draft context.
 */
export async function updateInteractionNotes(
  input: UpdateInteractionInput
): Promise<string> {
  const contact = await resolveContact(input.contact_name);
  if (!contact) return `Contact "${input.contact_name}" not found.`;

  const db = kitClient();

  const { data: existing } = await db
    .from("interaction_log")
    .select("*")
    .eq("contact_id", contact.id)
    .eq("date", input.date);

  let rows = (existing ?? []) as Interaction[];
  if (rows.length === 0) {
    return `No interaction logged for ${contact.name} on ${input.date}.`;
  }

  // An explicit id settles it outright.
  if (input.interaction_id) {
    rows = rows.filter((r) => r.id === input.interaction_id);
    if (rows.length === 0) {
      return `No interaction with id ${input.interaction_id} for ${contact.name} on ${input.date}.`;
    }
  } else if (rows.length > 1) {
    // Group and 1:1 entries routinely share a date now, so a plain date match
    // is ambiguous far more often than it used to be. A correction almost
    // always means the direct conversation, so prefer it when it is the only
    // non-group candidate rather than refusing outright.
    const direct = rows.filter((r) => !(r as any).group_jid);
    if (direct.length === 1) {
      rows = direct;
    } else {
      const options = rows
        .map((r) => {
          const where = (r as any).group_name
            ? `group "${(r as any).group_name}"`
            : (r as any).group_jid
              ? `group ${(r as any).group_jid}`
              : "direct conversation";
          return `  - ${r.id} (${where}): ${(r.notes ?? "").slice(0, 80)}…`;
        })
        .join("\n");
      return (
        `${rows.length} interactions logged for ${contact.name} on ${input.date} — ` +
        `refusing to update ambiguously. Re-run with interaction_id set to one of:\n${options}`
      );
    }
  }

  const previous = rows[0].notes ?? "";

  const { error } = await db
    .from("interaction_log")
    .update({ notes: input.notes })
    .eq("id", rows[0].id);
  if (error) throw new Error(`interaction_log update failed: ${error.message}`);

  const obResult = await _binder.captureThought({
    content: [
      `Correction to the ${input.date} interaction with ${contact.name}.`,
      input.reason ? `Reason: ${input.reason}` : "",
      `Corrected record: ${input.notes}`,
      `Superseded record: ${previous}`,
    ]
      .filter(Boolean)
      .join("\n"),
    entity: toCanonicalName(contact.name),
    thoughtType: ThoughtType.STATUS_CHANGE,
    extraTopics: ["correction"],
    people: [contact.name],
    source: "kit-mcp",
  });

  const suffix = obResult.success
    ? " Correction appended to Open Brain."
    : " WARNING: Open Brain propagation failed — the two stores now disagree.";
  return `Updated the ${input.date} interaction for ${contact.name}.${suffix}`;
}

// ── Tool: kit-pending-captures ────────────────────────────────────────────────

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

// ── Tool: kit-confirm-capture ─────────────────────────────────────────────────

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

// ── Tool: kit-dismiss-capture ─────────────────────────────────────────────────

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
