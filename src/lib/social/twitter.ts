import type { PostSource, RecommendedBlogger, SourcePost } from "@/lib/social/types";

export const twitterPostSource: PostSource = {
  name: "twitter",

  async fetchUserPosts(
    username: string,
    since?: Date,
    maxPages?: number
  ): Promise<SourcePost[]> {
    const apiKey = process.env.TWITTER_API_KEY;
    if (!apiKey) throw new Error("TWITTER_API_KEY not set");

    const allPosts: SourcePost[] = [];
    let cursor: string | undefined;
    const sinceTimestamp = since ? Math.floor(since.getTime() / 1000) : undefined;
    const max = maxPages ?? 25; // default 25 pages = ~500 tweets

    for (let page = 0; page < max; page++) {
      const params = new URLSearchParams({ userName: username });
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(
        `https://api.twitterapi.io/twitter/user/last_tweets?${params}`,
        {
          headers: { "x-api-key": apiKey },
        }
      );

      if (!res.ok) {
        if (page === 0) {
          throw new Error(`TwitterAPI.io error: ${res.status} ${await res.text()}`);
        }
        break; // error on later pages, stop but return what we have
      }

      const data = (await res.json()) as {
        data?: { tweets?: { id: string; text: string; createdAt?: string; created_at?: string }[] };
        tweets?: { id: string; text: string; createdAt?: string; created_at?: string }[];
        next_cursor?: string;
        has_next_page?: boolean;
      };

      const tweets = (data.data?.tweets ?? data.tweets) || [];

      for (const t of tweets) {
        const createdAt = t.createdAt ?? t.created_at ?? "";
        // Stop if we've reached tweets older than since
        if (sinceTimestamp && createdAt) {
          const tweetTime = new Date(createdAt).getTime() / 1000;
          if (tweetTime < sinceTimestamp) {
            // Found tweets older than since — stop pagination
            return allPosts;
          }
        }
        allPosts.push({
          id: t.id,
          text: t.text,
          createdAt,
          url: `https://x.com/${username}/status/${t.id}`,
        });
      }

      // Check for next page
      cursor = data.next_cursor;
      if (!cursor || data.has_next_page === false) break;
    }

    return allPosts;
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

  async fetchFollowing(username: string): Promise<string[]> {
    const apiKey = process.env.TWITTER_API_KEY;
    if (!apiKey) throw new Error("TWITTER_API_KEY not set");

    try {
      const res = await fetch(
        `https://api.twitterapi.io/twitter/user/followings?userName=${encodeURIComponent(username)}`,
        { headers: { "x-api-key": apiKey } }
      );
      if (!res.ok) {
        console.error(`Twitter followings error for @${username}: ${res.status}`);
        return [];
      }
      const data = await res.json();
      // API returns { followings: [...] } or { data: { users: [...] } }
      const users = data.followings ?? data.data?.users ?? data.users ?? [];
      return users.map((u: { userName?: string; name?: string; screen_name?: string }) =>
        u.userName ?? u.screen_name ?? u.name ?? ""
      );
    } catch (err) {
      console.error(`Twitter followings failed for @${username}:`, err);
      return [];
    }
  },
};
