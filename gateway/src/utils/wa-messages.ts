/**
 * WhatsApp message helpers
 *
 * Shared by the sweep pipeline (which summarises history) and the
 * conversation endpoint (which returns the raw transcript). Both talk to
 * the same daemon endpoint and have to cope with the same quirks:
 * timestamps arriving as ISO strings or epoch ms, an id under either
 * `messageId` or `id`, and the occasional duplicate from the daemon store.
 */

import type { WhatsAppMessage } from "../types.js";

/** Shape the daemon returns from GET /api/chats/:jid/messages */
export interface RawDaemonMessage {
  id?: string;
  messageId?: string;
  timestamp: string | number;
  fromMe: boolean;
  body: string;
  remoteJid?: string;
  sender?: { jid?: string | null; displayName?: string | null };
}

/**
 * Build a 1:1 chat JID from a stored WhatsApp number.
 * Numbers are stored in E.164 and may carry spaces ("+44 7931 460 181").
 */
export function toJid(whatsapp: string): string {
  const digits = whatsapp.replace(/^\+/, "").replace(/\s+/g, "");
  return `${digits}@s.whatsapp.net`;
}

/**
 * Normalise a daemon message array: drop unparseable timestamps, dedup by
 * message id (first occurrence wins), and sort oldest-first.
 */
export function normaliseMessages(
  raw: RawDaemonMessage[],
  fallbackJid: string
): WhatsAppMessage[] {
  const byId = new Map<string, WhatsAppMessage>();

  for (const m of raw) {
    const ts = typeof m.timestamp === "number" ? m.timestamp : Date.parse(m.timestamp);
    if (!Number.isFinite(ts)) continue;
    const id = m.messageId ?? m.id ?? "";
    if (byId.has(id)) continue;
    byId.set(id, {
      remoteJid: m.remoteJid ?? fallbackJid,
      fromMe: m.fromMe,
      body: m.body,
      timestamp: ts,
      messageId: id,
      senderJid: m.sender?.jid ?? undefined,
    });
  }

  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}
