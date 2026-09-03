/**
 * Conversation Capture Pipeline
 *
 * Implements FR-13 from the Kit Requirements Spec:
 *   1. Receive an assembled conversation thread
 *   2. Send to Claude for summarisation
 *   3. Parse the structured result (topics, follow-ups, sentiment)
 *   4. Either:
 *      a. Queue for user review (process) — used by the live message router
 *      b. Write immediately (processAndCommit) — used by the sweep scheduler
 *   5. On write: interaction_log row + Open Brain thought + contacts update
 *
 * "Capture review card is always shown before anything is written —
 *  no silent storage." (Spec §6.3 Privacy Controls)
 *  Exception: scheduled sweep runs use processAndCommit() which writes
 *  directly, as the user has opted into automated capture for this path.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { ContextBinder, toCanonicalName, ThoughtType } from "../context-binding/index.js";
import { ContactRegistry } from "./contacts.js";
import type {
  ConversationThread,
  Message,
  CaptureResult,
  Channel,
  Sentiment,
} from "../types.js";

function channelDisplayName(channel: Channel): string {
  switch (channel) {
    case "whatsapp":  return "WhatsApp";
    case "linkedin":  return "LinkedIn";
    case "instagram": return "Instagram";
    case "call":      return "Phone call";
    case "in-person": return "In-person";
    case "email":     return "Email";
    default:          return channel;
  }
}

/** Label used for anyone in a group who is not the user or the tracked contact. */
export const OTHER_PARTICIPANT_LABEL = "Another participant";

/**
 * Who to attribute a message to in the transcript handed to Claude.
 *
 * In a 1:1 thread every inbound message is the contact's. In a group it is
 * not: attributing everything to the tracked contact both corrupts the
 * summary and puts other people's words in that contact's record. Anyone
 * who isn't the user or the tracked contact is anonymised, so no third
 * party can be named in what gets stored.
 */
export function speakerLabel(m: Message, thread: ConversationThread): string {
  if (m.fromMe) return "Me";
  if (!thread.groupJid) return thread.contact.name;
  return isFromContact(m, thread.contact.whatsapp) ? thread.contact.name : OTHER_PARTICIPANT_LABEL;
}

/** Did this message come from the given number? Compares digits only, as
 *  stored numbers carry spaces and a "+" while JIDs do not. */
function isFromContact(m: Message, whatsapp: string | null): boolean {
  const senderDigits = (m.senderJid ?? "").replace(/\D/g, "");
  const contactDigits = (whatsapp ?? "").replace(/\D/g, "");
  return Boolean(senderDigits && contactDigits && senderDigits === contactDigits);
}

/**
 * Did the tracked contact actually say anything in this group thread?
 *
 * Groups are swept per contact, so a busy group produces a thread for each
 * member being tracked — including ones who never spoke. Summarising those
 * writes a log entry that says nothing about the person whose file it lands in.
 */
export function contactParticipated(thread: ConversationThread): boolean {
  if (!thread.groupJid) return true;
  return thread.messages.some((m) => !m.fromMe && isFromContact(m, thread.contact.whatsapp));
}

/**
 * The Open Brain thought text for a capture.
 *
 * Group captures are labelled explicitly. Open Brain is append-only and feeds
 * prep, draft and reconnect context, so an unmarked group thought reads as a
 * direct conversation with the contact for as long as the record exists.
 */
export function buildInteractionThought(result: CaptureResult): string {
  const channelLabel = channelDisplayName(result.channel);
  const groupLabel = result.groupName ?? result.groupJid;
  const opening = result.groupJid
    ? `${channelLabel} group conversation in "${groupLabel}" involving ${result.contactName} on ${result.date}. ` +
      `Group chat, not a direct conversation — other participants are unnamed.`
    : `${channelLabel} conversation with ${result.contactName} on ${result.date}.`;
  return [opening, result.topics].join("\n");
}

export interface CaptureOptions {
  /** Marks the capture's origin so review-card text can flag it. */
  source?: "zip-import";
}

export class CapturePipeline {
  private anthropic: Anthropic;
  private kit: SupabaseClient;
  private binder: ContextBinder;

  /**
   * Captures waiting for user review before being written.
   * Key = contact ID, value = the capture result.
   * The REST API exposes these for the Kit mobile app to show review cards.
   */
  private pendingReviews: Map<string, CaptureResult> = new Map();

  constructor(private contacts: ContactRegistry) {
    this.anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    this.kit = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
    // Open Brain is optional in config but required here — the pipeline's
    // whole job is writing captures to it. Fail with a readable message
    // rather than the Supabase client's opaque "supabaseUrl is required".
    if (!config.OPEN_BRAIN_URL || !config.OPEN_BRAIN_SERVICE_KEY) {
      throw new Error(
        "CapturePipeline requires OPEN_BRAIN_URL and OPEN_BRAIN_SERVICE_KEY to be set."
      );
    }
    this.binder = new ContextBinder({
      supabaseUrl: config.OPEN_BRAIN_URL,
      supabaseKey: config.OPEN_BRAIN_SERVICE_KEY,
    });
  }

  /**
   * Process a conversation thread — summarise and queue for user review.
   * Nothing is written until the user calls confirm().
   * Used by the live message router (FR-13 auto/on-demand capture).
   */
  async process(
    thread: ConversationThread,
    opts: CaptureOptions = {}
  ): Promise<CaptureResult> {
    console.log(
      `🧠 Summarising ${thread.messages.length} messages with ${thread.contact.name}...`
    );

    const result = await this.summarise(thread, opts);

    // Queue for user review — nothing is stored until confirmed
    this.pendingReviews.set(thread.contact.id, result);

    console.log(
      `📋 Capture ready for review: ${thread.contact.name} — ${result.topics.substring(0, 60)}...`
    );

    return result;
  }

  /**
   * Process and immediately commit — summarise and write without queuing.
   * Used by the sweep scheduler where the user has opted into automation.
   */
  async processAndCommit(thread: ConversationThread): Promise<CaptureResult | null> {
    const fresh = await this.withoutAlreadyLogged(thread);
    if (!fresh) {
      console.log(
        `  ⏩ ${thread.contact.name} — every message in this thread is already logged.`
      );
      return null;
    }

    console.log(
      `🧠 Summarising ${fresh.messages.length} messages with ${fresh.contact.name}...`
    );

    const result = await this.summarise(fresh);
    await this.commit(fresh.contact.id, result);

    console.log(`✅ Sweep capture committed for ${result.contactName}.`);
    return result;
  }

  /**
   * The thread with any messages Kit has already logged itself removed, or
   * null if that leaves nothing to summarise.
   *
   * send-message writes its own interaction the moment a message leaves,
   * recording the WhatsApp message id. The sweep then reads that same message
   * back and, knowing nothing about it, summarises it as a second interaction —
   * so every message sent through Kit was landing in the log twice.
   *
   * Already-logged messages are dropped rather than kept as context for the
   * ones around them: the send row holds the message verbatim, so nothing is
   * lost from the record as a whole, and dropping them is what guarantees a
   * message is never counted twice.
   *
   * Fails open. A capture that cannot check is better than a capture that
   * does not happen, and this runs against databases where the wa_message_id
   * migration has not been applied yet.
   */
  private async withoutAlreadyLogged(
    thread: ConversationThread
  ): Promise<ConversationThread | null> {
    const ids = thread.messages.map((m) => m.messageId).filter(Boolean);
    if (ids.length === 0) return thread;

    const { data, error } = await this.kit
      .schema("kit")
      .from("interaction_log")
      .select("wa_message_id")
      .eq("contact_id", thread.contact.id)
      .in("wa_message_id", ids);

    if (error) {
      console.warn(
        `  ⚠️  Could not check for already-logged messages (${thread.contact.name}): ${error.message}`
      );
      return thread;
    }

    const logged = new Set((data ?? []).map((r: { wa_message_id: string }) => r.wa_message_id));
    if (logged.size === 0) return thread;

    const messages = thread.messages.filter((m) => !logged.has(m.messageId));
    if (messages.length === 0) return null;

    // startedAt drives the interaction's date, so it has to follow the
    // messages that actually survived. The caller keeps the original thread,
    // and with it the sweep watermark covering everything that was read.
    return {
      ...thread,
      messages,
      startedAt: messages[0].timestamp,
      lastActivityAt: messages[messages.length - 1].timestamp,
    };
  }

  /**
   * User confirms the capture — write to storage and update contact.
   */
  async confirm(contactId: string): Promise<boolean> {
    const result = this.pendingReviews.get(contactId);
    if (!result) return false;

    await this.commit(contactId, result);

    this.pendingReviews.delete(contactId);
    console.log(`✅ Capture confirmed and stored for ${result.contactName}.`);
    return true;
  }

  /**
   * User dismisses the capture — discard without storing.
   */
  dismiss(contactId: string): boolean {
    return this.pendingReviews.delete(contactId);
  }

  /** Get a pending review for display in the Kit app */
  getPendingReview(contactId: string): CaptureResult | undefined {
    return this.pendingReviews.get(contactId);
  }

  /** All pending reviews */
  getAllPendingReviews(): Array<{ contactId: string; result: CaptureResult }> {
    return Array.from(this.pendingReviews.entries()).map(([contactId, result]) => ({
      contactId,
      result,
    }));
  }

  /** Count of captures waiting for review */
  get pendingCount(): number {
    return this.pendingReviews.size;
  }

  // ── Private: commit ──────────────────────────────────────

  /**
   * Write a capture result to all storage targets:
   *   1. interaction_log row in Kit Supabase
   *   2. contacts.last_contact + next_action update
   *   3. Open Brain thought via ContextBinder
   *   4. Follow-up thought if follow-ups were captured
   */
  private async commit(contactId: string, result: CaptureResult): Promise<void> {
    // 1. Write to interaction_log
    // Only send the group columns for a group capture. A 1:1 capture then
    // keeps working against a database where the migration adding them has
    // not been run yet, rather than failing on an unknown column.
    const { error: logError } = await this.kit.schema("kit").from("interaction_log").insert({
      id: crypto.randomUUID(),
      contact_id: contactId,
      date: result.date,
      channel: result.channel,
      notes: result.topics,
      ...(result.groupJid
        ? { group_jid: result.groupJid, group_name: result.groupName ?? null }
        : {}),
    });

    if (logError) {
      console.error(`❌ Failed to write interaction_log for ${result.contactName}:`, logError.message);
      throw logError;
    }

    // 2. Update contacts.last_contact and next_action in Supabase.
    //    Group activity is deliberately excluded: seeing someone's name in a
    //    group is not contact with them, and letting it move the date would
    //    push their next catch-up out and corrupt the check-in queue.
    if (!result.groupJid) {
      await this.contacts.updateLastContact(contactId, result.date);
    }

    // 3. Write to Open Brain via ContextBinder.
    //    Group captures are labelled as such. Open Brain thoughts are
    //    append-only and feed prep, draft and reconnect context, so an
    //    unmarked group thought would read as a direct conversation with the
    //    contact for as long as the record exists.
    const entity = toCanonicalName(result.contactName);
    const groupLabel = result.groupName ?? result.groupJid;
    const thoughtContent = buildInteractionThought(result);

    await this.binder.captureThought({
      content: thoughtContent,
      entity,
      thoughtType: ThoughtType.INTERACTION,
      extraTopics: [
        result.channel,
        result.sentiment,
        ...(result.groupJid ? ["group"] : []),
      ],
      people: [result.contactName],
      source: "kit-gateway",
    });

    // 4. Write follow-ups as NEXT_ACTION thoughts
    if (result.followUps.trim()) {
      await this.binder.captureThought({
        content: result.groupJid
          ? `Follow-up with ${result.contactName} (from the "${groupLabel}" group chat): ${result.followUps}`
          : `Follow-up with ${result.contactName}: ${result.followUps}`,
        entity,
        thoughtType: ThoughtType.NEXT_ACTION,
        extraTopics: result.groupJid ? ["group"] : undefined,
        people: [result.contactName],
        source: "kit-gateway",
      });
    }
  }

  // ── Private: Claude summarisation ───────────────────────

  private async summarise(
    thread: ConversationThread,
    opts: CaptureOptions = {}
  ): Promise<CaptureResult> {
    const transcript = thread.messages
      .map((m) => {
        const who = speakerLabel(m, thread);
        const time = new Date(m.timestamp).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `[${time}] ${who}: ${m.body}`;
      })
      .join("\n");

    const channelLabel = channelDisplayName(thread.channel);

    // A group thread contains people who never opted into Kit. The summary is
    // what gets stored, so the rule is enforced here as well as in the
    // transcript labelling — the label stops names reaching Claude, this stops
    // Claude describing whoever is left.
    const groupRules = thread.groupJid
      ? `
This is a GROUP conversation. Only the user ("Me") and ${thread.contact.name} may be
named or described. Everyone else appears as "${OTHER_PARTICIPANT_LABEL}" — never
name them, never infer who they are, and never describe them individually. Use
their messages only as context for what ${thread.contact.name} said or agreed to.
Summarise the conversation as it concerns ${thread.contact.name}; if they said
nothing of substance, say so briefly rather than summarising the wider group.
`
      : "";

    const response = await this.anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `You are a conversation summariser for Kit, a personal relationship management app.
You will be given a ${channelLabel} conversation transcript between the user and one of their contacts.
${groupRules}
Produce a JSON object with exactly these fields:
- "topics": a concise summary of what was discussed (2-3 sentences max)
- "follow_ups": any action items, promises made, or things to remember for next time (empty string if none)
- "sentiment": one of "positive", "neutral", or "draining" — how the conversation likely felt for the user

Be warm but concise. Focus on facts that would help the user prepare for their next conversation with this person.
Do NOT include any text outside the JSON object.`,
      messages: [
        {
          role: "user",
          content: `Contact: ${thread.contact.name} (Tier ${thread.contact.tier})
Date: ${new Date(thread.startedAt).toISOString().split("T")[0]}

Transcript:
${transcript}`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    let parsed: { topics: string; follow_ups: string; sentiment: string };
    // Claude sometimes wraps JSON in ```json … ``` fences; strip them first.
    const jsonText = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = {
        topics: text.substring(0, 500),
        follow_ups: "",
        sentiment: "neutral",
      };
    }

    const sentiment = (["positive", "neutral", "draining"].includes(parsed.sentiment)
      ? parsed.sentiment
      : "neutral") as Sentiment;

    const summaryPrefix =
      opts.source === "zip-import"
        ? `Imported WhatsApp transcript with ${thread.contact.name}`
        : `Spoke with ${thread.contact.name} about`;

    return {
      contactName: thread.contact.name,
      date: new Date(thread.startedAt).toISOString().split("T")[0],
      topics: parsed.topics,
      followUps: parsed.follow_ups,
      sentiment,
      channel: thread.channel,
      summary: `${summaryPrefix}: ${parsed.topics}`,
      groupJid: thread.groupJid,
      groupName: thread.groupName,
    };
  }
}
