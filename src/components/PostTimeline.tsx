"use client";

import { useEffect, useState, useRef } from "react";
import type { Market } from "@/lib/markets";

// Regex patterns for detecting stock codes in post content
const CN_CODE_REGEX = /(?:^|[^\d])((?:00|15|30|51|58|60|68)\d{4})(?=$|[^\d])/g;
const US_CASHTAG_REGEX = /\$([A-Z]{1,5})\b/g;

function highlightStockContent(
  content: string,
  stockTickers: { ticker: string; market: string }[]
): React.ReactNode[] {
  if (!content) return [content];

  // Build a set of tickers to highlight
  const tickerSet = new Set(stockTickers.map((s) => s.ticker.toUpperCase()));

  // Collect all match positions
  interface MatchPos {
    start: number;
    end: number;
    ticker: string;
    market: string;
  }
  const matches: MatchPos[] = [];

  // Find CN 6-digit codes
  let match: RegExpExecArray | null;
  CN_CODE_REGEX.lastIndex = 0;
  while ((match = CN_CODE_REGEX.exec(content)) !== null) {
    const code = match[1];
    if (tickerSet.has(code)) {
      // Adjust start to skip the non-digit prefix character
      const start = match.index + match[0].indexOf(code);
      matches.push({ start, end: start + code.length, ticker: code, market: "CN" });
    }
  }

  // Find US cashtags $TICKER
  US_CASHTAG_REGEX.lastIndex = 0;
  while ((match = US_CASHTAG_REGEX.exec(content)) !== null) {
    const ticker = match[1].toUpperCase();
    if (tickerSet.has(ticker)) {
      matches.push({ start: match.index, end: match.index + match[0].length, ticker, market: "US" });
    }
  }

  // Sort by position and deduplicate overlapping matches
  matches.sort((a, b) => a.start - b.start);
  const filtered: MatchPos[] = [];
  for (const m of matches) {
    const last = filtered[filtered.length - 1];
    if (last && m.start < last.end) continue; // skip overlapping
    filtered.push(m);
  }

  if (filtered.length === 0) return [content];

  // Split content and wrap matches
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < filtered.length; i++) {
    const m = filtered[i];
    if (m.start > cursor) {
      parts.push(content.slice(cursor, m.start));
    }
    parts.push(
      <mark
        key={`highlight-${i}`}
        className="bg-[var(--accent)]/15 text-[var(--accent)] rounded-sm px-0.5 font-mono text-xs"
        title={`${m.market === "US" ? "美股" : "A股"}: ${m.ticker}`}
      >
        {content.slice(m.start, m.end)}
      </mark>
    );
    cursor = m.end;
  }
  if (cursor < content.length) {
    parts.push(content.slice(cursor));
  }

  return parts;
}

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
  postStocks: { sentiment: string | null; stock: { ticker: string; market: string } }[];
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
      sentiment: ps.sentiment ?? null,
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
            className={`border border-[var(--border)] rounded-lg p-3 transition-all ${
              highlightPostId === post.id
                ? "ring-2 ring-[var(--accent)] bg-[var(--accent)]/5"
                : "bg-[var(--bg-card)]"
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
                    className={`text-xs rounded px-1.5 py-0.5 font-mono ${
                      stock.sentiment === "bullish"
                        ? "bg-red-100 text-red-700"
                        : stock.sentiment === "bearish"
                          ? "bg-green-100 text-green-700"
                          : "bg-[var(--border)]"
                    }`}
                    title={`${stock.assetType === "ETF" ? "ETF" : "个股"}${
                      stock.sentiment
                        ? stock.sentiment === "bullish"
                          ? " · 看多"
                          : " · 看空"
                        : ""
                    }`}
                  >
                    {stock.market === "US" ? "$" : ""}{stock.ticker}
                    {stock.assetType === "ETF" ? " ETF" : ""}
                    {stock.sentiment === "bullish"
                      ? " ↑"
                      : stock.sentiment === "bearish"
                        ? " ↓"
                        : ""}
                  </span>
                ))}
                {sectorMappings(post).map((sector) => (
                  <span
                    key={`${sector.market}:${sector.slug}`}
                    title={`${sector.evidence} / 置信度 ${Math.round(sector.confidence * 100)}%`}
                    className="text-xs bg-[var(--accent)]/10 text-[var(--accent)] rounded px-1.5 py-0.5"
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
              {highlightStockContent(
                post.content,
                stockMappings(post).map((s) => ({
                  ticker: s.ticker,
                  market: s.market,
                }))
              )}
            </p>
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-xs text-[var(--accent)] hover:underline"
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
