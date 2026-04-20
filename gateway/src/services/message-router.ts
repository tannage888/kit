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
import { CapturePipeline } from "./capture.js";
import type { WhatsAppMessage, ConversationThread, TrackedContact } from "../types.js";

export class MessageRouter {
  /** JID → active conversation thread being buffered */
  private threads: Map<string, ConversationThread> = new Map();
  /** JID → inactivity timeout handle */
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private readonly inactivityMs: number;

  constructor(
    private contacts: ContactRegistry,
    private capture: CapturePipeline
  ) {
    this.inactivityMs = config.CAPTURE_INACTIVITY_MINUTES * 60 * 1000;
  }

  /**
   * Route an incoming or outgoing message.
   * Called by the WhatsApp connection's message event handlers.
   */
  handleMessage(msg: WhatsAppMessage): void {
    const contact = this.contacts.getByJid(msg.remoteJid);

    // Not a tracked contact — ignore silently
    if (!contact) return;

    // Contact has not opted into WhatsApp capture — drop entirely
    if (contact.whatsapp_capture === "disabled") return;

    // Capture is off for this contact — do not read or buffer
    // (Privacy control per spec §6.3)
    if (contact.wa_capture === "off") return;

    // Buffer the message into the active thread
    this.bufferMessage(msg, contact);

    // Only set auto-capture timer if mode is "auto"
    // "on_demand" contacts get buffered but no automatic trigger
    if (contact.wa_capture === "auto") {
      this.resetInactivityTimer(msg.remoteJid);
    }
  }

  /**
   * Manually trigger capture for a contact's current thread.
   * Used for on-demand capture (the "Save this conversation" button).
   * Works regardless of wa_capture setting.
   */
  async triggerCapture(contactId: string): Promise<boolean> {
    const contact = this.contacts.getById(contactId);
    if (!contact) return false;

    const jid = this.contactToJid(contact);
    const thread = this.threads.get(jid);

    if (!thread || thread.messages.length === 0) return false;

    // Clear any pending auto timer
    this.clearTimer(jid);

    // Hand to capture pipeline
    await this.capture.process(thread);

    // Clean up the buffered thread
    this.threads.delete(jid);

    return true;
  }

  /**
   * Trigger capture for a single message (on-demand per-message capture).
   * Creates a minimal thread containing just that message.
   */
  async captureSingleMessage(contactId: string, messageId: string): Promise<boolean> {
    const contact = this.contacts.getById(contactId);
    if (!contact) return false;

    const jid = this.contactToJid(contact);
    const thread = this.threads.get(jid);

    if (!thread) return false;

    const message = thread.messages.find((m) => m.messageId === messageId);
    if (!message) return false;

    const singleThread: ConversationThread = {
      contact,
      messages: [message],
      startedAt: message.timestamp,
      lastActivityAt: message.timestamp,
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

  private bufferMessage(msg: WhatsAppMessage, contact: TrackedContact): void {
    const existing = this.threads.get(msg.remoteJid);

    if (existing) {
      existing.messages.push(msg);
      existing.lastActivityAt = msg.timestamp;
    } else {
      this.threads.set(msg.remoteJid, {
        contact,
        messages: [msg],
        startedAt: msg.timestamp,
        lastActivityAt: msg.timestamp,
      });
    }
  }

  private resetInactivityTimer(jid: string): void {
    this.clearTimer(jid);

    const timer = setTimeout(async () => {
      this.timers.delete(jid);

      const thread = this.threads.get(jid);
      if (!thread || thread.messages.length === 0) return;

      console.log(
        `⏱️  Inactivity timeout for ${thread.contact.name} — triggering capture (${thread.messages.length} messages)`
      );

      try {
        await this.capture.process(thread);
      } catch (err) {
        console.error(`❌ Capture failed for ${thread.contact.name}:`, err);
        // Thread stays buffered so the user can trigger manually
        return;
      }

      // Clean up after successful capture
      this.threads.delete(jid);
    }, this.inactivityMs);

    this.timers.set(jid, timer);
  }

  private clearTimer(jid: string): void {
    const existing = this.timers.get(jid);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(jid);
    }
  }

  private contactToJid(contact: TrackedContact): string {
    return `${contact.whatsapp.replace(/^\+/, "")}@s.whatsapp.net`;
  }
}
