import type { PostSource } from "@/lib/social/types";
import { twitterPostSource } from "@/lib/social/twitter";

const sources: Record<string, PostSource> = {
  twitter: twitterPostSource,
  x: twitterPostSource,
};

export function getPostSource(name = process.env.POST_SOURCE ?? "twitter"): PostSource {
  const source = sources[name.toLowerCase()];
  if (!source) throw new Error(`Post source not configured: ${name}`);
  return source;
}

export type { PostSource, SourcePost } from "./types";
