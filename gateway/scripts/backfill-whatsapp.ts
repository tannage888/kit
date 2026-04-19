/**
 * One-off script: copy whatsapp numbers from kit.contacts → People/*.md frontmatter.
 * Run from gateway/ with: npx tsx --env-file=.env scripts/backfill-whatsapp.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { setFrontmatterField } from "../src/utils/markdown.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PEOPLE_DIR = path.resolve(__dirname, "..", "..", "People");

const TIER_DIRS = ["1 - Inner Circle", "2 - Active", "3 - Business Contact"];

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
}

const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_KEY"));

// Build name → filePath map from all People/*.md files
function buildFileMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const dir of TIER_DIRS) {
    const tierPath = path.join(PEOPLE_DIR, dir);
    if (!fs.existsSync(tierPath)) continue;
    for (const file of fs.readdirSync(tierPath)) {
      if (!file.endsWith(".md")) continue;
      const name = file.replace(/\.md$/, "");
      map.set(name.toLowerCase(), path.join(tierPath, file));
    }
  }
  return map;
}

async function main() {
  const { data, error } = await supabase
    .schema("kit")
    .from("contacts")
    .select("name, whatsapp")
    .not("whatsapp", "is", null);

  if (error) {
    // Fallback: table may still be in public schema
    const { data: pub, error: pubErr } = await supabase
      .from("contacts")
      .select("name, whatsapp")
      .not("whatsapp", "is", null);
    if (pubErr) throw new Error(`DB query failed: ${pubErr.message}`);
    return run(pub as { name: string; whatsapp: string }[]);
  }
  return run(data as { name: string; whatsapp: string }[]);
}

async function run(contacts: { name: string; whatsapp: string }[]) {
  const fileMap = buildFileMap();
  let updated = 0;
  let missing = 0;

  for (const { name, whatsapp } of contacts) {
    const filePath = fileMap.get(name.toLowerCase());
    if (!filePath) {
      console.log(`  ⚠️  No file found for "${name}"`);
      missing++;
      continue;
    }

    const raw = fs.readFileSync(filePath, "utf-8");

    // Skip if already has correct value
    if (raw.includes(`whatsapp: "${whatsapp}"`) || raw.includes(`whatsapp: ${whatsapp}`)) {
      console.log(`  ✓  ${name} — already set`);
      continue;
    }

    const updated_raw = setFrontmatterField(raw, "whatsapp", `"${whatsapp}"`);
    fs.writeFileSync(filePath, updated_raw, "utf-8");
    console.log(`  ✅ ${name} → ${whatsapp}`);
    updated++;
  }

  console.log(`\nDone. ${updated} files updated, ${missing} contacts had no matching file.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
