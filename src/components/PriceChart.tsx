"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  createSeriesMarkers,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import type { Market } from "@/lib/markets";

interface Mention {
  id: string;
  mentionType: string;
  sentiment: string | null;
  post: {
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
  };
}

interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface StockDetail {
  ticker: string;
  market: string;
  currency: string;
  companyName: string;
  latestPrice: string | null;
  mentions: Mention[];
  prices: PricePoint[];
}

interface Props {
  market: Market;
  ticker: string | null;
  selectedBlogger: string | null;
  onMentionClick: (postId: string) => void;
}

export default function PriceChart({
  market,
  ticker,
  selectedBlogger,
  onMentionClick,
}: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [data, setData] = useState<StockDetail | null>(null);
  const [hoveredMention, setHoveredMention] = useState<Mention | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!ticker) return;
    fetch(`/api/stocks/${ticker}?market=${market}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [ticker, market]);

  const handleChartClick = useCallback(
    (time: string) => {
      if (!data) return;
      const clickDate = time;
      const mention = data.mentions.find((m) => {
        const mDate = m.post.postedAt.slice(0, 10);
        return mDate === clickDate;
      });
      if (mention) onMentionClick(mention.post.id);
    },
    [data, onMentionClick]
  );

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.prices.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 380,
      layout: {
        background: { color: "transparent" },
        textColor: "#8a8a8a",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#f0ead6", style: 1 },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.05 },
      },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        vertLine: { color: "#c8c0b0", width: 1, style: 2 },
        horzLine: { color: "#c8c0b0", width: 1, style: 2 },
      },
    });

    chartRef.current = chart;

    // Area series: green line + gradient fill (like 图2)
    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: "#2d6a4f",
      lineWidth: 2,
      topColor: "rgba(45, 106, 79, 0.25)",
      bottomColor: "rgba(45, 106, 79, 0.02)",
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#2d6a4f",
      crosshairMarkerBackgroundColor: "#fff",
    });

    seriesRef.current = areaSeries;

    const lineData = data.prices.map((p) => ({
      time: p.date.slice(0, 10) as Time,
      value: p.close,
    }));
    areaSeries.setData(lineData);

    // Per-blogger colored markers — stacked positions for same-day mentions
    const mentionsByDate = new Map<string, Mention[]>();
    for (const m of data.mentions) {
      if (selectedBlogger && m.post.blogger.xUsername !== selectedBlogger)
        continue;
      const date = m.post.postedAt.slice(0, 10);
      if (!mentionsByDate.has(date)) mentionsByDate.set(date, []);
      mentionsByDate.get(date)!.push(m);
    }

    const positions = ["inBar", "aboveBar", "belowBar"] as const;
    type MarkerShape = "circle" | "arrowUp" | "arrowDown";
    const markers: {
      time: Time;
      position: "inBar" | "aboveBar" | "belowBar";
      color: string;
      shape: MarkerShape;
      text: string;
      size: number;
    }[] = [];

    for (const [date, mentions] of mentionsByDate) {
      const seenBloggers = new Map<string, Mention>();
      for (const m of mentions) {
        const key = m.post.blogger.xUsername;
        if (!seenBloggers.has(key)) seenBloggers.set(key, m);
      }
      const uniqueBloggers = Array.from(seenBloggers.values());

      uniqueBloggers.forEach((m, i) => {
        const shape: MarkerShape =
          m.sentiment === "bullish"
            ? "arrowUp"
            : m.sentiment === "bearish"
              ? "arrowDown"
              : "circle";
        markers.push({
          time: date as Time,
          position: positions[Math.min(i, 2)],
          color: m.post.blogger.color,
          shape,
          text: i === 0 && mentions.length > 1 ? `${mentions.length}` : "",
          size: 2,
        });
      });
    }

    markers.sort((a, b) => (a.time < b.time ? -1 : 1));

    if (markersRef.current) {
      markersRef.current.setMarkers([]);
    }
    markersRef.current = createSeriesMarkers(areaSeries, markers);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setHoveredMention(null);
        return;
      }
      const dateStr = param.time as string;
      const mentions = mentionsByDate.get(dateStr);
      if (mentions && mentions.length > 0) {
        const width = chartContainerRef.current?.clientWidth ?? 400;
        setHoveredMention(mentions[0]);
        setTooltipPos({
          x: Math.min(param.point.x, width - 300),
          y: Math.max(0, param.point.y - 80),
        });
      } else {
        setHoveredMention(null);
      }
    });

    chart.subscribeClick((param) => {
      if (param.time) handleChartClick(param.time as string);
    });

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    chart.timeScale().fitContent();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
    };
  }, [data, selectedBlogger, handleChartClick]);

  if (!ticker) {
    return (
      <div className="flex items-center justify-center h-[380px] text-[var(--text-secondary)] text-sm">
        选择左侧股票查看价格曲线
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-[380px] text-[var(--text-secondary)] text-sm">
        加载中...
      </div>
    );
  }

  // Group mention counts by blogger
  const bloggerCounts = new Map<string, { color: string; count: number }>();
  for (const m of data.mentions) {
    const key = m.post.blogger.xUsername;
    const existing = bloggerCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      bloggerCounts.set(key, { color: m.post.blogger.color, count: 1 });
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <span className="font-serif-title text-xl">
            {data.market === "US" ? "$" : ""}{data.ticker}
          </span>
          {data.companyName && (
            <span className="ml-2 text-sm text-[var(--text-secondary)]">
              {data.companyName}
            </span>
          )}
          {data.latestPrice && (
            <span className="ml-3 font-mono text-lg font-bold">
              {data.currency === "USD" ? "$" : ""}{Number(data.latestPrice).toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {Array.from(bloggerCounts.entries()).map(([username, info]) => (
            <span
              key={username}
              className="inline-flex items-center gap-1 text-xs bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-full px-2 py-0.5"
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: info.color }}
              />
              @{username} x{info.count}
            </span>
          ))}
        </div>
      </div>

      <div className="relative">
        <div ref={chartContainerRef} />
        {hoveredMention && (
          <div
            className="absolute z-10 bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg shadow-md p-3 max-w-[280px] text-xs pointer-events-none"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y,
            }}
          >
            <div className="flex items-center gap-1 mb-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: hoveredMention.post.blogger.color,
                }}
              />
              <span className="font-mono font-bold">
                @{hoveredMention.post.blogger.xUsername}
              </span>
              {hoveredMention.sentiment && (
                <span
                  className="text-xs px-1 rounded"
                  style={{
                    color: hoveredMention.sentiment === "bullish" ? "#dc2626" : "#16a34a",
                  }}
                >
                  {hoveredMention.sentiment === "bullish" ? "看多" : "看空"}
                </span>
              )}
              <span className="text-[var(--text-secondary)] ml-auto">
                {new Date(hoveredMention.post.postedAt).toLocaleDateString(
                  "zh-CN"
                )}
              </span>
            </div>
            <p className="text-[var(--text-primary)] line-clamp-3">
              {hoveredMention.post.content}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
