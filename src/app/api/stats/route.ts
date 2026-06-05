import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";

export async function GET(req: NextRequest) {
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));
  const [postCount, stockCount, bloggerCount, lastPost] = await Promise.all([
    prisma.post.count({ where: { blogger: { market } } }),
    prisma.stock.count({
      where: { market, postStocks: { some: {} } },
    }),
    prisma.blogger.count({ where: { isActive: true, market } }),
    prisma.post.findFirst({
      where: { blogger: { market } },
      orderBy: { fetchedAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    postCount,
    stockCount,
    bloggerCount,
    lastUpdated: lastPost?.fetchedAt ?? null,
  });
}
