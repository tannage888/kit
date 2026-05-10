import "dotenv/config";
import * as fs from "fs";
import { BrowserSession } from "./session.js";
import { LinkedInScraper } from "./scraper.js";
import { WatermarkStore } from "./watermark.js";
import { postMessages } from "./poster.js";

const GATEWAY_URL = process.env.KIT_GATEWAY_URL ?? "http://localhost:3141";
const POLL_INTERVAL_MS =
  parseInt(process.env.POLL_INTERVAL_MINUTES ?? "60", 10) * 60_000;
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS ?? "14", 10);

interface GatewayContact {
  id: string;
  name: string;
  linkedin_username: string | null;
  linkedin_capture: string;
}

async function main() {
  if (!fs.existsSync("./auth_state.json")) {
    console.error("No auth_state.json found. Run: npm run login");
    process.exit(1);
  }

  const session = new BrowserSession();
  await session.init();

  const watermarks = new WatermarkStore("./watermarks.json");
  const scraper = new LinkedInScraper(session.page);

  console.log(
    `LinkedIn daemon started — polling every ${POLL_INTERVAL_MS / 60_000} min → ${GATEWAY_URL}`
  );

  // Run immediately on start, then loop
  await runSweep(scraper, watermarks);

  setInterval(async () => {
    try {
      await runSweep(scraper, watermarks);
    } catch (err) {
      console.error("Sweep error:", err);
    }
  }, POLL_INTERVAL_MS);
}

async function runSweep(scraper: LinkedInScraper, watermarks: WatermarkStore) {
  let contacts: GatewayContact[];
  try {
    const res = await fetch(`${GATEWAY_URL}/api/contacts`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    contacts = await res.json();
  } catch (err) {
    console.error("Cannot reach Kit gateway:", err);
    return;
  }

  const tracked = contacts.filter(
    (c) => c.linkedin_username && c.linkedin_capture === "enabled"
  );

  if (tracked.length === 0) {
    console.log("No contacts with linkedin_capture=enabled — nothing to sweep.");
    return;
  }

  console.log(`\nSweeping ${tracked.length} LinkedIn contact(s)…`);

  for (const contact of tracked) {
    const defaultLookback = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const watermark = watermarks.get(contact.id) ?? defaultLookback;

    try {
      const messages = await scraper.fetchMessages(contact.linkedin_username!, watermark);

      if (messages.length === 0) {
        console.log(`  ${contact.name}: no new messages`);
        continue;
      }

      await postMessages(GATEWAY_URL, contact.id, "linkedin", messages);

      const newest = Math.max(...messages.map((m) => m.timestamp));
      watermarks.set(contact.id, newest);

      console.log(`  ✓ ${contact.name}: ${messages.length} messages buffered`);
    } catch (err) {
      console.error(`  ✗ ${contact.name}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
