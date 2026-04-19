/**
 * One-off: remove the redundant "## At a Glance" section from all People/*.md files.
 * Run from gateway/: npx tsx scripts/remove-at-a-glance.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PEOPLE_DIR = path.resolve(__dirname, "..", "..", "People");
const TIER_DIRS = ["1 - Inner Circle", "2 - Active", "3 - Business Contact"];

function removeAtAGlance(raw: string): string {
  // Remove the ## At a Glance block: from the header to the blank line before the next ##
  return raw.replace(/\n*^## At a Glance\n[\s\S]*?(?=\n^## |\n*$(?![\s\S]))/m, "");
}

let updated = 0;
let skipped = 0;

for (const dir of TIER_DIRS) {
  const tierPath = path.join(PEOPLE_DIR, dir);
  if (!fs.existsSync(tierPath)) continue;

  for (const file of fs.readdirSync(tierPath).filter(f => f.endsWith(".md"))) {
    const filePath = path.join(tierPath, file);
    const raw = fs.readFileSync(filePath, "utf-8");

    if (!raw.includes("## At a Glance")) {
      skipped++;
      continue;
    }

    const result = removeAtAGlance(raw);
    fs.writeFileSync(filePath, result, "utf-8");
    console.log(`  ✅ ${file}`);
    updated++;
  }
}

console.log(`\nDone. ${updated} files updated, ${skipped} had no At a Glance section.`);
