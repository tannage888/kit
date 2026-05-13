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
  /** JID → TrackedContact for O(1) lookup on WhatsApp message events */
  private byJid: Map<string, TrackedContact> = new Map();
  /** Contact ID → TrackedContact for API lookups */
  private byId: Map<string, TrackedContact> = new Map();
  /** LinkedIn username (slug) → TrackedContact */
  private byLinkedin: Map<string, TrackedContact> = new Map();
  /** Instagram username (without @) → TrackedContact */
  private byInstagram: Map<string, TrackedContact> = new Map();
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
      .select("id, name, whatsapp, tier, wa_capture, frequency, frequency_days, last_contact, whatsapp_capture, linkedin_username, linkedin_capture, instagram_username, instagram_capture");

    if (error) {
      console.error("❌ Failed to load contacts from Supabase:", error.message);
      return 0;
    }

    this.byJid.clear();
    this.byId.clear();
    this.byLinkedin.clear();
    this.byInstagram.clear();

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
        linkedin_username: row.linkedin_username ?? null,
        linkedin_capture: row.linkedin_capture === "enabled" ? "enabled" : "disabled",
        instagram_username: row.instagram_username ?? null,
        instagram_capture: row.instagram_capture === "enabled" ? "enabled" : "disabled",
      };
      this.register(contact);
    }

    console.log(`📇 Loaded ${this.byId.size} tracked contacts.`);
    return this.byId.size;
  }

  /** Register or update a contact in the in-memory registry */
  register(contact: TrackedContact): void {
    if (contact.whatsapp) {
      this.byJid.set(this.e164ToJid(contact.whatsapp), contact);
    }
    this.byId.set(contact.id, contact);
    if (contact.linkedin_username) this.byLinkedin.set(contact.linkedin_username.toLowerCase(), contact);
    if (contact.instagram_username) this.byInstagram.set(contact.instagram_username.toLowerCase().replace(/^@/, ""), contact);
  }

  /** Remove a contact from tracking */
  unregister(contactId: string): boolean {
    const contact = this.byId.get(contactId);
    if (!contact) return false;
    if (contact.whatsapp) this.byJid.delete(this.e164ToJid(contact.whatsapp));
    if (contact.linkedin_username) this.byLinkedin.delete(contact.linkedin_username.toLowerCase());
    if (contact.instagram_username) this.byInstagram.delete(contact.instagram_username.toLowerCase().replace(/^@/, ""));
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

  /** Look up by LinkedIn profile slug */
  getByLinkedinUsername(username: string): TrackedContact | undefined {
    return this.byLinkedin.get(username.toLowerCase());
  }

  /** Look up by Instagram handle (with or without leading @) */
  getByInstagramUsername(username: string): TrackedContact | undefined {
    return this.byInstagram.get(username.toLowerCase().replace(/^@/, ""));
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
    if (!contact.whatsapp) throw new Error(`Contact ${contact.name} has no WhatsApp number`);
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

  /**
   * Update editable fields for a contact in Supabase and in-memory.
   * Returns false if the contact is not found.
   */
  async updateContact(
    contactId: string,
    fields: Partial<Pick<TrackedContact,
      | "name" | "tier" | "frequency" | "last_contact"
      | "whatsapp" | "wa_capture" | "whatsapp_capture"
      | "linkedin_username" | "linkedin_capture"
      | "instagram_username" | "instagram_capture"
    >>
  ): Promise<boolean> {
    const contact = this.byId.get(contactId);
    if (!contact) return false;

    const dbFields: Record<string, unknown> = {};
    if (fields.name !== undefined) dbFields.name = fields.name;
    if (fields.tier !== undefined) dbFields.tier = fields.tier;
    if (fields.frequency !== undefined) {
      dbFields.frequency = fields.frequency;
      dbFields.frequency_days = frequencyToDays(fields.frequency);
    }
    if (fields.last_contact !== undefined) {
      dbFields.last_contact = fields.last_contact || null;
      const freqDays = (fields.frequency ? frequencyToDays(fields.frequency) : null) ?? contact.frequency_days;
      dbFields.next_action = fields.last_contact ? calcNextAction(fields.last_contact, freqDays) : null;
    }
    if (fields.whatsapp !== undefined) dbFields.whatsapp = fields.whatsapp || null;
    if (fields.wa_capture !== undefined) dbFields.wa_capture = fields.wa_capture;
    if (fields.whatsapp_capture !== undefined) dbFields.whatsapp_capture = fields.whatsapp_capture;
    if (fields.linkedin_username !== undefined) dbFields.linkedin_username = fields.linkedin_username;
    if (fields.linkedin_capture !== undefined) dbFields.linkedin_capture = fields.linkedin_capture;
    if (fields.instagram_username !== undefined) dbFields.instagram_username = fields.instagram_username;
    if (fields.instagram_capture !== undefined) dbFields.instagram_capture = fields.instagram_capture;

    const { error } = await this.supabase
      .schema("kit")
      .from("contacts")
      .update(dbFields)
      .eq("id", contactId);

    if (error) throw error;

    // Update in-memory registry
    this.unregister(contactId);
    const updated: TrackedContact = {
      ...contact,
      ...fields,
      frequency_days: fields.frequency ? frequencyToDays(fields.frequency) : contact.frequency_days,
    };
    // unregister removes by old id — re-add with same id
    this.byId.set(contactId, updated);
    if (updated.whatsapp) this.byJid.set(this.e164ToJid(updated.whatsapp), updated);
    if (updated.linkedin_username) this.byLinkedin.set(updated.linkedin_username.toLowerCase(), updated);
    if (updated.instagram_username) this.byInstagram.set(updated.instagram_username.toLowerCase().replace(/^@/, ""), updated);

    return true;
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
