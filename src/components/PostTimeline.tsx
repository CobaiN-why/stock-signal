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
  postSectors: {
    confidence: string | number;
    evidence: string;
    sentiment: string | null;
    sector: { slug: string; name: string; market: string };
  }[];
  mappings?: {
    stocks: {
      ticker: string;
      market: string;
      assetType: string;
      associationType: string;
      sentiment: string | null;
    }[];
    sectors: {
      slug: string;
      name: string;
      market: string;
      confidence: number;
      evidence: string;
      sentiment: string | null;
      associationType: string;
    }[];
    etfs: {
      ticker: string;
      market: string;
      name: string;
      sourceSectors: string[];
      associationType: string;
    }[];
  };
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

  const stockMappings = (post: Post) =>
    post.mappings?.stocks ??
    post.postStocks.map((ps) => ({
      ticker: ps.stock.ticker,
      market: ps.stock.market,
      assetType: "STOCK",
      associationType: "direct_stock",
      sentiment: null,
    }));

  const sectorMappings = (post: Post) =>
    post.mappings?.sectors ??
    post.postSectors.map((ps) => ({
      slug: ps.sector.slug,
      name: ps.sector.name,
      market: ps.sector.market,
      confidence: Number(ps.confidence),
      evidence: ps.evidence,
      sentiment: ps.sentiment,
      associationType:
        Number(ps.confidence) >= 0.7
          ? "direct_or_etf_sector"
          : "weak_inferred_sector",
    }));

  const etfMappings = (post: Post) => post.mappings?.etfs ?? [];

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
              <div className="ml-auto flex gap-1 flex-wrap justify-end">
                {stockMappings(post).map((stock) => (
                  <span
                    key={`${stock.market}:${stock.ticker}`}
                    className="text-xs bg-[var(--border-soft)] rounded px-1.5 py-0.5 font-mono"
                    title={stock.assetType === "ETF" ? "直接 ETF" : "直接个股"}
                  >
                    {stock.market === "US" ? "$" : ""}{stock.ticker}
                    {stock.assetType === "ETF" ? " ETF" : ""}
                  </span>
                ))}
                {sectorMappings(post).map((sector) => (
                  <span
                    key={`${sector.market}:${sector.slug}`}
                    title={`${sector.evidence} / 置信度 ${Math.round(sector.confidence * 100)}%`}
                    className="text-xs bg-[var(--accent-green)]/10 text-[var(--accent-green)] rounded px-1.5 py-0.5"
                  >
                    {sector.confidence >= 0.7 ? "板块" : "弱关联"}:{sector.name}
                  </span>
                ))}
                {etfMappings(post).slice(0, 3).map((etf) => (
                  <span
                    key={`${etf.market}:${etf.ticker}`}
                    title={`由板块推荐：${etf.sourceSectors.join("、")}`}
                    className="text-xs bg-amber-100 text-amber-800 rounded px-1.5 py-0.5 font-mono"
                  >
                    ETF:{etf.ticker}
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
