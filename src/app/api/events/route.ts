import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";

export async function GET(req: NextRequest) {
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "20", 10), 100);

  const events = await prisma.signalEvent.findMany({
    where: { market },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      stock: { select: { ticker: true, market: true, assetType: true } },
      sector: { select: { slug: true, name: true } },
    },
  });

  return NextResponse.json({ events });
}
