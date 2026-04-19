/**
 * Bidirectional Sync Service
 *
 * Keeps People/*.md files and the Open Brain Supabase database in sync:
 *
 *   Markdown → Supabase  (chokidar file watcher)
 *   ├─ Contact profile changes   → upsert contacts row
 *   ├─ New interaction log entry → upsert interaction_log row
 *   └─ Follow-up changes         → upsert follow_ups rows
 *
 *   Supabase → Markdown  (Realtime postgres_changes)
 *   ├─ contacts UPDATE           → patch frontmatter (last_contact, next_action)
 *   ├─ interaction_log INSERT    → prepend entry to ## Interaction Log
 *   ├─ follow_ups INSERT         → append bullet to **Follow-ups:**
 *   ├─ follow_ups UPDATE         → toggle ~~strikethrough~~ on bullet
 *   └─ thoughts INSERT (gateway) → prepend WhatsApp capture as interaction entry
 *
 * Loop prevention: each direction sets a guard (TTL = 3 s) on the contact ID
 * before writing. The other direction checks the guard and skips if active.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import chokidar, { FSWatcher } from "chokidar";
import { createClient, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { config } from "../config.js";
import {
  slugify,
  parseContactFile,
  setFrontmatterField,
  prependInteractionEntry,
  appendFollowUp,
  completeFollowUp,
  uncompleteFollowUp,
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

const LOOP_GUARD_TTL = 3_000; // ms

// ---------------------------------------------------------------------------
// SyncService
// ---------------------------------------------------------------------------

export class SyncService {
  private supabase: SupabaseClient;
  private watcher: FSWatcher | null = null;
  private channel: RealtimeChannel | null = null;

  /** contactId → absolute file path */
  private contactFileMap = new Map<string, string>();
  /** filePath → contactId (reverse lookup) */
  private fileContactMap = new Map<string, string>();

  /** Contact IDs recently written *from* markdown — suppress Supabase→MD echo */
  private mdToDbGuard = new Map<string, ReturnType<typeof setTimeout>>();
  /** Contact IDs recently written *from* Supabase — suppress MD→Supabase echo */
  private dbToMdGuard = new Map<string, ReturnType<typeof setTimeout>>();

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
    this.startFileWatcher();
    await this.startRealtime();

    console.log(
      `🔄 Sync service started — ${this.contactFileMap.size} contacts, watching ${PEOPLE_DIR}`
    );
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    await this.channel?.unsubscribe();
  }

  // ── File map ──────────────────────────────────────────────────────────────

  private buildFileMaps(): void {
    this.contactFileMap.clear();
    this.fileContactMap.clear();

    for (const { dir, tier } of TIER_DIRS) {
      const tierPath = path.join(PEOPLE_DIR, dir);
      if (!fs.existsSync(tierPath)) continue;

      for (const file of fs.readdirSync(tierPath).filter((f) => f.endsWith(".md"))) {
        const filePath = path.join(tierPath, file);
        try {
          const { contact } = parseContactFile(filePath, tier);
          this.contactFileMap.set(contact.id, filePath);
          this.fileContactMap.set(filePath, contact.id);
        } catch {
          // malformed file — skip
        }
      }
    }
  }

  private getTierForPath(filePath: string): number {
    for (const { dir, tier } of TIER_DIRS) {
      if (filePath.includes(dir)) return tier;
    }
    return 3;
  }

  // ── Direction 1: Markdown → Supabase ─────────────────────────────────────

  private startFileWatcher(): void {
    this.watcher = chokidar.watch(path.join(PEOPLE_DIR, "**", "*.md"), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 100 },
    });

    this.watcher.on("change", (filePath) => this.onMarkdownChange(filePath));
    this.watcher.on("add", (filePath) => this.onMarkdownChange(filePath));
  }

  private async onMarkdownChange(filePath: string): Promise<void> {
    const contactId = this.fileContactMap.get(filePath) ?? this.inferContactId(filePath);
    if (!contactId) return;

    // Skip if we just wrote this file from a Supabase event
    if (this.dbToMdGuard.has(contactId)) return;

    this.setMdToDbGuard(contactId);

    console.log(`📝 → ☁️  ${path.basename(filePath)}`);

    try {
      const tier = this.getTierForPath(filePath);
      const { contact, followUps, interactions } = parseContactFile(filePath, tier);

      // Register the file in our maps (handles newly added files)
      this.contactFileMap.set(contact.id, filePath);
      this.fileContactMap.set(filePath, contact.id);

      await this.supabase
        .schema("kit")
        .from("contacts")
        .upsert(contact, { onConflict: "id" });

      if (followUps.length) {
        await this.supabase
          .schema("kit")
          .from("follow_ups")
          .upsert(followUps, { onConflict: "id", ignoreDuplicates: true });
      }

      if (interactions.length) {
        await this.supabase
          .schema("kit")
          .from("interaction_log")
          .upsert(interactions, { onConflict: "id", ignoreDuplicates: true });
      }
    } catch (err) {
      console.error(`  ✗ sync failed for ${path.basename(filePath)}:`, err);
    }
  }

  private inferContactId(filePath: string): string | null {
    const name = path.basename(filePath, ".md");
    return name ? slugify(name) : null;
  }

  // ── Direction 2: Supabase → Markdown ─────────────────────────────────────

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

  private onContactUpdate(row: any): void {
    const contactId: string = row.id;
    if (this.mdToDbGuard.has(contactId)) return;

    const filePath = this.contactFileMap.get(contactId);
    if (!filePath || !fs.existsSync(filePath)) return;

    this.setDbToMdGuard(contactId);
    console.log(`☁️  → 📝 frontmatter: ${row.name}`);

    try {
      let raw = fs.readFileSync(filePath, "utf-8");
      if (row.last_contact) raw = setFrontmatterField(raw, "last_contact", row.last_contact);
      if (row.next_action) raw = setFrontmatterField(raw, "next_action", row.next_action);
      if (row.whatsapp) raw = setFrontmatterField(raw, "whatsapp", `"${row.whatsapp}"`);
      fs.writeFileSync(filePath, raw, "utf-8");
    } catch (err) {
      console.error(`  ✗ frontmatter update failed:`, err);
    }
  }

  private onInteractionInsert(row: any): void {
    const contactId: string = row.contact_id;

    if (this.mdToDbGuard.has(contactId)) {
      console.log(`  ⏭  interaction skipped (mdToDbGuard active): ${contactId}`);
      return;
    }

    const filePath = this.contactFileMap.get(contactId);
    if (!filePath) {
      console.warn(`  ⚠️  interaction insert: no file mapped for contact "${contactId}"`);
      return;
    }
    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠️  interaction insert: file not found at ${filePath}`);
      return;
    }

    this.setDbToMdGuard(contactId);
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
    if (this.mdToDbGuard.has(contactId)) return;

    const filePath = this.contactFileMap.get(contactId);
    if (!filePath || !fs.existsSync(filePath)) return;

    this.setDbToMdGuard(contactId);
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
    if (this.mdToDbGuard.has(contactId)) return;

    // Only act on completed toggle
    if (oldRow?.completed === newRow.completed) return;

    const filePath = this.contactFileMap.get(contactId);
    if (!filePath || !fs.existsSync(filePath)) return;

    this.setDbToMdGuard(contactId);
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

  // ── Loop guards ───────────────────────────────────────────────────────────

  private setMdToDbGuard(contactId: string): void {
    clearTimeout(this.mdToDbGuard.get(contactId));
    this.mdToDbGuard.set(
      contactId,
      setTimeout(() => this.mdToDbGuard.delete(contactId), LOOP_GUARD_TTL)
    );
  }

  private setDbToMdGuard(contactId: string): void {
    clearTimeout(this.dbToMdGuard.get(contactId));
    this.dbToMdGuard.set(
      contactId,
      setTimeout(() => this.dbToMdGuard.delete(contactId), LOOP_GUARD_TTL)
    );
  }
}

function channelLabel(channel: string | null | undefined): string {
  switch (channel?.toLowerCase()) {
    case "whatsapp": return "WhatsApp";
    case "email":    return "Email";
    case "call":     return "Call";
    case "in_person":
    case "in person": return "In Person";
    default:         return channel ?? "App";
  }
}
