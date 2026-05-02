/**
 * Tracked Contact Registry
 *
 * Manages the set of contacts the gateway is monitoring for WhatsApp
 * messages. Loaded from Supabase on startup and kept in-memory for
 * fast per-message lookups. Writes (last_contact, next_action) are
 * persisted back to Supabase immediately.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import type { CaptureMode, TrackedContact } from "../types.js";

export class ContactRegistry {
  /** JID → TrackedContact for O(1) lookup on message events */
  private byJid: Map<string, TrackedContact> = new Map();
  /** Contact ID → TrackedContact for API lookups */
  private byId: Map<string, TrackedContact> = new Map();
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
  }

  /**
   * Load all contacts with a WhatsApp number from the Kit database.
   * Called on gateway startup and can be refreshed via the API.
   */
  async loadFromDatabase(): Promise<number> {
    const { data, error } = await this.supabase
      .schema("kit")
      .from("contacts")
      .select("id, name, whatsapp, tier, wa_capture, frequency, frequency_days, last_contact, whatsapp_capture")
      .not("whatsapp", "is", null);

    if (error) {
      console.error("❌ Failed to load contacts from Supabase:", error.message);
      return 0;
    }

    this.byJid.clear();
    this.byId.clear();

    for (const row of data ?? []) {
      const contact: TrackedContact = {
        id: row.id,
        name: row.name,
        whatsapp: row.whatsapp,
        tier: row.tier,
        wa_capture: row.wa_capture ?? "on_demand",
        frequency: row.frequency,
        frequency_days: row.frequency_days ?? frequencyToDays(row.frequency),
        last_contact: row.last_contact,
        whatsapp_capture: row.whatsapp_capture === "enabled" ? "enabled" : "disabled",
      };
      this.register(contact);
    }

    console.log(`📇 Loaded ${this.byId.size} tracked contacts.`);
    return this.byId.size;
  }

  /** Register or update a contact in the in-memory registry */
  register(contact: TrackedContact): void {
    const jid = this.e164ToJid(contact.whatsapp);
    this.byJid.set(jid, contact);
    this.byId.set(contact.id, contact);
  }

  /** Remove a contact from tracking */
  unregister(contactId: string): boolean {
    const contact = this.byId.get(contactId);
    if (!contact) return false;
    const jid = this.e164ToJid(contact.whatsapp);
    this.byJid.delete(jid);
    this.byId.delete(contactId);
    return true;
  }

  /** Look up a contact by WhatsApp JID — the hot path on every message */
  getByJid(jid: string): TrackedContact | undefined {
    return this.byJid.get(jid);
  }

  /** Look up by contact ID */
  getById(id: string): TrackedContact | undefined {
    return this.byId.get(id);
  }

  /**
   * Case-insensitive exact-name lookup. Used by the daemon's NameResolver
   * fallback when a WhatsApp ZIP-export filename can't be matched against
   * the daemon's own chats table.
   */
  findByName(name: string): TrackedContact | undefined {
    const target = name.trim().toLowerCase();
    if (!target) return undefined;
    for (const contact of this.byId.values()) {
      if (contact.name.trim().toLowerCase() === target) return contact;
    }
    return undefined;
  }

  /** Synthesise the WhatsApp JID for a tracked contact. */
  jidFor(contact: TrackedContact): string {
    return this.e164ToJid(contact.whatsapp);
  }

  /** Update capture mode for a contact */
  setCaptureMode(contactId: string, mode: CaptureMode): boolean {
    const contact = this.byId.get(contactId);
    if (!contact) return false;
    contact.wa_capture = mode;
    return true;
  }

  /**
   * Update last_contact date after a successful capture.
   * Persists to Supabase and recalculates next_action.
   * Also updates the in-memory record so the registry stays current.
   */
  async updateLastContact(contactId: string, date: string): Promise<void> {
    const contact = this.byId.get(contactId);
    if (!contact) return;

    const nextAction = calcNextAction(date, contact.frequency_days);

    // Persist to Supabase
    const { error } = await this.supabase
      .schema("kit")
      .from("contacts")
      .update({ last_contact: date, next_action: nextAction })
      .eq("id", contactId);

    if (error) {
      console.error(
        `❌ Failed to update last_contact for ${contact.name}:`,
        error.message
      );
      throw error;
    }

    // Keep in-memory registry in sync
    contact.last_contact = date;

    console.log(
      `📅 Updated ${contact.name}: last_contact=${date}, next_action=${nextAction}`
    );
  }

  /** All currently tracked contacts */
  getAll(): TrackedContact[] {
    return Array.from(this.byId.values());
  }

  /** Count of tracked contacts */
  get size(): number {
    return this.byId.size;
  }

  // ── Helpers ────────────────────────────────────────────

  private e164ToJid(e164: string): string {
    return `${e164.replace(/^\+/, "").replace(/\s+/g, "")}@s.whatsapp.net`;
  }
}

// ── Exported frequency helpers (also used by SweepScheduler) ──

export function frequencyToDays(frequency: string): number {
  switch (frequency) {
    case "Weekly":    return 7;
    case "Monthly":   return 30;
    case "Quarterly": return 90;
    default:          return 30;
  }
}

export function calcNextAction(lastContact: string, frequencyDays: number): string {
  return new Date(new Date(lastContact).getTime() + frequencyDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
