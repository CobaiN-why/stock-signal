"use client";

import { useEffect, useState, useRef } from "react";
import type { Market } from "@/lib/markets";

interface Post {
  id: string;
  content: string;
  postedAt: string;
  url: string;
  blogger: {
    xUsername: string;
    displayName: string;
    color: string;
    avatarUrl: string | null;
  };
  postStocks: { stock: { ticker: string; market: string } }[];
}

interface Props {
  market: Market;
  ticker: string | null;
  selectedBlogger: string | null;
  highlightPostId: string | null;
}

export default function PostTimeline({
  market,
  ticker,
  selectedBlogger,
  highlightPostId,
}: Props) {
  const [posts, setPosts] = useState<Post[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const postRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!ticker) return;
    const params = new URLSearchParams({ ticker, market });
    if (selectedBlogger) params.set("blogger", selectedBlogger);

    fetch(`/api/posts?${params}`)
      .then((r) => r.json())
      .then((d) => setPosts(d.posts || []))
      .catch(() => {});
  }, [ticker, selectedBlogger, market]);

  useEffect(() => {
    if (!highlightPostId) return;
    const el = postRefs.current.get(highlightPostId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightPostId]);

  if (!ticker) {
    return (
      <div className="text-sm text-[var(--text-secondary)] py-4">
        选择股票后显示相关帖子
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-serif-title text-sm text-[var(--text-secondary)] mb-3">
        Mention Timeline
      </h3>
      <div
        ref={containerRef}
        className="space-y-3 max-h-[400px] overflow-y-auto scrollbar-hide"
      >
        {posts.map((post) => (
          <div
            key={post.id}
            ref={(el) => {
              if (el) postRefs.current.set(post.id, el);
            }}
            className={`border border-[var(--border-soft)] rounded-lg p-3 transition-all ${
              highlightPostId === post.id
                ? "ring-2 ring-[var(--accent-green)] bg-[var(--accent-green)]/5"
                : "bg-[var(--card-bg)]"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: post.blogger.color }}
              />
              <span className="font-mono text-sm font-bold">
                @{post.blogger.xUsername}
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                {new Date(post.postedAt).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <div className="ml-auto flex gap-1">
                {post.postStocks.map((ps) => (
                  <span
                    key={ps.stock.ticker}
                    className="text-xs bg-[var(--border-soft)] rounded px-1.5 py-0.5 font-mono"
                  >
                    {ps.stock.market === "US" ? "$" : ""}{ps.stock.ticker}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {post.content}
            </p>
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-xs text-[var(--accent-green)] hover:underline"
            >
              查看原帖 →
            </a>
          </div>
        ))}
        {posts.length === 0 && (
          <p className="text-xs text-[var(--text-secondary)]">暂无相关帖子</p>
        )}
      </div>
    </div>
  );
}
