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
  async processAndCommit(thread: ConversationThread): Promise<CaptureResult> {
    console.log(
      `🧠 Summarising ${thread.messages.length} messages with ${thread.contact.name}...`
    );

    const result = await this.summarise(thread);
    await this.commit(thread.contact.id, result);

    console.log(`✅ Sweep capture committed for ${result.contactName}.`);
    return result;
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
    const { error: logError } = await this.kit.schema("kit").from("interaction_log").insert({
      id: crypto.randomUUID(),
      contact_id: contactId,
      date: result.date,
      channel: result.channel,
      notes: result.topics,
    });

    if (logError) {
      console.error(`❌ Failed to write interaction_log for ${result.contactName}:`, logError.message);
      throw logError;
    }

    // 2. Update contacts.last_contact and next_action in Supabase
    await this.contacts.updateLastContact(contactId, result.date);

    // 3. Write to Open Brain via ContextBinder
    const entity = toCanonicalName(result.contactName);
    const channelLabel = channelDisplayName(result.channel);
    const thoughtContent = [
      `${channelLabel} conversation with ${result.contactName} on ${result.date}.`,
      result.topics,
    ].join("\n");

    await this.binder.captureThought({
      content: thoughtContent,
      entity,
      thoughtType: ThoughtType.INTERACTION,
      extraTopics: [result.channel, result.sentiment],
      people: [result.contactName],
      source: "kit-gateway",
    });

    // 4. Write follow-ups as NEXT_ACTION thoughts
    if (result.followUps.trim()) {
      await this.binder.captureThought({
        content: `Follow-up with ${result.contactName}: ${result.followUps}`,
        entity,
        thoughtType: ThoughtType.NEXT_ACTION,
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
        const who = m.fromMe ? "Me" : thread.contact.name;
        const time = new Date(m.timestamp).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `[${time}] ${who}: ${m.body}`;
      })
      .join("\n");

    const channelLabel = channelDisplayName(thread.channel);
    const response = await this.anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `You are a conversation summariser for Kit, a personal relationship management app.
You will be given a ${channelLabel} conversation transcript between the user and one of their contacts.

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
    };
  }
}
