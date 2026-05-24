export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  url: string;
}

export async function fetchUserTweets(
  username: string,
  since?: Date
): Promise<Tweet[]> {
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
  const tweets: Tweet[] = (data.tweets || []).map(
    (t: { id: string; text: string; created_at: string }) => ({
      id: t.id,
      text: t.text,
      createdAt: t.created_at,
      url: `https://x.com/${username}/status/${t.id}`,
    })
  );

  return tweets;
}
