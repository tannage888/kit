/**
 * Sweep Scheduler
 *
 * Runs on a configurable interval (default: every 3 hours) and pulls
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
import { CapturePipeline, contactParticipated } from "./capture.js";
import { HistoryFetcher } from "./history-fetcher.js";
import { toJid } from "../utils/wa-messages.js";
import type {
  ContactSweepResult,
  SweepResult,
  TrackedContact,
} from "../types.js";

const INTER_CONTACT_DELAY_MS = 2_000;

export class SweepScheduler {
  private supabase: SupabaseClient;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastResult: SweepResult | null = null;
  private groupNames = new Map<string, string>();
  private nextSweepAt: Date | null = null;

  constructor(
    private contacts: ContactRegistry,
    private capture: CapturePipeline,
    private fetcher: HistoryFetcher
  ) {
    this.supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
  }

  /**
   * Start the scheduler. Runs immediately on start, then every intervalHours.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start(intervalHours: number): void {
    if (this.timer) return;

    const intervalMs = intervalHours * 60 * 60 * 1000;

    // Run immediately on first start, then on interval
    this.scheduleNext(intervalMs);
    console.log(
      `🔄 Sweep scheduler started — running every ${intervalHours} hour(s).`
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
      // Only sweep if the external daemon reports a live WhatsApp connection
      const daemonStatus = await fetch(`${config.EXTERNAL_GATEWAY_URL}/api/status`)
        .then((r) => r.json() as Promise<{ connection: string }>)
        .catch(() => null);
      if (!daemonStatus || daemonStatus.connection !== "connected") {
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

      await this.loadGroupNames();
      await this.syncGroupMembership();

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
    setTimeout(() => {
      void this.runSweep();
      // The first run comes from this timeout rather than the interval, so
      // advance the readout here too — otherwise /api/status reports a
      // nextSweep in the past until the interval first fires, hours later.
      this.nextSweepAt = new Date(Date.now() + intervalMs);
    }, startupDelayMs);

    // Then schedule repeating runs
    this.timer = setInterval(() => {
      void this.runSweep();
      this.nextSweepAt = new Date(Date.now() + intervalMs);
    }, intervalMs);

    this.nextSweepAt = new Date(Date.now() + startupDelayMs);
  }

  /**
   * Reconcile each contact's group membership before sweeping.
   *
   * whatsapp_groups drives the group branch below. Left to a manual call it
   * goes stale in both directions — groups joined since the last sync are
   * never swept, and groups since left are swept forever. Running it here
   * ties membership to the same 3-hourly cadence as the sweep itself.
   *
   * Failure is non-fatal: a stale membership list still sweeps, it just
   * misses new groups until the next run.
   */
  private async syncGroupMembership(): Promise<void> {
    try {
      const res = await fetch(`http://localhost:${config.PORT}/api/contacts/sync-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        console.warn(`  ⚠️  group membership sync returned HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { contactsChanged?: number; totalGroupLinks?: number };
      if (body.contactsChanged) {
        console.log(
          `  👥 Group membership updated for ${body.contactsChanged} contact(s) ` +
          `(${body.totalGroupLinks} group links).`
        );
      }
    } catch (err) {
      console.warn(`  ⚠️  group membership sync failed:`, (err as Error).message);
    }
  }

  /**
   * Group display names, refreshed once per sweep run.
   *
   * The name is stored on each capture so the markdown section has a heading
   * a human recognises rather than a raw JID.
   */
  private async loadGroupNames(): Promise<void> {
    try {
      const res = await fetch(`${config.EXTERNAL_GATEWAY_URL}/api/chats`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        chats?: Array<{ jid: string; displayName?: string | null; isGroup?: boolean }>;
      };
      this.groupNames.clear();
      for (const chat of body.chats ?? []) {
        if (chat.isGroup && chat.displayName) this.groupNames.set(chat.jid, chat.displayName);
      }
    } catch {
      // Non-fatal — sections fall back to the JID as their heading.
    }
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

    // ── 1:1 sweep ────────────────────────────────────────────

    const sinceMs = await this.loadWatermark(contact.id);
    const jid = toJid(contact.whatsapp);

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

    let threadsProcessed = 0;
    let lastMessageTs = sinceMs;
    let captureError: string | undefined;

    if (threads.length === 0) {
      console.log(`  ⏩ ${contact.name} — no new 1:1 messages since last sweep.`);
    } else {
      console.log(
        `  📨 ${contact.name} — ${totalMessages} messages in ${threads.length} thread(s)`
      );

      for (const thread of threads) {
        try {
          // A thread Kit has already logged in full returns null. The
          // watermark still moves past it — it was read, and leaving it
          // behind means re-reading it on every sweep from here on.
          const captured = await this.capture.processAndCommit(thread);
          if (captured) threadsProcessed++;
          lastMessageTs = Math.max(lastMessageTs, thread.lastActivityAt);
        } catch (err) {
          console.error(
            `  ❌ Capture failed for thread (${contact.name} at ${new Date(thread.startedAt).toISOString()}):`,
            (err as Error).message
          );
          captureError = (err as Error).message;
        }
      }
    }

    await this.saveWatermark(contact.id, lastMessageTs, totalMessages);

    // ── Group sweep ───────────────────────────────────────────

    const groupJids = (contact.whatsapp_groups ?? "")
      .split(",")
      .map((j) => j.trim())
      .filter(Boolean);

    let groupMessagesFound = 0;
    let groupThreadsProcessed = 0;

    for (const groupJid of groupJids) {
      const groupSinceMs = await this.loadGroupWatermark(contact.id, groupJid);

      let groupThreads;
      try {
        groupThreads = await this.fetcher.fetchSince(groupJid, contact, groupSinceMs);
      } catch (err) {
        console.error(
          `❌ Group history fetch failed for ${contact.name} (${groupJid}):`,
          (err as Error).message
        );
        continue;
      }

      const groupTotalMessages = groupThreads.reduce((sum, t) => sum + t.messages.length, 0);
      groupMessagesFound += groupTotalMessages;

      let groupLastMessageTs = groupSinceMs;
      for (const thread of groupThreads) {
        thread.groupJid = groupJid;
        thread.groupName = this.groupNames.get(groupJid);

        // A group is swept per tracked member, so most threads contain none
        // of this contact's own messages. Summarising those would file an
        // entry about other people under their name.
        if (!contactParticipated(thread)) {
          groupLastMessageTs = Math.max(groupLastMessageTs, thread.lastActivityAt);
          continue;
        }

        try {
          const captured = await this.capture.processAndCommit(thread);
          if (captured) groupThreadsProcessed++;
          groupLastMessageTs = Math.max(groupLastMessageTs, thread.lastActivityAt);
        } catch (err) {
          console.error(
            `  ❌ Group capture failed for thread (${contact.name} at ${new Date(thread.startedAt).toISOString()}):`,
            (err as Error).message
          );
          captureError = (err as Error).message;
        }
      }

      await this.saveGroupWatermark(contact.id, groupJid, groupLastMessageTs, groupTotalMessages);
    }

    return {
      contactId: contact.id,
      contactName: contact.name,
      messagesFound: totalMessages + groupMessagesFound,
      threadsProcessed: threadsProcessed + groupThreadsProcessed,
      skipped: false,
      error: captureError,
    };
  }

  private async loadGroupWatermark(contactId: string, groupJid: string): Promise<number> {
    const { data } = await this.supabase
      .schema("kit")
      .from("wa_group_sweep_state")
      .select("last_message_ts")
      .eq("contact_id", contactId)
      .eq("group_jid", groupJid)
      .single();

    if (data?.last_message_ts) {
      return data.last_message_ts as number;
    }

    const defaultLookbackMs = config.SWEEP_INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - defaultLookbackMs;
  }

  private async saveGroupWatermark(
    contactId: string,
    groupJid: string,
    lastMessageTs: number,
    messagesFound: number
  ): Promise<void> {
    const { error } = await this.supabase
      .schema("kit")
      .from("wa_group_sweep_state")
      .upsert(
        {
          contact_id: contactId,
          group_jid: groupJid,
          last_swept_at: new Date().toISOString(),
          last_message_ts: lastMessageTs,
          messages_found: messagesFound,
        },
        { onConflict: "contact_id,group_jid" }
      );

    if (error) {
      console.error(`❌ Failed to save group sweep watermark for ${contactId}/${groupJid}:`, error.message);
    }
  }

  /**
   * Load the watermark for a contact.
   * Returns epoch-ms of the last processed message, or a default
   * lookback of SWEEP_INITIAL_LOOKBACK_DAYS if never swept before.
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

    // First-time sweep: look back a fixed window to catch recent history.
    // Decoupled from the run interval so frequent sweeps still backfill
    // a meaningful slice the first time they see a contact.
    const defaultLookbackMs = config.SWEEP_INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
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
