/**
 * Xiaohongshu local crawler — runs on Mac, outputs JSON, uploads to server.
 * Cron (add to crontab -e):
 *   0 11,14,0 * * * cd ~/workspace/stock-signal && SERVER_PASSWORD='...' npx tsx scripts/xhs-crawl-local.ts >> /tmp/xhs-cron.log 2>&1
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { scrapeUserPosts, closeBrowser } from "../src/lib/xiaohongshu/scraper.js";

const BLOGGERS = [
  { xhsId: "5fb3550f0000000001005403", nickname: "玉心今天退休了吗" },
];

const STATE_FILE = "/tmp/xhs-state.json";
const OUTPUT_FILE = "/tmp/xhs-posts.json";

function loadState(): Record<string, string> {
  try {
    return JSON.parse(require("fs").readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: Record<string, string>) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  console.log(`[XHS-Local] Crawl started at ${new Date().toISOString()}`);

  const state = loadState();
  const allPosts: any[] = [];

  for (const blogger of BLOGGERS) {
    console.log(`[XHS-Local] Processing @${blogger.nickname} (${blogger.xhsId})`);
    const since = state[blogger.xhsId] ? new Date(state[blogger.xhsId]) : null;

    try {
      const posts = await scrapeUserPosts(blogger.xhsId, since);
      console.log(`[XHS-Local] Got ${posts.length} new posts`);

      for (const post of posts) {
        allPosts.push({
          xhsId: blogger.xhsId,
          nickname: blogger.nickname,
          ...post,
        });
      }

      state[blogger.xhsId] = new Date().toISOString();
    } catch (err) {
      console.error(`[XHS-Local] Error: ${String(err).slice(0, 200)}`);
    }
  }

  await closeBrowser();
  saveState(state);

  if (allPosts.length > 0) {
    writeFileSync(OUTPUT_FILE, JSON.stringify(allPosts, null, 2));
    console.log(`[XHS-Local] Wrote ${allPosts.length} posts to ${OUTPUT_FILE}`);

    // Upload to server
    try {
      execSync(
        `sshpass -p "${process.env.SERVER_PASSWORD || ""}" scp -o StrictHostKeyChecking=no ${OUTPUT_FILE} ac@10.67.228.33:/tmp/xhs-posts.json`,
        { stdio: "inherit" }
      );
      console.log("[XHS-Local] Uploaded to server");

      // Trigger server-side import
      execSync(
        `sshpass -p "${process.env.SERVER_PASSWORD || ""}" ssh -o StrictHostKeyChecking=no ac@10.67.228.33 'source ~/.nvm/nvm.sh && cd /home/ac/workspace/stock-signal && node --import dotenv/config --import tsx scripts/xhs-import.ts'`,
        { stdio: "inherit" }
      );
      console.log("[XHS-Local] Import triggered on server");
    } catch (err) {
      console.error("[XHS-Local] Upload/import failed:", String(err).slice(0, 200));
    }
  } else {
    console.log("[XHS-Local] No new posts, nothing to upload");
  }
}

main().catch((err) => {
  console.error("[XHS-Local] Fatal:", err);
  closeBrowser();
  process.exit(1);
});
