import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPostSource } from "@/lib/social";
import type { RecommendedBlogger } from "@/lib/social/types";

/**
 * GET /api/bloggers/recommend-by-network
 *
 * Mines the follow-graph of tracked bloggers to find high-quality recommendations.
 * Strategy:
 * 1. Fetch who each tracked blogger follows
 * 2. Find users followed by ≥2 bloggers (social proof)
 * 3. Fetch their profiles and score by finance relevance + popularity
 */
export async function GET() {
  const source = getPostSource();
  if (!source.fetchFollowing || !source.searchUsers) {
    return NextResponse.json(
      { error: "Network mining not supported by current post source" },
      { status: 400 }
    );
  }

  const tracked = await prisma.blogger.findMany({
    where: { isActive: true },
    select: { xUsername: true },
  });
  const trackedSet = new Set(tracked.map((b) => b.xUsername.toLowerCase()));

  // Step 1: Fetch following lists from all tracked bloggers
  const followCounts = new Map<string, number>(); // username → how many tracked bloggers follow them

  for (const blogger of tracked) {
    try {
      const followings = await source.fetchFollowing(blogger.xUsername);
      for (const followedUsername of followings) {
        const key = followedUsername.toLowerCase();
        if (trackedSet.has(key)) continue; // skip already-tracked
        followCounts.set(key, (followCounts.get(key) ?? 0) + 1);
      }
    } catch (err) {
      console.error(`Failed to fetch followings for @${blogger.xUsername}:`, err);
    }
    // Rate limit: free tier = 1 req per 5 seconds
    await new Promise((r) => setTimeout(r, 6000));
  }

  // Step 2: Get candidates followed by ≥2 tracked bloggers
  const candidates = [...followCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([username]) => username);

  if (candidates.length === 0) {
    return NextResponse.json({
      recommended: [],
      message: "未找到共同关注的博主（需要至少2位已跟踪博主共同关注）",
    });
  }

  // Step 3: Fetch profiles for top candidates (batch by searching)
  // We search each candidate individually to get full profiles
  const profiles: RecommendedBlogger[] = [];
  for (const username of candidates.slice(0, 30)) {
    try {
      const results = await source.searchUsers(username);
      const match = results.find(
        (u) => u.xUsername.toLowerCase() === username.toLowerCase()
      );
      if (match) {
        profiles.push({
          ...match,
          // Attach graph metadata — we'll add _meta in the response
        });
      }
      await new Promise((r) => setTimeout(r, 5000));
    } catch (err) {
      console.error(`Profile fetch failed for @${username}:`, err);
    }
  }

  // Step 4: Score and rank
  const scored = profiles
    .map((p) => {
      const sharedBy = followCounts.get(p.xUsername.toLowerCase()) ?? 1;
      const finance = financeScore(p.description);
      const influence = Math.min(Math.log10(Math.max(p.followersCount, 1)) * 15, 90);
      const activity = p.tweetCount > 100 && p.tweetCount < 50000 ? 20 : 10;

      // Graph bonus: +15 per additional blogger following them
      const graphBonus = (sharedBy - 1) * 15;

      const score = Math.round(finance * 0.40 + influence * 0.30 + activity * 0.10 + graphBonus + (p.verified ? 10 : 0));

      return {
        ...p,
        score,
        sharedBy,
      };
    })
    .filter((u) => u.score >= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  return NextResponse.json({ recommended: scored });
}

function financeScore(description: string): number {
  if (!description) return 0;
  const keywords = [
    "stock", "invest", "trading", "finance", "market", "portfolio",
    "bull", "bear", "equity", "dividend", "ETF", "options", "futures",
    "macro", "quant", "analyst", "trader", "economist", "hedge",
    "crypto", "blockchain", "tech", "startup", "VC", "venture",
    "geopolitic", "policy", "fed", "central bank", "inflation", "rate",
    "股票", "投资", "交易", "A股", "港股", "美股", "量化", "基金",
    "期货", "证券", "理财", "复盘", "操盘", "策略", "宏观",
    "科技", "AI", "半导体", "芯片", "新能源", "医药", "消费",
    "国际", "局势", "政策", "央行", "加息", "降息",
  ];
  const lower = description.toLowerCase();
  let matches = 0;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) matches++;
  }
  return Math.min(matches * 8, 100);
}
