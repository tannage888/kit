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

    // Daemon response shape: { messages: [{ id, timestamp(ISO), fromMe, body, ... }] }
    // Map into the gateway's WhatsAppMessage shape (epoch-ms timestamp, messageId, remoteJid).
    type RawMessage = {
      id?: string;
      messageId?: string;
      timestamp: string | number;
      fromMe: boolean;
      body: string;
      remoteJid?: string;
    };
    const body = (await res.json()) as { messages?: RawMessage[] };
    const raw = body.messages ?? [];

    // Dedup by messageId (daemon store occasionally returns duplicates)
    const byId = new Map<string, WhatsAppMessage>();
    for (const m of raw) {
      const ts = typeof m.timestamp === "number" ? m.timestamp : Date.parse(m.timestamp);
      if (!Number.isFinite(ts)) continue;
      const id = m.messageId ?? m.id ?? "";
      if (!byId.has(id)) {
        byId.set(id, {
          remoteJid: m.remoteJid ?? jid,
          fromMe: m.fromMe,
          body: m.body,
          timestamp: ts,
          messageId: id,
        });
      }
    }
    const allMessages = [...byId.values()];

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
   *
   * Split into blocks by silence gaps longer than gapMs. A block with fewer
   * than MIN_THREAD_MESSAGES messages (an "orphan") is absorbed into the
   * next block to avoid dropping outbound messages whose reply comes days
   * later. A trailing orphan (no following block) is still emitted so the
   * interaction is captured — otherwise single outbound messages would be
   * lost until a reply landed within the gap window.
   */
  private groupIntoThreads(
    contact: TrackedContact,
    messages: WhatsAppMessage[]
  ): ConversationThread[] {
    if (messages.length === 0) return [];

    // 1. Split into gap-separated blocks
    const blocks: WhatsAppMessage[][] = [[messages[0]]];
    for (let i = 1; i < messages.length; i++) {
      const gap = messages[i].timestamp - messages[i - 1].timestamp;
      if (gap > this.gapMs) {
        blocks.push([messages[i]]);
      } else {
        blocks[blocks.length - 1].push(messages[i]);
      }
    }

    // 2. Absorb orphan blocks (<MIN_THREAD_MESSAGES) into the next block.
    //    Any trailing orphan is still emitted as its own thread.
    const threads: ConversationThread[] = [];
    let pending: WhatsAppMessage[] = [];
    for (const block of blocks) {
      const combined = pending.length > 0 ? [...pending, ...block] : block;
      pending = [];
      if (combined.length >= MIN_THREAD_MESSAGES) {
        threads.push(this.buildThread(contact, combined));
      } else {
        pending = combined;
      }
    }
    if (pending.length > 0) {
      threads.push(this.buildThread(contact, pending));
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
      channel: "whatsapp",
    };
  }
}
