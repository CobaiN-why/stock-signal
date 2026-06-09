import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPostSource } from "@/lib/social";

// Finance-related keywords for relevance scoring (bio/description match)
const FINANCE_KEYWORDS = [
  // Chinese
  "股票", "投资", "交易", "A股", "港股", "美股", "量化", "基金", "期货",
  "理财", "证券", "牛熊", "大盘", "板块", "技术分析", "基本面", "龙头",
  "涨停", "跌停", "ETF", "期权", "对冲", "宏观", "策略", "复盘", "操盘",
  "私募", "公募", "券商", "研报", "财报", "分红", "股息", "成长股", "价值投资",
  "短线", "长线", "波段", "趋势", "突破", "回调", "抄底", "逃顶",
  "半导体", "新能源", "消费", "医药", "金融", "科技", "AI", "芯片",
  "中概", "恒指", "上证", "深证", "创业板", "科创板",
  // English
  "stock", "invest", "trading", "finance", "portfolio", "market",
  "bull", "bear", "technical analysis", "fundamental", "ETF", "options",
  "futures", "crypto", "quant", "hedge fund", "macro", "equity",
  "dividend", "growth", "value", "momentum", "swing trade", "day trade",
  "analyst", "strategist", "economist", "trader", "investor",
  "semiconductor", "energy", "healthcare", "biotech", "fintech",
];

function financeRelevanceScore(description: string): number {
  if (!description) return 0;
  const lower = description.toLowerCase();
  let matches = 0;
  let strongMatches = 0; // multi-word matches count more

  for (const kw of FINANCE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      if (kw.includes(" ")) strongMatches++;
      else matches++;
    }
  }

  // Score: each keyword match adds points, capped at 100
  const raw = Math.min(matches * 8 + strongMatches * 20, 100);
  // Require at least 2 matches to be considered finance-related
  return matches + strongMatches >= 2 ? raw : Math.min(raw, 15);
}

function influenceScore(followers: number, following: number): number {
  if (followers <= 0) return 0;
  // Log-scale: 100 followers = 10pts, 1k = 30pts, 10k = 50pts, 100k = 70pts, 1M = 90pts
  const followerScore = Math.min(Math.log10(Math.max(followers, 1)) * 15, 90);
  // Follower/following ratio bonus (influential, not just following everyone)
  const ratio = following > 0 ? followers / following : followers / 1;
  const ratioBonus = Math.min(Math.log10(Math.max(ratio, 1)) * 5, 10);
  return Math.min(followerScore + ratioBonus, 100);
}

function activityScore(tweetCount: number): number {
  if (tweetCount <= 0) return 0;
  // Moderate activity preferred (not too spammy, not inactive)
  if (tweetCount < 100) return 10;
  if (tweetCount < 1000) return 30;
  if (tweetCount < 10000) return 70;
  if (tweetCount < 50000) return 50; // very high could be bot/spam
  return 30;
}

function credibilityBonus(verified: boolean): number {
  return verified ? 15 : 0;
}

interface ScoredBlogger {
  xUsername: string;
  displayName: string;
  description: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  avatarUrl: string | null;
  verified: boolean;
  score: number;
  financeScore: number;
  influenceScore: number;
  activityScore: number;
}

/**
 * GET /api/bloggers/recommend?query=半导体
 * Searches Twitter for users matching the query, scores them by finance relevance,
 * influence, and activity, then returns ranked results.
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query") ?? "stock investing";
  const source = getPostSource();

  if (!source.searchUsers) {
    return NextResponse.json(
      { error: "User search not supported by current post source" },
      { status: 400 }
    );
  }

  // Get already-tracked usernames
  const tracked = await prisma.blogger.findMany({
    where: { isActive: true },
    select: { xUsername: true },
  });
  const trackedSet = new Set(tracked.map((b) => b.xUsername.toLowerCase()));

  try {
    const users = await source.searchUsers(query);

    const scored: ScoredBlogger[] = users
      .filter((u) => !trackedSet.has(u.xUsername.toLowerCase()))
      .map((u) => {
        const finance = financeRelevanceScore(u.description);
        const influence = influenceScore(u.followersCount, u.followingCount);
        const activity = activityScore(u.tweetCount);
        const verified = credibilityBonus(u.verified);

        // Composite score: finance relevance 40%, influence 30%, activity 20%, verified 10%
        const score = Math.round(
          finance * 0.40 + influence * 0.30 + activity * 0.20 + verified
        );

        return {
          ...u,
          score,
          financeScore: finance,
          influenceScore: influence,
          activityScore: activity,
        };
      })
      // Filter: must have at least some finance relevance or be high-influence
      .filter((u) => u.financeScore >= 10 || u.influenceScore >= 70)
      // Sort by composite score descending
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return NextResponse.json({ recommended: scored });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
