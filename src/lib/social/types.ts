export interface SourcePost {
  id: string;
  text: string;
  createdAt: string;
  url: string;
}

export interface PostSource {
  name: string;
  fetchUserPosts(username: string, since?: Date): Promise<SourcePost[]>;
}
