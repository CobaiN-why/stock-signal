import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const ticker = searchParams.get("ticker");
  const blogger = searchParams.get("blogger");
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const where: Record<string, unknown> = {};

  if (ticker) {
    where.postStocks = {
      some: { stock: { ticker: ticker.toUpperCase() } },
    };
  }
  if (blogger) {
    where.blogger = { xUsername: blogger };
  }

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { postedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        blogger: {
          select: {
            xUsername: true,
            displayName: true,
            color: true,
            avatarUrl: true,
          },
        },
        postStocks: {
          include: { stock: { select: { ticker: true } } },
        },
      },
    }),
    prisma.post.count({ where }),
  ]);

  return NextResponse.json({ posts, total, limit, offset });
}
