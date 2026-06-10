/**
 * Twikit-based Twitter/X post source (free, cookie-based).
 *
 * Uses the twikit Python library to fetch tweets without API keys.
 * Requires: X_USERNAME, X_PASSWORD env vars (for first login only).
 * Cookies are cached to scripts/twikit-cookies.json after first login.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { PostSource, SourcePost } from "@/lib/social/types";

const execFileAsync = promisify(execFile);

function pythonPath(): string {
  return process.env.CN_MARKET_DATA_PYTHON || "python3";
}

function scriptPath(): string {
  return path.join(process.cwd(), "scripts", "twikit-provider.py");
}

export const twikitPostSource: PostSource = {
  name: "twikit",

  async fetchUserPosts(
    username: string,
    since?: Date
  ): Promise<SourcePost[]> {
    const args = [scriptPath(), username];
    if (since) {
      args.push(since.toISOString());
    }

    const { stdout, stderr } = await execFileAsync(pythonPath(), args, {
      timeout: 120_000,
      maxBuffer: 5 * 1024 * 1024,
    });

    if (stderr && !stderr.includes("Warning")) {
      // Check for structured error
      try {
        const parsed = JSON.parse(stderr.trim());
        if (parsed.error) throw new Error(parsed.error);
      } catch {
        if (stderr.trim()) console.warn("twikit stderr:", stderr.slice(0, 200));
      }
    }

    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      if (parsed.error) throw new Error(parsed.error);
      return [];
    }

    return parsed as SourcePost[];
  },
};
