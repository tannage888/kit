/**
 * WhatsApp History Fetcher
 *
 * Fetches past conversation messages for a contact from the dedicated
 * claude_whatsapp_integration daemon via REST. Called by the SweepScheduler
 * on each periodic run.
 *
 * Design constraints:
 * - Requests messages from the daemon since a watermark timestamp
 * - Applies a hard cap on messages per contact to bound memory usage
 * - Groups messages into ConversationThreads by silence gaps (default 8h)
 * - Only returns threads with ≥ 2 messages (single messages usually have
 *   nothing worth summarising)
 */

import { config } from "../config.js";
import type { ConversationThread, TrackedContact, WhatsAppMessage } from "../types.js";

const MIN_THREAD_MESSAGES = 2;

export class HistoryFetcher {
  private readonly maxMessages: number;
  private readonly gapMs: number;

  constructor(private gatewayUrl: string) {
    this.maxMessages = config.SWEEP_MAX_MESSAGES_PER_CONTACT;
    this.gapMs = config.SWEEP_CONVERSATION_GAP_HOURS * 60 * 60 * 1000;
  }

  /**
   * Return conversation threads for a contact since the given epoch-ms watermark.
   * Fetches from the external WhatsApp daemon via REST.
   *
   * @param jid      WhatsApp JID (e.g. "447700900123@s.whatsapp.net")
   * @param contact  The tracked contact (used to populate thread metadata)
   * @param sinceMs  Epoch ms — only messages newer than this are returned
   */
  async fetchSince(
    jid: string,
    contact: TrackedContact,
    sinceMs: number
  ): Promise<ConversationThread[]> {
    const from = new Date(sinceMs).toISOString();
    const url = `${this.gatewayUrl}/api/chats/${encodeURIComponent(jid)}/messages?from=${encodeURIComponent(from)}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`WhatsApp daemon returned HTTP ${res.status} for JID ${jid}`);
    }

    const body = (await res.json()) as { messages?: WhatsAppMessage[] };
    const allMessages = body.messages ?? [];

    // Client-side watermark filter as a safety net
    const messages = allMessages.filter((m) => m.timestamp > sinceMs);

    if (messages.length === 0) return [];

    // Apply per-contact message cap
    const capped = messages.slice(0, this.maxMessages);
    if (capped.length < messages.length) {
      console.warn(
        `⚠️  Hit max message cap (${this.maxMessages}) for ${contact.name} — some history may be omitted`
      );
    }

    capped.sort((a, b) => a.timestamp - b.timestamp);
    return this.groupIntoThreads(contact, capped);
  }

  // ── Private helpers ──────────────────────────────────────

  /**
   * Group a chronologically-sorted message array into conversation threads.
   * A new thread starts whenever there's a silence gap longer than gapMs.
   * Threads with fewer than MIN_THREAD_MESSAGES messages are discarded.
   */
  private groupIntoThreads(
    contact: TrackedContact,
    messages: WhatsAppMessage[]
  ): ConversationThread[] {
    if (messages.length === 0) return [];

    const threads: ConversationThread[] = [];
    let current: WhatsAppMessage[] = [messages[0]];

    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1];
      const msg = messages[i];
      const gap = msg.timestamp - prev.timestamp;

      if (gap > this.gapMs) {
        if (current.length >= MIN_THREAD_MESSAGES) {
          threads.push(this.buildThread(contact, current));
        }
        current = [msg];
      } else {
        current.push(msg);
      }
    }

    if (current.length >= MIN_THREAD_MESSAGES) {
      threads.push(this.buildThread(contact, current));
    }

    return threads;
  }

  private buildThread(
    contact: TrackedContact,
    messages: WhatsAppMessage[]
  ): ConversationThread {
    return {
      contact,
      messages,
      startedAt: messages[0].timestamp,
      lastActivityAt: messages[messages.length - 1].timestamp,
    };
  }
}
