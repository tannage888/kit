/**
 * WhatsApp History Fetcher
 *
 * Fetches past conversation messages for a contact using the Baileys
 * loadMessages API. Called by the SweepScheduler on each periodic run.
 *
 * Design constraints:
 * - Paginates backward in batches of 50 until all messages older than
 *   the watermark (sinceMs) are encountered, or the hard cap is hit
 * - Groups messages into ConversationThreads by silence gaps (default 8h)
 * - Only returns threads with ≥ 2 messages (single messages are usually
 *   a ping and have nothing to summarise)
 * - Skips media-only messages without a text body (same rule as the
 *   live message parser in whatsapp.ts)
 */

import type { proto } from "@whiskeysockets/baileys";
import { config } from "../config.js";
import type { ConversationThread, TrackedContact, WhatsAppMessage } from "../types.js";

const MIN_THREAD_MESSAGES = 2;

export class HistoryFetcher {
  private readonly maxMessages: number;
  private readonly gapMs: number;

  /**
   * @param wa  Anything that exposes getStoredMessages — in practice
   *            WhatsAppConnection, but typed narrowly to keep tests simple.
   */
  constructor(private wa: { getStoredMessages: (jid: string) => proto.IWebMessageInfo[] }) {
    this.maxMessages = config.SWEEP_MAX_MESSAGES_PER_CONTACT;
    this.gapMs = config.SWEEP_CONVERSATION_GAP_HOURS * 60 * 60 * 1000;
  }

  /**
   * Return conversation threads for a contact since the given epoch-ms watermark.
   * Reads from the in-process message buffer populated by WhatsAppConnection.
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
    const raw = this.wa.getStoredMessages(jid);

    const messages: WhatsAppMessage[] = [];
    for (const msg of raw) {
      const parsed = this.parseMessage(msg, jid);
      if (!parsed || parsed.timestamp <= sinceMs) continue;

      messages.push(parsed);

      if (messages.length >= this.maxMessages) {
        console.warn(
          `⚠️  Hit max message cap (${this.maxMessages}) for ${contact.name} — some history may be omitted`
        );
        break;
      }
    }

    if (messages.length === 0) return [];

    messages.sort((a, b) => a.timestamp - b.timestamp);
    return this.groupIntoThreads(contact, messages);
  }

  // ── Private helpers ──────────────────────────────────────

  /**
   * Parse a raw Baileys message into our WhatsAppMessage type.
   * Returns null for group messages, media-only, or system messages.
   */
  private parseMessage(
    raw: proto.IWebMessageInfo,
    expectedJid: string
  ): WhatsAppMessage | null {
    const remoteJid = raw.key?.remoteJid;

    // Ignore group messages and messages not from this chat
    if (!remoteJid || remoteJid.endsWith("@g.us")) return null;
    if (remoteJid !== expectedJid) return null;

    // Extract text body
    const body =
      raw.message?.conversation ||
      raw.message?.extendedTextMessage?.text ||
      raw.message?.imageMessage?.caption ||
      raw.message?.videoMessage?.caption ||
      null;

    if (!body) return null; // media-only

    const ts = raw.messageTimestamp;
    const timestamp = typeof ts === "number"
      ? ts * 1000
      : typeof ts === "object" && ts !== null
        ? Number(ts) * 1000
        : 0;

    if (!timestamp) return null;

    return {
      remoteJid,
      fromMe: raw.key?.fromMe ?? false,
      body,
      timestamp,
      messageId: raw.key?.id ?? "",
    };
  }

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
        // Silence gap — close the current thread and start a new one
        if (current.length >= MIN_THREAD_MESSAGES) {
          threads.push(this.buildThread(contact, current));
        }
        current = [msg];
      } else {
        current.push(msg);
      }
    }

    // Close the final thread
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
