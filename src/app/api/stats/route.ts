import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const [postCount, stockCount, bloggerCount, lastPost] = await Promise.all([
    prisma.post.count(),
    prisma.stock.count({
      where: { postStocks: { some: {} } },
    }),
    prisma.blogger.count({ where: { isActive: true } }),
    prisma.post.findFirst({ orderBy: { fetchedAt: "desc" } }),
  ]);

  return NextResponse.json({
    postCount,
    stockCount,
    bloggerCount,
    lastUpdated: lastPost?.fetchedAt ?? null,
  });
}
