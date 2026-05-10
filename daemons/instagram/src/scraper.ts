/**
 * Instagram DM scraper using Playwright.
 *
 * Flow per contact:
 *   1. Navigate to their profile (instagram.com/{handle})
 *   2. Click the "Message" button → opens DM thread
 *   3. Scroll up to load messages back to the watermark
 *   4. Extract messages newer than sinceMs
 *
 * SELECTOR STABILITY NOTE:
 * Instagram's class names are hashed and change with each deploy.
 * Selectors marked "FRAGILE" below may need updating if scraping breaks.
 * Use aria-label / role / data-testid selectors where available.
 */

import { Page } from "playwright";
import type { ScrapedMessage } from "./poster.js";

const NAV_TIMEOUT = 30_000;
const WAIT_TIMEOUT = 12_000;
const SCROLL_PAUSE_MS = 1_500;
const MAX_SCROLL_ATTEMPTS = 15;

export class InstagramScraper {
  constructor(private page: Page) {}

  async fetchMessages(instagramUsername: string, sinceMs: number): Promise<ScrapedMessage[]> {
    // Strip leading @ if present
    const handle = instagramUsername.replace(/^@/, "");

    await this.page.goto(`https://www.instagram.com/${encodeURIComponent(handle)}/`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });

    const url = this.page.url();
    if (url.includes("/accounts/login") || url.includes("/challenge")) {
      throw new Error("Instagram session expired — run: npm run login");
    }

    // Profile may not exist or be private
    if (url.includes("/404") || !(await this.page.locator("main").isVisible({ timeout: 3_000 }).catch(() => false))) {
      console.warn(`  Profile not found: ${handle}`);
      return [];
    }

    // Click the Message button on their profile
    const opened = await this.clickMessageButton();
    if (!opened) {
      console.warn(`  Cannot open DM with ${handle} (private account or not following?)`);
      return [];
    }

    // Wait for the DM thread to load
    const ready = await this.waitForThread();
    if (!ready) return [];

    // Scroll up to load messages back to sinceMs
    await this.scrollToWatermark(sinceMs);

    // Extract messages
    return this.extractMessages(sinceMs);
  }

  // ── Step 2: click Message button ──────────────────────────

  private async clickMessageButton(): Promise<boolean> {
    // Primary: button with aria-label "Message" or role="link" with text
    const ariaBtn = this.page.locator('[aria-label="Message"]').first();
    if (await ariaBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await ariaBtn.click();
      return true;
    }

    // Fallback: any button with text "Message" on the page
    const textBtn = this.page.getByRole("link", { name: "Message" }).first();
    if (await textBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await textBtn.click();
      return true;
    }

    // Fallback 2: button element with text "Message"
    const btn = this.page.getByRole("button", { name: "Message" }).first();
    if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await btn.click();
      return true;
    }

    return false;
  }

  // ── Step 3: wait for thread UI ────────────────────────────

  private async waitForThread(): Promise<boolean> {
    try {
      await Promise.race([
        // URL changes to /direct/t/{threadId}/
        this.page.waitForURL(/\/direct\/t\//, { timeout: WAIT_TIMEOUT }),
        // Or a message input becomes visible
        this.page.waitForSelector('[aria-label="Message"]', { timeout: WAIT_TIMEOUT }),
        // FRAGILE: look for the message list container
        this.page.waitForSelector('[role="listbox"], [role="log"]', { timeout: WAIT_TIMEOUT }),
      ]);

      // Give the thread content a moment to render
      await this.page.waitForTimeout(1_500);
      return true;
    } catch {
      return false;
    }
  }

  // ── Step 4: scroll to load older messages ─────────────────

  private async scrollToWatermark(sinceMs: number): Promise<void> {
    // Instagram DMs: the message container scrolls; scrollTop = 0 loads older messages.
    // FRAGILE: container selector
    const containerSelectors = [
      '[role="log"]',
      '[role="listbox"]',
      // Hashed class fallback — try the main scrollable region
      "main [style*='overflow']",
    ];

    let container = null;
    for (const sel of containerSelectors) {
      const el = this.page.locator(sel).first();
      if (await el.isVisible({ timeout: 2_000 }).catch(() => false)) {
        container = el;
        break;
      }
    }

    if (!container) return;

    for (let i = 0; i < MAX_SCROLL_ATTEMPTS; i++) {
      const oldest = await this.getOldestVisibleTimestamp();
      if (oldest !== null && oldest <= sinceMs) break;

      await container.evaluate((el) => (el.scrollTop = 0));
      await this.page.waitForTimeout(SCROLL_PAUSE_MS);
    }
  }

  private async getOldestVisibleTimestamp(): Promise<number | null> {
    return this.page.evaluate(() => {
      const times = document.querySelectorAll("time[datetime]");
      if (!times.length) return null;
      const first = times[0].getAttribute("datetime");
      return first ? new Date(first).getTime() : null;
    });
  }

  // ── Step 5: extract messages ──────────────────────────────

  private async extractMessages(sinceMs: number): Promise<ScrapedMessage[]> {
    return this.page.evaluate((sinceMs) => {
      const results: Array<{ fromMe: boolean; body: string; timestamp: number; messageId: string }> = [];

      /**
       * Strategy: find all <time datetime="..."> elements and walk up to the message bubble.
       * Instagram's class names are hashed, so we use position/aria to determine fromMe.
       *
       * FRAGILE: fall back to walking siblings if time elements aren't found.
       */
      const timeEls = document.querySelectorAll<HTMLElement>("time[datetime]");

      // If no time elements, try to scrape visible message bubbles by structure
      const targets: HTMLElement[] = timeEls.length > 0
        ? Array.from(timeEls)
        : [];

      targets.forEach((timeEl) => {
        const datetimeAttr = timeEl.getAttribute("datetime");
        if (!datetimeAttr) return;

        const timestamp = new Date(datetimeAttr).getTime();
        if (isNaN(timestamp) || timestamp <= sinceMs) return;

        // Walk up from <time> to find the message text
        let node: HTMLElement | null = timeEl.parentElement;
        let body = "";
        let fromMe = false;

        for (let depth = 0; depth < 10 && node; depth++) {
          // Look for a span or div with text that isn't UI chrome
          const textEl = node.querySelector("span[dir], p, [role='none'] span") ??
            node.querySelector("span");

          const candidate = textEl?.textContent?.trim() ?? "";
          if (candidate && candidate.length > 1 && !candidate.match(/^\d+:\d+/)) {
            body = candidate;
          }

          // Instagram: sent messages are right-aligned (justify-content or margin-left)
          const style = window.getComputedStyle(node);
          const justifyContent = style.justifyContent;
          const marginLeft = style.marginLeft;
          const flexDirection = style.flexDirection;

          if (
            justifyContent === "flex-end" ||
            marginLeft === "auto" ||
            node.getAttribute("aria-label")?.toLowerCase().includes("you sent")
          ) {
            fromMe = true;
          }

          if (body) break;
          node = node.parentElement;
        }

        if (!body) return;

        const fingerprint = body.slice(0, 30).replace(/\s+/g, "_");
        const messageId = `ig_${timestamp}_${fingerprint}`;
        results.push({ fromMe, body, timestamp, messageId });
      });

      // Deduplicate
      const seen = new Set<string>();
      return results.filter((m) => {
        if (seen.has(m.messageId)) return false;
        seen.add(m.messageId);
        return true;
      });
    }, sinceMs);
  }
}
