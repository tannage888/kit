/**
 * Import Ingestor — Phase 11
 *
 * Bridges the WhatsApp daemon's ZIP-export importer into Kit's existing
 * capture pipeline. When the daemon finishes ingesting a self-sent
 * "Export Chat" ZIP, it pings POST /api/zip-import-complete on Kit;
 * this service then pulls the new messages from the daemon and routes
 * them through MessageRouter so the user gets a normal /kit-captures
 * review card.
 *
 * Pull (not push): the daemon already exposes
 * GET /api/chats/:jid/messages?mode=since_last_review with a watermark
 * we ack on completion — same channel as the live sweep.
 */

import type { ContactRegistry } from "./contacts.js";
import type { MessageRouter } from "./message-router.js";

interface DaemonTranscriptMessage {
  id: string;
  timestamp: string; // ISO
  fromMe: boolean;
  body: string;
}

interface DaemonTranscript {
  messages: DaemonTranscriptMessage[];
  watermark: { previous: string | null; new: string };
}

export type IngestResult =
  | { status: "ok"; ingested: number; captureQueued: boolean }
  | {
      status: "skipped";
      reason: "unknown_contact" | "capture_disabled" | "empty_transcript";
    };

type FetchFn = typeof fetch;

export class ImportIngestor {
  constructor(
    private readonly contacts: ContactRegistry,
    private readonly router: MessageRouter,
    private readonly daemonUrl: string,
    private readonly fetchFn: FetchFn = fetch
  ) {}

  async ingest(chatJid: string): Promise<IngestResult> {
    const contact = this.contacts.getByJid(chatJid);
    if (!contact) return { status: "skipped", reason: "unknown_contact" };
    if (contact.whatsapp_capture === "disabled") {
      return { status: "skipped", reason: "capture_disabled" };
    }

    const transcript = await this.fetchTranscript(chatJid);

    if (transcript.messages.length === 0) {
      return { status: "skipped", reason: "empty_transcript" };
    }

    for (const m of transcript.messages) {
      this.router.handleMessage({
        remoteJid: chatJid,
        fromMe: m.fromMe,
        body: m.body,
        timestamp: Date.parse(m.timestamp),
        messageId: m.id,
      });
    }

    // Drain whatever was buffered straight away — a ZIP export is by
    // definition complete, so we don't wait for the inactivity timer.
    // triggerCapture returns false silently when wa_capture: "off"
    // (handleMessage dropped everything; nothing to drain).
    const captureQueued = await this.router.triggerCapture(contact.id, {
      source: "zip-import",
    });

    await this.ackWatermark(chatJid, transcript.watermark.new);

    return {
      status: "ok",
      ingested: transcript.messages.length,
      captureQueued,
    };
  }

  private async fetchTranscript(chatJid: string): Promise<DaemonTranscript> {
    const url = `${this.daemonUrl}/api/chats/${encodeURIComponent(chatJid)}/messages?mode=since_last_review`;
    const res = await this.fetchFn(url);
    if (!res.ok) {
      throw new Error(
        `Daemon transcript fetch failed for ${chatJid}: ${res.status} ${res.statusText}`
      );
    }
    return (await res.json()) as DaemonTranscript;
  }

  private async ackWatermark(chatJid: string, watermark: string): Promise<void> {
    const url = `${this.daemonUrl}/api/chats/${encodeURIComponent(chatJid)}/ack`;
    try {
      await this.fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watermark }),
      });
    } catch (err) {
      console.warn(
        `⚠️  Failed to ack daemon watermark for ${chatJid}:`,
        (err as Error).message
      );
    }
  }
}
