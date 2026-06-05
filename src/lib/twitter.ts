import { twitterPostSource } from "@/lib/social/twitter";
import type { SourcePost } from "@/lib/social";

export type Tweet = SourcePost;

export function fetchUserTweets(username: string, since?: Date): Promise<Tweet[]> {
  return twitterPostSource.fetchUserPosts(username, since);
}
