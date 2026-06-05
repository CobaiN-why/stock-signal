import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { ingestPostsFromActiveBloggers } from "@/lib/ingest";

export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const result = await ingestPostsFromActiveBloggers();
  return NextResponse.json(result);
}
