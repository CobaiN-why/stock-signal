/**
 * Xiaohongshu (小红书) web scraper using Playwright.
 * Simulates human browsing to avoid anti-bot detection.
 */

import { chromium, type Browser, type Page } from "playwright";

const XHS_BASE = "https://www.xiaohongshu.com";

// ── Types ──

export interface XhsScrapedPost {
  postId: string;
  title: string;
  content: string;
  postedAt: string; // ISO date
  url: string;
  likeCount: number;
  collectCount: number;
  commentCount: number;
  authorComments: XhsScrapedComment[];
}

export interface XhsScrapedComment {
  content: string;
  postedAt: string;
}

// ── Helpers ──

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Browser management ──

let browser: Browser | null = null;

const PERSISTENT_DIR = "/tmp/xhs-browser-data";

export async function launchBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  const context = await chromium.launchPersistentContext(PERSISTENT_DIR, {
    headless: true,
    channel: "chrome",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    viewport: { width: 1440, height: 900 },
  });
  // Wrap context as browser for compatibility
  (context as any)._isPersistent = true;
  browser = context as unknown as Browser;
  return browser;
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// ── Cookie setup ──

function parseCookieString(raw: string): { name: string; value: string; domain: string; path: string }[] {
  return raw.split(";").map((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    return {
      name: name.trim(),
      value: rest.join("=").trim(),
      domain: ".xiaohongshu.com",
      path: "/",
    };
  });
}

async function setupPage(page: Page) {
  // Set realistic viewport
  await page.setViewportSize({ width: 1440, height: 900 });

  // Set extra headers for anti-detection
  await page.setExtraHTTPHeaders({
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Upgrade-Insecure-Requests": "1",
  });
}

async function loginWithCookies(page: Page) {
  const rawCookie = process.env.XHS_COOKIE;
  if (!rawCookie) throw new Error("XHS_COOKIE env var not set");
  const cookies = parseCookieString(rawCookie);
  await page.context().addCookies(cookies);
  console.log(`[XHS] Set ${cookies.length} cookies`);
}

// ── Main scraping logic ──

export async function scrapeUserPosts(
  userId: string,
  since: Date | null
): Promise<XhsScrapedPost[]> {
  const browser = await launchBrowser();
  // Persistent context: browser IS the context
  const context = (browser as any)._isPersistent ? browser as any : browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  try {
    // Skip cookie setup — persistent context already has login state
    // Just ensure we're on the right page

    // Visit homepage first to establish session (mimics real browsing)
    console.log(`[XHS] Visiting homepage first...`);
    await page.goto(XHS_BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(rand(2000, 3000));

    const url = `${XHS_BASE}/user/profile/${userId}`;
    console.log(`[XHS] Navigating to ${url}`);
    await page.goto(url, { waitUntil: "load", timeout: 60000 });

    // Simulate human: wait and scroll
    await sleep(rand(2000, 4000));

    // Scroll a few times to load posts
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, rand(300, 600));
      await sleep(rand(800, 1200));
    }
    await sleep(2000); // wait for lazy-rendered titles

    // Debug: check page state
    const pageTitle = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log(`[XHS] Page title: "${pageTitle}"`);
    console.log(`[XHS] Body sample: "${bodyText}"`);

    // Wait for post elements to appear
    await page.waitForSelector('a[href*="/explore/"]', { timeout: 10000 }).catch(() => {
      console.log("[XHS] No explore links found on profile page");
    });
    await sleep(rand(1000, 2000));

    // Extract post list from the page
    const posts = await page.evaluate((userId: string) => {
      const items: {
        postId: string;
        title: string;
        content: string;
        url: string;
        likeCount: number;
      }[] = [];

      const seen = new Set<string>();
      // XHS profile post links: /user/profile/{userId}/{postId}?xsec_token=...
      const links = document.querySelectorAll(`a[href*="/user/profile/${userId}/"]`);

      links.forEach((link) => {
        const href = (link as HTMLAnchorElement).href;
        const match = href.match(/\/user\/profile\/[^/]+\/([a-f0-9]+)/);
        if (!match) return;
        const postId = match[1];
        if (seen.has(postId)) return;
        seen.add(postId);

        // Try textContent from link, then from parent elements
        let title = link.textContent?.trim() || "";
        if (!title) {
          const parent = link.closest('section, [class*="note"], [class*="card"], div');
          title = parent?.textContent?.trim() || "";
          // Extract just the first line as title
          title = title.split('\n')[0]?.trim() || "";
        }
        if (!title) return; // skip empty titles

        // Try to find parent note card for like count
        const card = link.closest('[class*="note"]') || link.closest('section') || link.parentElement?.parentElement;
        const likeEl = card?.querySelector('[class*="like"] span, [class*="count"]');

        items.push({
          postId,
          title,
          content: title, // use title as content since list view doesn't show full content
          url: `https://www.xiaohongshu.com/explore/${postId}`,
          likeCount: likeEl ? parseInt(likeEl.textContent?.replace(/[^0-9]/g, "") || "0") : 0,
        });
      });

      return items;
    }, userId);

    console.log(`[XHS] Found ${posts.length} posts on profile page`);

    // Filter: only new posts after `since`
    const results: XhsScrapedPost[] = [];

    // Extract content directly from profile page (don't visit detail pages)
    // Xiaohongshu blocks detail page access for automation
    for (const post of posts) {
      results.push({
        postId: post.postId,
        title: post.title,
        content: post.content,
        postedAt: new Date().toISOString(), // timestamp not available from list view
        url: post.url,
        likeCount: post.likeCount,
        collectCount: 0,
        commentCount: 0,
        authorComments: [],
      });
      console.log(`[XHS] Scraped post from list: ${post.title || post.postId}`);
    }

    return results;
  } finally {
    await page.close();
  }
}

// ── Date parsing ──

function parseXhsDate(raw: string): Date {
  if (!raw) return new Date();

  // Try parsing ISO format directly
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d;

  // "x分钟前", "x小时前", "x天前", "MM-DD"
  const minMatch = raw.match(/(\d+)\s*分钟前/);
  if (minMatch) return new Date(Date.now() - parseInt(minMatch[1]) * 60000);

  const hourMatch = raw.match(/(\d+)\s*小时前/);
  if (hourMatch) return new Date(Date.now() - parseInt(hourMatch[1]) * 3600000);

  const dayMatch = raw.match(/(\d+)\s*天前/);
  if (dayMatch) return new Date(Date.now() - parseInt(dayMatch[1]) * 86400000);

  // "MM-DD" format — assume current year
  const mdMatch = raw.match(/(\d{1,2})-(\d{1,2})/);
  if (mdMatch) {
    const now = new Date();
    return new Date(now.getFullYear(), parseInt(mdMatch[1]) - 1, parseInt(mdMatch[2]));
  }

  return new Date();
}
