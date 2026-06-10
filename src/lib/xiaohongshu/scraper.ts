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

export async function launchBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    channel: "chrome",  // use system Chrome, no need to download Chromium
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });
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
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = await context.newPage();

  try {
    await setupPage(page);
    await loginWithCookies(page);

    const url = `${XHS_BASE}/user/profile/${userId}`;
    console.log(`[XHS] Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Simulate human: wait and scroll
    await sleep(rand(2000, 4000));

    // Scroll a few times to load posts
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, rand(300, 600));
      await sleep(rand(800, 1500));
    }

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
    const posts = await page.evaluate(() => {
      const items: {
        postId: string;
        title: string;
        content: string;
        url: string;
        likeCount: number;
      }[] = [];

      // Find all post links on the profile page
      const links = document.querySelectorAll('a[href*="/explore/"]');
      const seen = new Set<string>();

      links.forEach((link) => {
        const href = (link as HTMLAnchorElement).href;
        const match = href.match(/\/explore\/([a-f0-9]+)/);
        if (!match) return;
        const postId = match[1];
        if (seen.has(postId)) return;
        seen.add(postId);

        // Try to find parent note card for title/content
        const card = link.closest('[class*="note"]') || link.closest('[class*="card"]') || link.parentElement;
        const title = card?.querySelector('[class*="title"]')?.textContent?.trim() || "";
        const desc = card?.querySelector('[class*="desc"]')?.textContent?.trim() || "";
        const likeEl = card?.querySelector('[class*="like"] span, [class*="count"]');

        items.push({
          postId,
          title,
          content: desc || title,
          url: href,
          likeCount: likeEl ? parseInt(likeEl.textContent?.replace(/[^0-9]/g, "") || "0") : 0,
        });
      });

      return items;
    });

    console.log(`[XHS] Found ${posts.length} posts on profile page`);

    // Filter: only new posts after `since`
    const results: XhsScrapedPost[] = [];

    for (const post of posts) {
      // Visit each post detail page to get full content + timestamp + author comments
      await sleep(rand(1500, 3000));

      try {
        await page.goto(post.url, { waitUntil: "networkidle", timeout: 20000 });
        await sleep(rand(1000, 2000));

        // Extract detailed post info
        const detail = await page.evaluate(() => {
          // Title
          const titleEl = document.querySelector('[class*="title"], #detail-title');
          const title = titleEl?.textContent?.trim() || "";

          // Content body
          const descEl = document.querySelector('[class*="desc"], #detail-desc, [class*="note-text"]');
          const content = descEl?.textContent?.trim() || "";

          // Date
          const dateEl = document.querySelector('[class*="date"], [class*="time"], time');
          const dateStr = dateEl?.textContent?.trim() || dateEl?.getAttribute("datetime") || "";

          // Stats
          const likeEl = document.querySelector('[class*="like"] span, [class*="like-count"]');
          const collectEl = document.querySelector('[class*="collect"] span, [class*="collect-count"]');
          const commentEl = document.querySelector('[class*="comment"] span, [class*="comment-count"]');
          const likeCount = likeEl ? parseInt(likeEl.textContent?.replace(/[^0-9]/g, "") || "0") : 0;
          const collectCount = collectEl ? parseInt(collectEl.textContent?.replace(/[^0-9]/g, "") || "0") : 0;
          const commentCount = commentEl ? parseInt(commentEl.textContent?.replace(/[^0-9]/g, "") || "0") : 0;

          // Author comments (博主在评论区的回复)
          const authorComments: { content: string; postedAt: string }[] = [];
          const commentItems = document.querySelectorAll('[class*="comment-item"]');
          commentItems.forEach((item) => {
            const isAuthor = item.querySelector('[class*="author-tag"], [class*="author"]');
            if (!isAuthor) return;
            const commentContent = item.querySelector('[class*="comment-content"], [class*="content"]')?.textContent?.trim();
            const commentDate = item.querySelector('[class*="date"], time')?.textContent?.trim() || "";
            if (commentContent) {
              authorComments.push({ content: commentContent, postedAt: commentDate });
            }
          });

          return { title, content, dateStr, likeCount, collectCount, commentCount, authorComments };
        });

        // Parse the date
        const postedAt = parseXhsDate(detail.dateStr);

        // Skip if older than since
        if (since && postedAt <= since) {
          console.log(`[XHS] Post ${post.postId} is older than since, stopping`);
          break;
        }

        results.push({
          postId: post.postId,
          title: detail.title || post.title,
          content: detail.content || post.content,
          postedAt: postedAt.toISOString(),
          url: post.url,
          likeCount: detail.likeCount || post.likeCount,
          collectCount: detail.collectCount,
          commentCount: detail.commentCount,
          authorComments: detail.authorComments,
        });

        console.log(`[XHS] Scraped post: ${detail.title || post.postId} (${detail.authorComments.length} author comments)`);
      } catch (err) {
        console.warn(`[XHS] Failed to scrape post ${post.postId}: ${String(err).slice(0, 100)}`);
      }
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
