"use client";

import { useEffect, useState } from "react";

interface Post {
  id: string;
  content: string;
  postedAt: string;
  url: string;
  blogger: {
    xUsername: string;
    displayName: string;
    color: string;
  };
  postStocks: { stock: { ticker: string } }[];
}

export default function OpinionTape() {
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    fetch("/api/posts?limit=20")
      .then((r) => r.json())
      .then((d) => setPosts(d.posts || []))
      .catch(() => {});
  }, []);

  if (posts.length === 0) return null;

  return (
    <div className="border-t border-[var(--border-soft)] px-6 py-4">
      <h3 className="font-serif-title text-sm text-[var(--text-secondary)] mb-3">
        Latest Opinion Tape
      </h3>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
        {posts.map((post) => (
          <a
            key={post.id}
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 w-[280px] bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-3 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: post.blogger.color }}
              />
              <span className="font-mono text-xs font-bold">
                @{post.blogger.xUsername}
              </span>
              <span className="text-xs text-[var(--text-secondary)] ml-auto">
                {new Date(post.postedAt).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="text-xs leading-relaxed line-clamp-3">
              {post.content}
            </p>
            {post.postStocks.length > 0 && (
              <div className="flex gap-1 mt-2">
                {post.postStocks.map((ps) => (
                  <span
                    key={ps.stock.ticker}
                    className="text-xs bg-[var(--border-soft)] rounded px-1.5 py-0.5 font-mono"
                  >
                    ${ps.stock.ticker}
                  </span>
                ))}
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
