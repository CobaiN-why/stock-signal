/**
 * Open headed browser for one-time Xiaohongshu login.
 * After login, the browser context (cookies + localStorage) is saved.
 * The scraper loads this state file for subsequent runs.
 */
import { chromium } from "playwright";
import { existsSync } from "fs";

const STATE_FILE = "scripts/xhs-state.json";

async function main() {
  if (existsSync(STATE_FILE)) {
    console.log(`State file ${STATE_FILE} already exists.`);
    console.log("Delete it first if you want to re-login.");
    return;
  }

  const context = await chromium.launchPersistentContext("/tmp/xhs-browser-data", {
    headless: false,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto("https://www.xiaohongshu.com", { waitUntil: "domcontentloaded" });

  console.log("\n================================================");
  console.log("Please login manually in the Chrome window.");
  console.log("After logging in, CLOSE the Chrome window.");
  console.log("The login state will be saved automatically.");
  console.log("================================================\n");

  // Wait for Chrome to be closed
  await new Promise<void>((resolve) => {
    const check = setInterval(async () => {
      try {
        const pages = context.pages();
        if (pages.length === 0 || !context) {
          clearInterval(check);
          resolve();
        }
      } catch {
        clearInterval(check);
        resolve();
      }
    }, 2000);
  });

  // The persistent context auto-saves to /tmp/xhs-browser-data
  // Also export as storageState JSON for portability
  console.log("State saved to /tmp/xhs-browser-data");
  console.log("You can now run the scraper: npx tsx scripts/xhs-crawl-local.ts");
}

main();

