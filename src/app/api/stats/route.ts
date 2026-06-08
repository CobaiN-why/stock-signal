import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";

export async function GET(req: NextRequest) {
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));
  const marketPostWhere = {
    OR: [
      { postStocks: { some: { stock: { market } } } },
      { postSectors: { some: { sector: { market } } } },
    ],
  };

  const [postCount, stockCount, bloggerCount, lastPost] = await Promise.all([
    prisma.post.count({ where: marketPostWhere }),
    prisma.stock.count({
      where: { market, postStocks: { some: {} } },
    }),
    prisma.blogger.count({ where: { isActive: true } }),
    prisma.post.findFirst({
      where: marketPostWhere,
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
