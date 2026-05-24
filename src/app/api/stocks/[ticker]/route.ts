import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchStockProfile } from "@/lib/yahoo";
import { generateStockAnalysis } from "@/lib/kimi";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  const stock = await prisma.stock.findUnique({
    where: { ticker: ticker.toUpperCase() },
    include: {
      priceHistory: {
        orderBy: { date: "asc" },
      },
      postStocks: {
        include: {
          post: {
            include: {
              blogger: true,
            },
          },
        },
        orderBy: { post: { postedAt: "desc" } },
      },
      analysis: true,
    },
  });

  if (!stock) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  // Fetch stock profile from Yahoo (cached per request)
  let profile = null;
  try {
    profile = await fetchStockProfile(stock.ticker);
  } catch {
    // Yahoo profile fetch is best-effort
  }

  // Check if analysis exists; if not and KIMI_API_KEY is set, generate it
  let analysisContent = stock.analysis?.content ?? null;
  if (!analysisContent && profile && process.env.KIMI_API_KEY) {
    try {
      const content = await generateStockAnalysis(stock.ticker, profile);
      if (content) {
        await prisma.stockAnalysis.upsert({
          where: { stockId: stock.id },
          create: { stockId: stock.id, content },
          update: { content },
        });
        analysisContent = content;
      }
    } catch (err) {
      console.error(`Error generating analysis for ${stock.ticker}:`, err);
    }
  }

  return NextResponse.json({
    ticker: stock.ticker,
    companyName: stock.companyName,
    latestPrice: stock.latestPrice,
    profile,
    analysis: analysisContent,
    mentions: stock.postStocks.map((ps) => ({
      id: ps.id,
      mentionType: ps.mentionType,
      post: {
        id: ps.post.id,
        content: ps.post.content,
        postedAt: ps.post.postedAt,
        url: ps.post.url,
        blogger: {
          xUsername: ps.post.blogger.xUsername,
          displayName: ps.post.blogger.displayName,
          color: ps.post.blogger.color,
          avatarUrl: ps.post.blogger.avatarUrl,
        },
      },
    })),
    prices: stock.priceHistory.map((p) => ({
      date: p.date,
      open: Number(p.open),
      high: Number(p.high),
      low: Number(p.low),
      close: Number(p.close),
      volume: Number(p.volume),
    })),
  });
}
