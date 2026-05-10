/**
 * ContactCreator — canonical contact-creation service.
 *
 * Single entry point for creating a new Kit contact. Does all three
 * things atomically so the contact is usable immediately:
 *   1. Writes the People/<tier>/<name>.md file
 *   2. Upserts the contacts row in Supabase (kit schema)
 *   3. Registers the contact in the in-memory ContactRegistry so
 *      resolver, capture, and sweep work without a gateway restart
 *
 * Used by:
 *   - POST /api/contacts/create  (gateway REST API)
 *   - tools.ts `createContact()` delegates here to avoid duplication
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { ContactRegistry } from "./contacts.js";
import type { CaptureMode } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// gateway/src/services → gateway/src → gateway → kit → kit/People
const PEOPLE_DIR = path.resolve(__dirname, "..", "..", "..", "People");

const TIER_FOLDER: Record<number, string> = {
  1: "1 - Inner Circle",
  2: "2 - Active",
  3: "3 - Business Contact",
};

const TIER_RELATIONSHIP: Record<number, string> = {
  1: "1-Inner Circle",
  2: "2-Active",
  3: "3-Business Contact",
};

const TIER_TAG: Record<number, string> = {
  1: "1-inner-circle",
  2: "2-active",
  3: "3-business-contact",
};

const FREQUENCY_DAYS: Record<string, number> = {
  weekly: 7, fortnightly: 14, "bi-weekly": 14, monthly: 30,
  "bi-monthly": 60, quarterly: 90, "twice yearly": 180,
  "bi-annual": 180, annual: 365, yearly: 365,
};

export interface CreateContactInput {
  name: string;
  tier: 1 | 2 | 3;
  frequency: string;
  origin_story?: string;
  notes?: string;
  social_battery_cost?: string;
  whatsapp?: string;
  whatsapp_capture?: "enabled" | "disabled";
  wa_capture?: "auto" | "on_demand" | "off";
}

export interface CreateContactResult {
  id: string;
  jid: string | null;
  filePath: string;
}

export class ContactCreator {
  private supabase: SupabaseClient;

  constructor(private readonly contacts: ContactRegistry) {
    this.supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);
  }

  async create(input: CreateContactInput): Promise<CreateContactResult> {
    const id = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

    const { data: existing } = await this.supabase
      .schema("kit")
      .from("contacts")
      .select("id")
      .eq("id", id)
      .single();
    if (existing) throw new Error(`Contact "${input.name}" already exists (id: ${id})`);

    const frequency_days = FREQUENCY_DAYS[input.frequency.toLowerCase()] ?? 30;
    const whatsapp = input.whatsapp ?? null;
    const whatsapp_capture = input.whatsapp_capture ?? "disabled";
    const wa_capture: CaptureMode = (input.wa_capture as CaptureMode) ?? "on_demand";

    // 1. Write markdown file
    const folder = path.join(PEOPLE_DIR, TIER_FOLDER[input.tier]);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const filePath = path.join(folder, `${input.name}.md`);
    fs.writeFileSync(filePath, buildMarkdown(input), "utf-8");

    // 2. Upsert to Supabase
    const row = {
      id,
      name: input.name,
      tier: input.tier,
      frequency: input.frequency,
      frequency_days,
      last_contact: null,
      next_action: null,
      social_battery_cost: input.social_battery_cost ?? null,
      origin_story: input.origin_story ?? null,
      notes: input.notes ?? null,
      whatsapp,
      active: true,
      wa_capture,
      whatsapp_capture,
    };
    const { error } = await this.supabase.schema("kit").from("contacts").upsert(row, { onConflict: "id" });
    if (error) throw new Error(`DB upsert failed: ${error.message}`);

    // 3. Register in the live ContactRegistry so the contact is
    //    immediately usable (resolver, capture, sweep) without restart.
    this.contacts.register({
      id,
      name: input.name,
      whatsapp: whatsapp ?? "",
      tier: input.tier,
      wa_capture,
      frequency: input.frequency as any,
      frequency_days,
      last_contact: "",
      whatsapp_capture: whatsapp_capture === "enabled" ? "enabled" : "disabled",
      linkedin_username: null,
      linkedin_capture: "disabled",
      instagram_username: null,
      instagram_capture: "disabled",
    });

    const jid = whatsapp
      ? `${whatsapp.replace(/^\+/, "").replace(/\s+/g, "")}@s.whatsapp.net`
      : null;

    return { id, jid, filePath };
  }
}

function buildMarkdown(input: CreateContactInput): string {
  const rel = TIER_RELATIONSHIP[input.tier];
  const tag = TIER_TAG[input.tier];
  const bg = input.origin_story ?? "<!-- Add background here -->";
  const notes = input.notes ?? "<!-- Add notes here -->";

  const optional: string[] = [];
  if (input.whatsapp) optional.push(`whatsapp: "${input.whatsapp}"`);
  if (input.social_battery_cost) optional.push(`social_battery: ${input.social_battery_cost}`);
  if (input.whatsapp_capture) optional.push(`whatsapp_capture: ${input.whatsapp_capture}`);
  if (input.wa_capture) optional.push(`wa_capture: ${input.wa_capture}`);
  const optionalBlock = optional.length ? optional.join("\n") + "\n" : "";

  return `---
name: ${input.name}
relationship: ${rel}
frequency: ${input.frequency}
last_contact:
next_action:
${optionalBlock}tags: [people, ${tag}]
---

# ${input.name}

## At a Glance

**Relationship:** ${rel}
**Contact Frequency:** ${input.frequency}
**Last Contact:**
**Next Action:**

## Background

${bg}

## Notes

${notes}

## Interaction Log

<!-- Add notes after each contact below -->
`;
}
