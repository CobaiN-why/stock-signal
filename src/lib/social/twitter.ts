import type { PostSource, RecommendedBlogger, SourcePost } from "@/lib/social/types";

export const twitterPostSource: PostSource = {
  name: "twitter",

  async fetchUserPosts(username: string, since?: Date): Promise<SourcePost[]> {
    const apiKey = process.env.TWITTER_API_KEY;
    if (!apiKey) throw new Error("TWITTER_API_KEY not set");

    const params = new URLSearchParams({ userName: username });
    if (since) {
      params.set("since_time", Math.floor(since.getTime() / 1000).toString());
    }

    const res = await fetch(
      `https://api.twitterapi.io/twitter/user/last_tweets?${params}`,
      {
        headers: { "x-api-key": apiKey },
      }
    );

    if (!res.ok) {
      throw new Error(`TwitterAPI.io error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return ((data.data?.tweets ?? data.tweets) || []).map(
      (t: { id: string; text: string; createdAt?: string; created_at?: string }) => ({
        id: t.id,
        text: t.text,
        createdAt: t.createdAt ?? t.created_at ?? "",
        url: `https://x.com/${username}/status/${t.id}`,
      })
    );
  },

  async searchUsers(query: string): Promise<RecommendedBlogger[]> {
    const apiKey = process.env.TWITTER_API_KEY;
    if (!apiKey) throw new Error("TWITTER_API_KEY not set");

    // Use TwitterAPI.io user search
    const res = await fetch(
      `https://api.twitterapi.io/twitter/user/search?query=${encodeURIComponent(query)}`,
      {
        headers: { "x-api-key": apiKey },
      }
    );

    if (!res.ok) {
      console.error(`Twitter user search error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const users = data.data?.users ?? data.users ?? [];
    return users.map(
      (u: {
        userName?: string;
        name?: string;
        description?: string;
        followers?: number;
        following?: number;
        tweets?: number;
        avatar?: string;
        verified?: boolean;
      }) => ({
        xUsername: u.userName ?? "",
        displayName: u.name ?? "",
        description: u.description ?? "",
        followersCount: u.followers ?? 0,
        followingCount: u.following ?? 0,
        tweetCount: u.tweets ?? 0,
        avatarUrl: u.avatar ?? null,
        verified: u.verified ?? false,
      })
    );
  },
};
