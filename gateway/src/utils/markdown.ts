/**
 * Markdown parse/write utilities shared across seed and sync.
 *
 * Parse side: extracts structured data from People/*.md files.
 * Write side: safely patches individual sections without reformatting
 *             the rest of the file.
 */

import * as fs from "fs";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContactRow {
  id: string;
  name: string;
  tier: number;
  frequency: string;
  frequency_days: number;
  last_contact: string | null;
  next_action: string | null;
  social_battery_cost: string | null;
  origin_story: string | null;
  special_interests: string | null;
  sensitive_topics: string | null;
  preferred_channel: string | null;
  birthday: string | null;
  whatsapp_capture: "enabled" | "disabled";
  notes: string | null;
  whatsapp: string | null;
  active: boolean;
}

export interface FollowUpRow {
  id: string;
  contact_id: string;
  text: string;
  completed: boolean;
  created_at: string;
}

export interface InteractionRow {
  id: string;
  contact_id: string;
  notes: string;
  date: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function frequencyToDays(frequency: string): number {
  const f = frequency.toLowerCase().trim();
  if (f === "weekly") return 7;
  if (f === "fortnightly" || f === "bi-weekly") return 14;
  if (f === "monthly") return 30;
  if (f === "bi-monthly" || f === "every two months") return 60;
  if (f === "quarterly") return 90;
  if (f === "twice yearly" || f === "bi-annual" || f === "bi-annually") return 180;
  if (f === "annual" || f === "annually" || f === "yearly") return 365;
  const match = f.match(/every\s+(\d+)\s+(day|week|month)/);
  if (match) {
    const n = parseInt(match[1], 10);
    if (match[2] === "day") return n;
    if (match[2] === "week") return n * 7;
    if (match[2] === "month") return n * 30;
  }
  return 30;
}

export function relationshipToTier(rel: string): number {
  if (rel.startsWith("1") || rel.toLowerCase().includes("inner")) return 1;
  if (rel.startsWith("2") || rel.toLowerCase().includes("active")) return 2;
  return 3;
}

export function extractSection(body: string, ...headers: string[]): string | null {
  for (const header of headers) {
    // No 'm' flag — $ matches end-of-string only, preventing premature stop
    // on blank lines after the section header.
    const regex = new RegExp(
      `(?:^|\\n)##\\s+${header}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
      "i"
    );
    const match = body.match(regex);
    if (match) return match[1].trim() || null;
  }
  return null;
}

export function parseInteractionLog(body: string, contactId: string): InteractionRow[] {
  const logSection = extractSection(body, "Interaction Log");
  if (!logSection) return [];

  const rows: InteractionRow[] = [];
  const entries = logSection
    .split(/(?=^###\s)/m)
    .filter((e) => e.trim() && !e.trim().startsWith("<!--"));

  for (const entry of entries) {
    const lines = entry.trim().split("\n");
    const header = lines[0].replace(/^###\s*/, "").trim();
    const content = lines.slice(1).join("\n").trim();
    if (!content) continue;

    const dateMatch = header.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const date = dateMatch[1];

    const notesOnly = content
      .replace(/\*\*Follow-ups:\*\*[\s\S]*?(?=\n\n|\n###|$)/m, "")
      .trim();
    if (!notesOnly) continue;

    rows.push({
      id: `${contactId}_${date}_${rows.length}`,
      contact_id: contactId,
      notes: notesOnly,
      date,
      created_at: `${date}T00:00:00.000Z`,
    });
  }

  return rows;
}

export function parseFollowUps(body: string, contactId: string): FollowUpRow[] {
  const rows: FollowUpRow[] = [];
  // No 'm' flag — $ must match end-of-string so the lazy capture isn't
  // cut short at every end-of-line.
  const followUpRegex = /\*\*Follow-ups:\*\*\n([\s\S]*?)(?=\n\n###|\n\n##|$)/g;
  let match;

  while ((match = followUpRegex.exec(body)) !== null) {
    const block = match[1];
    const items = block.match(/^[-*]\s+(.+)$/gm);
    if (!items) continue;
    for (const item of items) {
      const raw = item.replace(/^[-*]\s+/, "").trim();
      const completed = raw.startsWith("~~") && raw.endsWith("~~");
      const text = completed ? raw.slice(2, -2).trim() : raw;
      if (!text) continue;
      rows.push({
        id: `fu_${contactId}_${rows.length}`,
        contact_id: contactId,
        text,
        completed,
        created_at: new Date().toISOString(),
      });
    }
  }

  return rows;
}

export function extractPhone(body: string): string | null {
  const waMatch = body.match(/wa\.me\/(\d+)/);
  if (waMatch) return waMatch[1];
  const phoneMatch = body.match(/(?:\+44|07)\d{9,10}/);
  if (phoneMatch) return phoneMatch[0].replace(/\s+/g, "");
  return null;
}

export function parseContactFile(
  filePath: string,
  defaultTier: number
): { contact: ContactRow; followUps: FollowUpRow[]; interactions: InteractionRow[] } {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data: fm, content } = matter(raw);

  const name: string = fm.name ?? filePath.replace(/.*[\\/]/, "").replace(".md", "");
  const id = slugify(name);
  const frequency: string = fm.frequency ?? "Monthly";
  const tierFromFm = fm.relationship ? relationshipToTier(fm.relationship) : defaultTier;

  let social_battery_cost: string | null = null;
  if (fm.social_battery) {
    const sb = String(fm.social_battery);
    social_battery_cost = sb.charAt(0).toUpperCase() + sb.slice(1).toLowerCase();
  }

  const origin_story = extractSection(content, "How We Met", "Background", "Role & Context");
  const special_interests = extractSection(content, "Interests & Hooks", "Interests") ?? null;
  const sensitive_topics = extractSection(content, "Sensitive Topics") ?? null;
  const preferred_channel = fm.preferred_channel ? String(fm.preferred_channel) : null;
  const birthday = fm.birthday ? String(fm.birthday) : null;
  const whatsapp_capture: "enabled" | "disabled" =
    fm.whatsapp_capture === "enabled" ? "enabled" : "disabled";

  const notesSection = extractSection(content, "Notes", "Family");

  return {
    contact: {
      id,
      name,
      tier: tierFromFm,
      frequency,
      frequency_days: frequencyToDays(frequency),
      last_contact: fm.last_contact ? String(fm.last_contact) : null,
      next_action: fm.next_action ? String(fm.next_action) : null,
      social_battery_cost,
      origin_story: origin_story ?? null,
      special_interests,
      sensitive_topics,
      preferred_channel,
      birthday,
      whatsapp_capture,
      notes: notesSection ?? null,
      whatsapp: (fm.whatsapp ? String(fm.whatsapp) : null) ?? extractPhone(content),
      active: true,
    },
    followUps: parseFollowUps(content, id),
    interactions: parseInteractionLog(content, id),
  };
}

// ---------------------------------------------------------------------------
// Write helpers — patch in place without reformatting the whole file
// ---------------------------------------------------------------------------

/**
 * Update a single frontmatter field in place.
 * Uses string replacement so the rest of the file is untouched.
 */
export function setFrontmatterField(
  raw: string,
  field: string,
  value: string
): string {
  const regex = new RegExp(`^(${field}:\\s*)(.*)$`, "m");
  if (regex.test(raw)) {
    return raw.replace(regex, `$1${value}`);
  }
  // Field not present — insert it into the frontmatter block
  return raw.replace(/^---\n/, `---\n${field}: ${value}\n`);
}

/**
 * Prepend a new entry to the ## Interaction Log section (newest first).
 * Creates the section if it doesn't exist.
 *
 * entry should be a complete block, e.g.:
 *   "### 2026-04-03 — App\nThe notes here.\n"
 */
export function prependInteractionEntry(raw: string, entry: string): string {
  const header = "## Interaction Log";
  const idx = raw.indexOf(header);

  if (idx === -1) {
    return raw.trimEnd() + `\n\n## Interaction Log\n\n${entry.trim()}\n`;
  }

  const insertAt = idx + header.length;
  return raw.slice(0, insertAt) + "\n\n" + entry.trim() + "\n" + raw.slice(insertAt);
}

/**
 * Append a new follow-up bullet to the first **Follow-ups:** block found,
 * or create one at the end of the file if none exists.
 */
export function appendFollowUp(raw: string, text: string): string {
  const marker = "**Follow-ups:**";
  const idx = raw.indexOf(marker);

  if (idx !== -1) {
    const insertAt = idx + marker.length;
    return raw.slice(0, insertAt) + `\n- ${text}` + raw.slice(insertAt);
  }

  return raw.trimEnd() + `\n\n**Follow-ups:**\n- ${text}\n`;
}

/**
 * Mark a follow-up as completed by wrapping its text in ~~strikethrough~~.
 * Matches the first bullet whose text equals the given text (case-sensitive).
 */
export function completeFollowUp(raw: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^([-*]\\s+)(${escaped})$`, "m");
  return raw.replace(regex, `$1~~$2~~`);
}

/**
 * Un-mark a completed follow-up (remove strikethrough).
 */
export function uncompleteFollowUp(raw: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^([-*]\\s+)~~(${escaped})~~$`, "m");
  return raw.replace(regex, `$1$2`);
}
