import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPostSource } from "@/lib/social";

/**
 * GET /api/bloggers/recommend?query=半导体
 * Searches Twitter for users matching the query and filters out already-tracked bloggers.
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

    // Filter out already-tracked, sort by followers
    const recommended = users
      .filter((u) => !trackedSet.has(u.xUsername.toLowerCase()))
      .sort((a, b) => b.followersCount - a.followersCount)
      .slice(0, 20);

    return NextResponse.json({ recommended });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
