import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const AUTH_PATH = "./auth_state.json";

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  page!: Page;

  async init(headless?: boolean): Promise<void> {
    const hasAuth = fs.existsSync(AUTH_PATH);
    const runHeadless = headless ?? hasAuth;

    this.browser = await chromium.launch({ headless: runHeadless });

    this.context = hasAuth
      ? await this.browser.newContext({ storageState: AUTH_PATH })
      : await this.browser.newContext({ viewport: { width: 1280, height: 900 } });

    this.page = await this.context.newPage();
  }

  async saveState(): Promise<void> {
    if (!this.context) return;
    const dir = path.dirname(AUTH_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await this.context.storageState({ path: AUTH_PATH });
    console.log(`Auth state saved to ${AUTH_PATH}`);
  }

  async isLoggedIn(profileUrl: string): Promise<boolean> {
    await this.page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const url = this.page.url();
    return !url.includes("/login") && !url.includes("/authwall") && !url.includes("/checkpoint");
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }
}
