/**
 * Message Router
 *
 * Sits between the WhatsApp connection and the capture pipeline.
 * For every incoming/outgoing message:
 *   1. Check if the remote party is a tracked contact
 *   2. Check the contact's wa_capture setting
 *   3. If capture != "off", buffer the message into the active thread
 *   4. Reset the inactivity timer for that thread
 *   5. When the timer fires, hand the thread to the capture pipeline
 *
 * Reference: Kit Requirements Spec §6.3, FR-13
 */

import { config } from "../config.js";
import { ContactRegistry } from "./contacts.js";
import { CapturePipeline, type CaptureOptions } from "./capture.js";
import type { WhatsAppMessage, Message, ConversationThread, TrackedContact, Channel } from "../types.js";

export class MessageRouter {
  /**
   * Thread key → active conversation thread being buffered.
   * WhatsApp threads use the JID as key; other channels use "{channel}:{contactId}".
   */
  private threads: Map<string, ConversationThread> = new Map();
  /** Thread key → inactivity timeout handle */
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private readonly inactivityMs: number;

  constructor(
    private contacts: ContactRegistry,
    private capture: CapturePipeline
  ) {
    this.inactivityMs = config.CAPTURE_INACTIVITY_MINUTES * 60 * 1000;
  }

  /**
   * Route an incoming or outgoing WhatsApp message.
   * Called by the WhatsApp daemon push endpoint.
   */
  handleMessage(msg: WhatsAppMessage): void {
    const contact = this.contacts.getByJid(msg.remoteJid);
    if (!contact) return;
    if (contact.whatsapp_capture === "disabled") return;
    if (contact.wa_capture === "off") return;

    this.bufferMessage(msg.remoteJid, msg, contact, "whatsapp");

    if (contact.wa_capture === "auto") {
      this.resetInactivityTimer(msg.remoteJid);
    }
  }

  /**
   * Route messages from a non-WhatsApp channel (LinkedIn, Instagram).
   * Called by POST /api/channels/incoming from the social daemons.
   * Messages are immediately buffered and an inactivity timer is set
   * (all social channel contacts are treated as "auto" capture).
   */
  handleChannelMessages(contactId: string, channel: Channel, messages: Message[]): boolean {
    const contact = this.contacts.getById(contactId);
    if (!contact) return false;

    const captureField = channel === "linkedin" ? "linkedin_capture" : "instagram_capture";
    if (contact[captureField] === "disabled") return false;

    if (messages.length === 0) return true;

    const key = `${channel}:${contactId}`;
    for (const msg of messages) {
      this.bufferMessage(key, msg, contact, channel);
    }
    this.resetInactivityTimer(key);
    return true;
  }

  /**
   * Manually trigger capture for a contact's current WhatsApp thread.
   * Used for on-demand capture. Works regardless of wa_capture setting.
   */
  async triggerCapture(
    contactId: string,
    opts: CaptureOptions = {}
  ): Promise<boolean> {
    const contact = this.contacts.getById(contactId);
    if (!contact) return false;

    const key = this.whatsappKey(contact);
    const thread = this.threads.get(key);
    if (!thread || thread.messages.length === 0) return false;

    this.clearTimer(key);
    await this.capture.process(thread, opts);
    this.threads.delete(key);
    return true;
  }

  /**
   * Trigger capture for a single WhatsApp message (per-message on-demand capture).
   */
  async captureSingleMessage(contactId: string, messageId: string): Promise<boolean> {
    const contact = this.contacts.getById(contactId);
    if (!contact) return false;

    const key = this.whatsappKey(contact);
    const thread = this.threads.get(key);
    if (!thread) return false;

    const message = thread.messages.find((m) => m.messageId === messageId);
    if (!message) return false;

    const singleThread: ConversationThread = {
      contact,
      messages: [message],
      startedAt: message.timestamp,
      lastActivityAt: message.timestamp,
      channel: "whatsapp",
    };

    await this.capture.process(singleThread);
    return true;
  }

  /** Number of active threads being buffered */
  get activeThreadCount(): number {
    return this.threads.size;
  }

  /** Number of threads with pending auto-capture timers */
  get pendingCaptureCount(): number {
    return this.timers.size;
  }

  /** Clean up all timers on shutdown */
  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.threads.clear();
  }

  // ── Private helpers ──────────────────────────────────────

  private bufferMessage(key: string, msg: Message, contact: TrackedContact, channel: Channel): void {
    const existing = this.threads.get(key);
    if (existing) {
      existing.messages.push(msg);
      existing.lastActivityAt = msg.timestamp;
    } else {
      this.threads.set(key, {
        contact,
        messages: [msg],
        startedAt: msg.timestamp,
        lastActivityAt: msg.timestamp,
        channel,
      });
    }
  }

  private resetInactivityTimer(key: string): void {
    this.clearTimer(key);

    const timer = setTimeout(async () => {
      this.timers.delete(key);

      const thread = this.threads.get(key);
      if (!thread || thread.messages.length === 0) return;

      console.log(
        `⏱️  Inactivity timeout for ${thread.contact.name} (${thread.channel}) — triggering capture (${thread.messages.length} messages)`
      );

      try {
        await this.capture.process(thread);
      } catch (err) {
        console.error(`❌ Capture failed for ${thread.contact.name}:`, err);
        return;
      }

      this.threads.delete(key);
    }, this.inactivityMs);

    this.timers.set(key, timer);
  }

  private clearTimer(key: string): void {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(key);
    }
  }

  private whatsappKey(contact: TrackedContact): string {
    if (!contact.whatsapp) throw new Error(`Contact ${contact.name} has no WhatsApp number`);
    return `${contact.whatsapp.replace(/^\+/, "").replace(/\s+/g, "")}@s.whatsapp.net`;
  }
}
