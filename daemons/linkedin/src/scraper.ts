/**
 * LinkedIn DM scraper using Playwright.
 *
 * Flow per contact:
 *   1. Navigate to their profile (linkedin.com/in/{slug})
 *   2. Click the "Message" button → thread opens
 *   3. Scroll up to load messages back to the watermark
 *   4. Extract messages newer than sinceMs
 *
 * SELECTOR STABILITY NOTE:
 * LinkedIn obfuscates class names and changes them periodically.
 * Selectors marked "FRAGILE" below may need updating if scraping breaks.
 * Prefer aria-label / role selectors where possible — they change less often.
 */

import { Page } from "playwright";
import type { ScrapedMessage } from "./poster.js";

const NAV_TIMEOUT = 30_000;
const WAIT_TIMEOUT = 12_000;
const SCROLL_PAUSE_MS = 1_500;
const MAX_SCROLL_ATTEMPTS = 15;

export class LinkedInScraper {
  constructor(private page: Page) {}

  async fetchMessages(linkedinUsername: string, sinceMs: number): Promise<ScrapedMessage[]> {
    await this.page.goto(`https://www.linkedin.com/in/${encodeURIComponent(linkedinUsername)}/`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });

    const url = this.page.url();
    if (url.includes("/login") || url.includes("/authwall") || url.includes("/checkpoint")) {
      throw new Error("LinkedIn session expired — run: npm run login");
    }

    // Contact not found or profile hidden
    if (url.includes("/404") || url.includes("unavailable")) {
      console.warn(`  Profile not found: ${linkedinUsername}`);
      return [];
    }

    // Open the message thread via the Message button on the profile
    const opened = await this.clickMessageButton();
    if (!opened) {
      console.warn(`  No message thread with ${linkedinUsername} (not a connection?)`);
      return [];
    }

    // Wait for the thread to load — LinkedIn may navigate or open a modal
    const onThread = await this.waitForThread();
    if (!onThread) return [];

    // Scroll up to load messages back to sinceMs
    await this.scrollToWatermark(sinceMs);

    // Extract and return messages newer than sinceMs
    return this.extractMessages(sinceMs);
  }

  // ── Step 2: click Message button ──────────────────────────

  private async clickMessageButton(): Promise<boolean> {
    // Primary: button with aria-label containing "Message" (most stable)
    const ariaBtn = this.page.locator('[aria-label*="Message"]').first();
    if (await ariaBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await ariaBtn.click();
      return true;
    }

    // Fallback 1: anchor with href containing /messaging/new (FRAGILE)
    const anchorBtn = this.page.locator('a[href*="/messaging/new"]').first();
    if (await anchorBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await anchorBtn.click();
      return true;
    }

    // Fallback 2: any visible element with exact text "Message"
    const textBtn = this.page.getByRole("button", { name: "Message" }).first();
    if (await textBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await textBtn.click();
      return true;
    }

    return false;
  }

  // ── Step 3: wait for thread to be ready ───────────────────

  private async waitForThread(): Promise<boolean> {
    // LinkedIn either navigates to /messaging/thread/… or opens a modal
    try {
      await Promise.race([
        this.page.waitForURL(/\/messaging\/thread\//, { timeout: WAIT_TIMEOUT }),
        this.page.waitForSelector('[data-testid="messaging-overlay"]', { timeout: WAIT_TIMEOUT }),
        // FRAGILE: class-based selectors below
        this.page.waitForSelector(".msg-s-message-list", { timeout: WAIT_TIMEOUT }),
        this.page.waitForSelector('[role="log"]', { timeout: WAIT_TIMEOUT }),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  // ── Step 4: scroll up to load messages before watermark ───

  private async scrollToWatermark(sinceMs: number): Promise<void> {
    // The message container is a scrollable element — scroll to the top to load older messages.
    // FRAGILE: selector may change.
    const containerSelectors = [
      ".msg-s-message-list",
      '[role="log"]',
      ".msg-conversations-content-container",
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

      // Scroll to the top of the message list to trigger loading older messages
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
       * Try a few selector strategies for message elements.
       * FRAGILE: these class names change with LinkedIn deploys.
       * The most stable approach is to find all <time datetime="..."> elements
       * and walk up to the containing message bubble.
       */
      const timeEls = document.querySelectorAll<HTMLElement>("time[datetime]");

      timeEls.forEach((timeEl, idx) => {
        const datetimeAttr = timeEl.getAttribute("datetime");
        if (!datetimeAttr) return;

        const timestamp = new Date(datetimeAttr).getTime();
        if (isNaN(timestamp) || timestamp <= sinceMs) return;

        // Walk up from the <time> to find the message text container
        let node: HTMLElement | null = timeEl.parentElement;
        let body = "";
        let fromMe = false;

        for (let depth = 0; depth < 8 && node; depth++) {
          // Look for text content in a sibling or cousin element
          const textEl =
            node.querySelector("[class*='body'], [class*='content'], [class*='message-text'], p") ??
            node.querySelector("p");

          if (textEl?.textContent?.trim()) {
            body = textEl.textContent.trim();
          }

          // LinkedIn adds "outgoing" to sent messages (FRAGILE)
          if (
            node.className.includes("outgoing") ||
            node.className.includes("from-me") ||
            node.getAttribute("data-from-me") === "true"
          ) {
            fromMe = true;
          }

          // Also check if this node is in the right side of the flex container
          // as a heuristic (sent messages are right-aligned)
          const style = window.getComputedStyle(node);
          if (style.alignSelf === "flex-end" || style.marginLeft === "auto") {
            fromMe = true;
          }

          if (body) break;
          node = node.parentElement;
        }

        if (!body) return;

        // Deterministic ID: channel prefix + epoch ms + content fingerprint
        const fingerprint = body.slice(0, 30).replace(/\s+/g, "_");
        const messageId = `li_${timestamp}_${fingerprint}`;

        results.push({ fromMe, body, timestamp, messageId });
      });

      // Deduplicate by messageId (same message may appear under multiple time elements)
      const seen = new Set<string>();
      return results.filter((m) => {
        if (seen.has(m.messageId)) return false;
        seen.add(m.messageId);
        return true;
      });
    }, sinceMs);
  }
}
