import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
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
    },
  });

  if (!stock) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...stock,
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
    postStocks: undefined,
    priceHistory: undefined,
  });
}
