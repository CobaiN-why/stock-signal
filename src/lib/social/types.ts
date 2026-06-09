export interface SourcePost {
  id: string;
  text: string;
  createdAt: string;
  url: string;
}

export interface RecommendedBlogger {
  xUsername: string;
  displayName: string;
  description: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  avatarUrl: string | null;
  verified: boolean;
}

export interface PostSource {
  name: string;
  fetchUserPosts(username: string, since?: Date): Promise<SourcePost[]>;
  searchUsers?(query: string): Promise<RecommendedBlogger[]>;
  fetchFollowing?(username: string): Promise<string[]>;
}
