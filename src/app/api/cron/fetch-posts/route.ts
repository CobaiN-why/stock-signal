import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { ingestPostsFromActiveBloggers } from "@/lib/ingest";

async function handler(req: NextRequest) {
  // Support auth via query param for GET requests (cron-job.org style)
  const secretParam = req.nextUrl.searchParams.get("secret");
  if (secretParam) {
    const expected = process.env.CRON_SECRET;
    if (!expected || secretParam !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    const authError = verifyCronAuth(req);
    if (authError) return authError;
  }

  const result = await ingestPostsFromActiveBloggers();
  return NextResponse.json(result);
}

export const GET = handler;
export const POST = handler;
