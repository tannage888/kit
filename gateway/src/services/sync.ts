/**
 * Sync Service — Supabase → Markdown
 *
 * Supabase is the source of truth. This service renders People/*.md files
 * from Supabase data via Realtime postgres_changes subscriptions:
 *
 *   contacts UPDATE      → regenerate full markdown file via generateContactFile()
 *   interaction_log INSERT → prepend entry to ## Interaction Log
 *   follow_ups INSERT    → append bullet to **Follow-ups:**
 *   follow_ups UPDATE    → toggle ~~strikethrough~~ on bullet
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createClient, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { config } from "../config.js";
import {
  slugify,
  parseContactFile,
  generateContactFile,
  prependInteractionEntry,
  appendFollowUp,
  completeFollowUp,
  uncompleteFollowUp,
  type ContactRow,
  type FollowUpRow,
  type InteractionRow,
} from "../utils/markdown.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// gateway/src/services → gateway/src → gateway → kit → kit/People
const PEOPLE_DIR = path.resolve(__dirname, "..", "..", "..", "People");

const TIER_DIRS = [
  { dir: "1 - Inner Circle", tier: 1 },
  { dir: "2 - Active", tier: 2 },
  { dir: "3 - Business Contact", tier: 3 },
];

// ---------------------------------------------------------------------------
// SyncService
// ---------------------------------------------------------------------------

export class SyncService {
  private supabase: SupabaseClient;
  private channel: RealtimeChannel | null = null;

  /** contactId → absolute file path (built at startup, updated on render) */
  private contactFileMap = new Map<string, string>();

  constructor() {
    this.supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (!fs.existsSync(PEOPLE_DIR)) {
      console.warn(`⚠️  People dir not found at ${PEOPLE_DIR} — sync disabled`);
      return;
    }

    this.buildFileMaps();
    await this.startRealtime();

    console.log(
      `🔄 Sync service started — ${this.contactFileMap.size} contacts mapped`
    );
  }

  async stop(): Promise<void> {
    await this.channel?.unsubscribe();
  }

  // ── File map ──────────────────────────────────────────────────────────────

  private buildFileMaps(): void {
    this.contactFileMap.clear();

    for (const { dir, tier } of TIER_DIRS) {
      const tierPath = path.join(PEOPLE_DIR, dir);
      if (!fs.existsSync(tierPath)) continue;

      for (const file of fs.readdirSync(tierPath).filter((f) => f.endsWith(".md"))) {
        const filePath = path.join(tierPath, file);
        try {
          const { contact } = parseContactFile(filePath, tier);
          this.contactFileMap.set(contact.id, filePath);
        } catch {
          // malformed file — skip
        }
      }
    }
  }

  private computeFilePath(tier: number, name: string): string {
    const tierDir = TIER_DIRS.find((t) => t.tier === tier)?.dir ?? "3 - Business Contact";
    return path.join(PEOPLE_DIR, tierDir, `${name}.md`);
  }

  // ── Supabase → Markdown ───────────────────────────────────────────────────

  private async startRealtime(): Promise<void> {
    this.channel = this.supabase
      .channel("kit-sync")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "kit", table: "contacts" },
        (payload) => this.onContactUpdate(payload.new as any)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "kit", table: "interaction_log" },
        (payload) => this.onInteractionInsert(payload.new as any)
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "kit", table: "follow_ups" },
        (payload) => this.onFollowUpInsert(payload.new as any)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "kit", table: "follow_ups" },
        (payload) => this.onFollowUpUpdate(payload.old as any, payload.new as any)
      );

    await new Promise<void>((resolve, reject) => {
      this.channel!.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR") reject(new Error("Realtime subscription failed"));
      });
    });
  }

  private async onContactUpdate(row: any): Promise<void> {
    const contactId: string = row.id;

    // Compute expected path and keep map current
    const filePath = this.computeFilePath(row.tier, row.name);
    this.contactFileMap.set(contactId, filePath);

    console.log(`☁️  → 📝 regenerate: ${row.name}`);

    try {
      const [fuRes, intRes] = await Promise.all([
        this.supabase.schema("kit").from("follow_ups")
          .select("id, contact_id, text, completed, created_at")
          .eq("contact_id", contactId),
        this.supabase.schema("kit").from("interaction_log")
          .select("id, contact_id, notes, date, created_at, channel")
          .eq("contact_id", contactId)
          .order("date", { ascending: false }),
      ]);

      const contact: ContactRow = {
        id: row.id,
        name: row.name,
        tier: row.tier,
        frequency: row.frequency,
        frequency_days: row.frequency_days ?? 30,
        last_contact: row.last_contact ?? null,
        next_action: row.next_action ?? null,
        social_battery_cost: row.social_battery_cost ?? null,
        origin_story: row.origin_story ?? null,
        special_interests: row.special_interests ?? null,
        sensitive_topics: row.sensitive_topics ?? null,
        preferred_channel: row.preferred_channel ?? null,
        birthday: row.birthday ?? null,
        whatsapp_capture: row.whatsapp_capture === "enabled" ? "enabled" : "disabled",
        notes: row.notes ?? null,
        whatsapp: row.whatsapp ?? null,
        linkedin_username: row.linkedin_username ?? null,
        linkedin_capture: row.linkedin_capture === "enabled" ? "enabled" : "disabled",
        instagram_username: row.instagram_username ?? null,
        instagram_capture: row.instagram_capture === "enabled" ? "enabled" : "disabled",
        whatsapp_groups: row.whatsapp_groups ?? null,
        url: row.url ?? null,
        wa_capture: row.wa_capture ?? null,
        active: row.active ?? true,
      };

      const followUps: FollowUpRow[] = (fuRes.data ?? []) as FollowUpRow[];
      const interactions: InteractionRow[] = (intRes.data ?? []) as InteractionRow[];

      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, generateContactFile(contact, followUps, interactions), "utf-8");
    } catch (err) {
      console.error(`  ✗ contact render failed for ${row.name}:`, err);
    }
  }

  private onInteractionInsert(row: any): void {
    const contactId: string = row.contact_id;

    const filePath = this.contactFileMap.get(contactId);
    if (!filePath || !fs.existsSync(filePath)) {
      console.warn(`  ⚠️  interaction insert: no file for contact "${contactId}"`);
      return;
    }

    console.log(`☁️  → 📝 interaction: ${row.contact_id} (${row.date})`);

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const label = channelLabel(row.channel);
      const entry = `### ${row.date} — ${label}\n${row.notes}`;
      fs.writeFileSync(filePath, prependInteractionEntry(raw, entry), "utf-8");
    } catch (err) {
      console.error(`  ✗ interaction append failed:`, err);
    }
  }

  private onFollowUpInsert(row: any): void {
    const contactId: string = row.contact_id;

    const filePath = this.contactFileMap.get(contactId);
    if (!filePath || !fs.existsSync(filePath)) return;

    console.log(`☁️  → 📝 follow-up added: ${row.contact_id}`);

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      fs.writeFileSync(filePath, appendFollowUp(raw, row.text), "utf-8");
    } catch (err) {
      console.error(`  ✗ follow-up insert failed:`, err);
    }
  }

  private onFollowUpUpdate(oldRow: any, newRow: any): void {
    const contactId: string = newRow.contact_id;

    // Only act on completed toggle
    if (oldRow?.completed === newRow.completed) return;

    const filePath = this.contactFileMap.get(contactId);
    if (!filePath || !fs.existsSync(filePath)) return;

    console.log(`☁️  → 📝 follow-up toggle: ${newRow.text} → ${newRow.completed}`);

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const updated = newRow.completed
        ? completeFollowUp(raw, newRow.text)
        : uncompleteFollowUp(raw, newRow.text);
      fs.writeFileSync(filePath, updated, "utf-8");
    } catch (err) {
      console.error(`  ✗ follow-up toggle failed:`, err);
    }
  }

}

function channelLabel(channel: string | null | undefined): string {
  switch (channel?.toLowerCase()) {
    case "whatsapp":  return "WhatsApp";
    case "linkedin":  return "LinkedIn";
    case "instagram": return "Instagram";
    case "email":     return "Email";
    case "call":      return "Call";
    case "in_person":
    case "in person": return "In Person";
    default:          return channel ?? "App";
  }
}
