import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { normalizeMarket } from "@/lib/markets";

export async function GET(req: NextRequest) {
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));
  const bloggers = await prisma.blogger.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const result = await Promise.all(
    bloggers.map(async (blogger) => {
      const posts = await prisma.post.count({
        where: {
          bloggerId: blogger.id,
          OR: [
            { postStocks: { some: { stock: { market } } } },
            { postSectors: { some: { sector: { market } } } },
          ],
        },
      });

      return { ...blogger, _count: { posts } };
    })
  );

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const body = await req.json();
  const { xUsername, displayName, color } = body;

  if (!xUsername || !displayName || !color) {
    return NextResponse.json(
      { error: "xUsername, displayName, and color are required" },
      { status: 400 }
    );
  }

  const blogger = await prisma.blogger.create({
    // `market` is kept for compatibility with existing rows; ingest is cross-market.
    data: { xUsername, displayName, color, market: normalizeMarket(body.market) },
  });

  return NextResponse.json(blogger, { status: 201 });
}
