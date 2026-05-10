/**
 * First-time Instagram authentication.
 * Opens a headed Chromium window, navigates to Instagram login,
 * waits for the user to complete login, then saves the session.
 *
 * Run: npm run login
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as readline from "readline";

async function main() {
  if (fs.existsSync("./auth_state.json")) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>((resolve) => {
      rl.question("auth_state.json already exists. Overwrite? (y/N) ", (ans) => {
        rl.close();
        if (ans.toLowerCase() !== "y") {
          console.log("Aborted.");
          process.exit(0);
        }
        resolve();
      });
    });
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" });

  console.log("\n===========================================");
  console.log(" Instagram daemon — first-time setup");
  console.log("===========================================");
  console.log(" Log in to Instagram in the browser window.");
  console.log(" Complete any 2FA or verification steps.");
  console.log(" Then come back here and press Enter.");
  console.log("===========================================\n");

  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Press Enter when logged in → ", () => {
      rl.close();
      resolve();
    });
  });

  const url = page.url();
  if (url.includes("/login") || url.includes("/accounts/login")) {
    console.error("Still on login page — not logged in. Try again.");
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: "./auth_state.json" });
  console.log("✅ Session saved to auth_state.json");
  console.log("   Run `npm run start` (or pm2 start) to begin polling.");

  await browser.close();
}

main().catch((err) => {
  console.error("Login failed:", err);
  process.exit(1);
});
