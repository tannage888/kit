/**
 * Sweep Scheduler
 *
 * Runs on a configurable interval (default: every 3 days) and pulls
 * recent WhatsApp conversation history for each tracked contact.
 *
 * For each contact that has had activity since the last sweep:
 *   1. Fetch messages via HistoryFetcher
 *   2. Group into conversation threads (done inside HistoryFetcher)
 *   3. Summarise each thread and write directly to Supabase via
 *      CapturePipeline.processAndCommit() — no review queue
 *   4. Update the wa_sweep_state watermark for that contact
 *
 * Contacts with wa_capture = "off" are always skipped.
 * A 2-second pause between contacts avoids hammering the Baileys socket.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { ContactRegistry } from "./contacts.js";
import { CapturePipeline } from "./capture.js";
import { HistoryFetcher } from "./history-fetcher.js";
import { WhatsAppConnection } from "./whatsapp.js";
import type {
  ContactSweepResult,
  SweepResult,
  SweepState,
  TrackedContact,
} from "../types.js";

const INTER_CONTACT_DELAY_MS = 2_000;

export class SweepScheduler {
  private supabase: SupabaseClient;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastResult: SweepResult | null = null;
  private nextSweepAt: Date | null = null;

  constructor(
    private wa: WhatsAppConnection,
    private contacts: ContactRegistry,
    private capture: CapturePipeline,
    private fetcher: HistoryFetcher
  ) {
    this.supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
  }

  /**
   * Start the scheduler. Runs immediately on start, then every intervalDays.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start(intervalDays: number): void {
    if (this.timer) return;

    const intervalMs = intervalDays * 24 * 60 * 60 * 1000;

    // Run immediately on first start, then on interval
    this.scheduleNext(intervalMs);
    console.log(
      `🔄 Sweep scheduler started — running every ${intervalDays} day(s).`
    );
  }

  /** Stop the scheduler. In-progress sweeps are allowed to complete. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Last completed sweep result */
  getLastResult(): SweepResult | null {
    return this.lastResult;
  }

  /** Next scheduled sweep time */
  getNextSweepAt(): Date | null {
    return this.nextSweepAt;
  }

  /**
   * Run a sweep immediately, regardless of the schedule.
   * If a sweep is already running, this is a no-op and returns null.
   *
   * @param contactName  Optional — sweep only this contact (by name fragment)
   */
  async runSweep(contactName?: string): Promise<SweepResult | null> {
    if (this.running) {
      console.log("⏳ Sweep already in progress — skipping.");
      return null;
    }

    this.running = true;
    const startedAt = new Date().toISOString();
    console.log(`\n🔍 Starting WhatsApp sweep${contactName ? ` for "${contactName}"` : ""}...`);

    const details: ContactSweepResult[] = [];

    try {
      // Only sweep if WhatsApp is actually connected
      if (this.wa.getStatus() !== "connected") {
        console.warn("⚠️  WhatsApp not connected — sweep aborted.");
        const result: SweepResult = {
          startedAt,
          completedAt: new Date().toISOString(),
          contactsSwept: 0,
          contactsSkipped: 0,
          threadsProcessed: 0,
          errors: 0,
          details: [{
            contactId: "",
            contactName: "n/a",
            messagesFound: 0,
            threadsProcessed: 0,
            skipped: true,
            skipReason: "WhatsApp not connected",
          }],
        };
        this.lastResult = result;
        return result;
      }

      let allContacts = this.contacts.getAll();

      // Filter to a single contact if requested
      if (contactName) {
        const needle = contactName.toLowerCase();
        allContacts = allContacts.filter((c) =>
          c.name.toLowerCase().includes(needle)
        );
        if (allContacts.length === 0) {
          console.warn(`⚠️  No contact found matching "${contactName}".`);
        }
      }

      for (const contact of allContacts) {
        const result = await this.sweepContact(contact);
        details.push(result);

        // Pause between contacts to avoid flooding the socket
        if (allContacts.indexOf(contact) < allContacts.length - 1) {
          await sleep(INTER_CONTACT_DELAY_MS);
        }
      }
    } finally {
      this.running = false;
    }

    const swept = details.filter((d) => !d.skipped);
    const result: SweepResult = {
      startedAt,
      completedAt: new Date().toISOString(),
      contactsSwept: swept.length,
      contactsSkipped: details.filter((d) => d.skipped).length,
      threadsProcessed: details.reduce((sum, d) => sum + d.threadsProcessed, 0),
      errors: details.filter((d) => !!d.error).length,
      details,
    };

    this.lastResult = result;
    console.log(
      `✅ Sweep complete — ${result.contactsSwept} swept, ` +
      `${result.threadsProcessed} threads processed, ` +
      `${result.contactsSkipped} skipped, ${result.errors} errors.`
    );

    return result;
  }

  // ── Private helpers ──────────────────────────────────────

  private scheduleNext(intervalMs: number): void {
    // Delay the first sweep to allow WhatsApp's messaging-history.set sync
    // to populate the message buffer before we query it.
    const startupDelayMs = 30_000;
    console.log(`⏳ First sweep in ${startupDelayMs / 1000}s (waiting for history sync)...`);
    setTimeout(() => void this.runSweep(), startupDelayMs);

    // Then schedule repeating runs
    this.timer = setInterval(() => {
      void this.runSweep();
      this.nextSweepAt = new Date(Date.now() + intervalMs);
    }, intervalMs);

    this.nextSweepAt = new Date(Date.now() + startupDelayMs);
  }

  private async sweepContact(contact: TrackedContact): Promise<ContactSweepResult> {
    // Skip contacts that have opted out of capture
    if (contact.wa_capture === "off") {
      return {
        contactId: contact.id,
        contactName: contact.name,
        messagesFound: 0,
        threadsProcessed: 0,
        skipped: true,
        skipReason: "wa_capture=off",
      };
    }

    // Skip contacts with no WhatsApp number
    if (!contact.whatsapp) {
      return {
        contactId: contact.id,
        contactName: contact.name,
        messagesFound: 0,
        threadsProcessed: 0,
        skipped: true,
        skipReason: "no WhatsApp number",
      };
    }

    // Load the sweep watermark for this contact
    const sinceMs = await this.loadWatermark(contact.id);
    const jid = contact.whatsapp.replace(/^\+/, "").replace(/\s+/g, "") + "@s.whatsapp.net";

    let threads;
    try {
      threads = await this.fetcher.fetchSince(jid, contact, sinceMs);
    } catch (err) {
      console.error(`❌ History fetch failed for ${contact.name}:`, (err as Error).message);
      return {
        contactId: contact.id,
        contactName: contact.name,
        messagesFound: 0,
        threadsProcessed: 0,
        skipped: false,
        error: (err as Error).message,
      };
    }

    const totalMessages = threads.reduce((sum, t) => sum + t.messages.length, 0);

    if (threads.length === 0) {
      console.log(`  ⏩ ${contact.name} — no new messages since last sweep.`);
      await this.saveWatermark(contact.id, sinceMs, 0);
      return {
        contactId: contact.id,
        contactName: contact.name,
        messagesFound: 0,
        threadsProcessed: 0,
        skipped: false,
      };
    }

    console.log(
      `  📨 ${contact.name} — ${totalMessages} messages in ${threads.length} thread(s)`
    );

    let threadsProcessed = 0;
    let lastMessageTs = sinceMs;
    let captureError: string | undefined;

    for (const thread of threads) {
      try {
        await this.capture.processAndCommit(thread);
        threadsProcessed++;
        // Track the newest message we've processed
        lastMessageTs = Math.max(lastMessageTs, thread.lastActivityAt);
      } catch (err) {
        console.error(
          `  ❌ Capture failed for thread (${contact.name} at ${new Date(thread.startedAt).toISOString()}):`,
          (err as Error).message
        );
        captureError = (err as Error).message;
        // Continue processing remaining threads
      }
    }

    // Save watermark to the end of the most recent successfully processed thread
    await this.saveWatermark(contact.id, lastMessageTs, totalMessages);

    return {
      contactId: contact.id,
      contactName: contact.name,
      messagesFound: totalMessages,
      threadsProcessed,
      skipped: false,
      error: captureError,
    };
  }

  /**
   * Load the watermark for a contact.
   * Returns epoch-ms of the last processed message, or a default
   * lookback of (intervalDays * 2) days ago if never swept before.
   */
  private async loadWatermark(contactId: string): Promise<number> {
    const { data } = await this.supabase
      .schema("kit")
      .from("wa_sweep_state")
      .select("last_message_ts, last_swept_at")
      .eq("contact_id", contactId)
      .single();

    if (data?.last_message_ts) {
      return data.last_message_ts as number;
    }

    // First-time sweep: look back 2× the interval to catch recent history
    const defaultLookbackMs = config.SWEEP_INTERVAL_DAYS * 2 * 24 * 60 * 60 * 1000;
    return Date.now() - defaultLookbackMs;
  }

  /** Upsert the sweep watermark for a contact */
  private async saveWatermark(
    contactId: string,
    lastMessageTs: number,
    messagesFound: number
  ): Promise<void> {
    const { error } = await this.supabase
      .schema("kit")
      .from("wa_sweep_state")
      .upsert(
        {
          contact_id: contactId,
          last_swept_at: new Date().toISOString(),
          last_message_ts: lastMessageTs,
          messages_found: messagesFound,
        },
        { onConflict: "contact_id" }
      );

    if (error) {
      console.error(`❌ Failed to save sweep watermark for ${contactId}:`, error.message);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
