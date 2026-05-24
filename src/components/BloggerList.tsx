"use client";

import { useEffect, useState } from "react";

interface Blogger {
  id: string;
  xUsername: string;
  displayName: string;
  color: string;
  avatarUrl: string | null;
  _count: { posts: number };
}

interface Props {
  selectedBlogger: string | null;
  onSelect: (username: string | null) => void;
}

export default function BloggerList({ selectedBlogger, onSelect }: Props) {
  const [bloggers, setBloggers] = useState<Blogger[]>([]);

  useEffect(() => {
    fetch("/api/bloggers")
      .then((r) => r.json())
      .then(setBloggers)
      .catch(() => {});
  }, []);

  return (
    <div className="mb-6">
      <h2 className="font-serif-title text-sm mb-3 text-[var(--text-secondary)]">
        Bloggers
      </h2>
      <div className="space-y-1">
        {bloggers.map((b) => (
          <button
            key={b.id}
            onClick={() =>
              onSelect(selectedBlogger === b.xUsername ? null : b.xUsername)
            }
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
              selectedBlogger === b.xUsername
                ? "bg-[var(--border-soft)]"
                : "hover:bg-[var(--border-soft)]/50"
            }`}
          >
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: b.color }}
            />
            <span className="font-mono truncate">@{b.xUsername}</span>
            <span className="ml-auto text-xs text-[var(--text-secondary)]">
              {b._count.posts}
            </span>
          </button>
        ))}
        {bloggers.length === 0 && (
          <p className="text-xs text-[var(--text-secondary)] px-3">
            暂无博主，通过 API 添加
          </p>
        )}
      </div>
    </div>
  );
}
