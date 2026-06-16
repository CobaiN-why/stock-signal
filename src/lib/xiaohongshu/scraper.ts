/**
 * Xiaohongshu scraper — API interception approach.
 * Intercepts user_posted API responses to get posts (title, time, likes).
 * Detail pages and comments are blocked by XHS anti-bot.
 */

import { chromium, type Browser, type Page } from "playwright";

// ── Types ──

export interface XhsScrapedPost {
  postId: string;
  title: string;
  postedAt: string;
  url: string;
  likeCount: number;
  collectCount: number;
  commentCount: number;
}

interface XhsApiNote {
  note_id: string;
  display_title: string;
  type: string;
  xsec_token: string;
  interact_info?: {
    liked_count?: string;
    collected_count?: string;
    comment_count?: string;
    share_count?: string;
  };
  cover?: {
    url_default?: string;
    url_pre?: string;
  };
}

// ── Helpers ──

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/** Extract timestamp from cover image URL like /202606101843/ */
function extractTimeFromUrl(note: XhsApiNote): string | null {
  const url = note.cover?.url_default || note.cover?.url_pre || "";
  const m = url.match(/\/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\//);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`;
  return null;
}

// ── Browser ──

const PERSISTENT_DIR = "/tmp/xhs-browser-data";
let browser: Browser | null = null;

async function launchBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  const ctx = await chromium.launchPersistentContext(PERSISTENT_DIR, {
    headless: true, channel: "chrome",
    viewport: { width: 1440, height: 900 },
    args: ["--no-sandbox","--disable-blink-features=AutomationControlled","--disable-dev-shm-usage"],
  });
  (ctx as any)._isPersistent = true;
  browser = ctx as unknown as Browser;
  return browser;
}

export async function closeBrowser() {
  if (browser) { await browser.close(); browser = null; }
}

// ── Main scraping logic ──

export async function scrapeUserPosts(
  userId: string,
  since: Date | null
): Promise<XhsScrapedPost[]> {
  const b = await launchBrowser();
  const page = (b as any).pages()[0] || await (b as any).newPage();

  // Intercept API responses
  const allNotes: XhsApiNote[] = [];
  let hasMore = true;

  page.on("response", async (resp: any) => {
    const url = resp.url();
    if (url.includes("user_posted") && url.includes("user_id=" + userId)) {
      try {
        const body = await resp.text();
        const d = JSON.parse(body);
        if (d.data?.notes) {
          for (const n of d.data.notes) {
            if (!allNotes.some(e => e.note_id === n.note_id)) {
              allNotes.push(n as XhsApiNote);
            }
          }
          hasMore = d.data.has_more;
        }
      } catch {}
    }
  });

  try {
    await page.goto("https://www.xiaohongshu.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(rand(2000, 3000));
    await page.goto(`https://www.xiaohongshu.com/user/profile/${userId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(rand(3000, 5000));

    // Scroll to trigger pagination
    for (let p = 0; p < 12; p++) {
      await page.mouse.wheel(0, rand(400, 700));
      await sleep(rand(1500, 2500));
      if (!hasMore && allNotes.length > 30) break;
    }
    await sleep(3000);

    // Process results
    const results: XhsScrapedPost[] = [];
    const sinceTs = since?.getTime() || 0;

    for (const note of allNotes) {
      const time = extractTimeFromUrl(note);
      const postedAt = time || new Date().toISOString();

      // Stop if older than since
      if (sinceTs && time) {
        const ts = new Date(time).getTime();
        if (ts <= sinceTs) continue;
      }

      const likes = parseInt(note.interact_info?.liked_count || "0", 10) || 0;
      const collects = parseInt(note.interact_info?.collected_count || "0", 10) || 0;
      const comments = parseInt(note.interact_info?.comment_count || "0", 10) || 0;

      results.push({
        postId: note.note_id,
        title: note.display_title || "",
        postedAt,
        url: `https://www.xiaohongshu.com/explore/${note.note_id}`,
        likeCount: likes,
        collectCount: collects,
        commentCount: comments,
      });
    }

    console.log(`[XHS] Scraped ${results.length} new posts (total API notes: ${allNotes.length})`);
    return results;
  } finally {
    if ((b as any)._isPersistent) {
      await (b as any).close();
      browser = null;
    }
  }
}
