"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";
import type { Market } from "@/lib/markets";

// ── Types ──

interface Mention {
  id: string;
  mentionType: string;
  associationType?: "direct_stock" | "direct_sector" | "inferred_sector";
  confidence?: number;
  evidence?: string;
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
  volume?: number;
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

// ── Constants ──

const COLORS = {
  up: { border: "#26a69a", fill: "rgba(38, 166, 154, 0.5)", wick: "#26a69a" },
  down: { border: "#ef5350", fill: "rgba(239, 83, 80, 0.5)", wick: "#ef5350" },
  volumeUp: "rgba(38, 166, 154, 0.4)",
  volumeDown: "rgba(239, 83, 80, 0.4)",
};

// ── Component ──

export default function PriceChart({
  market,
  ticker,
  selectedBlogger,
  onMentionClick,
}: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [data, setData] = useState<StockDetail | null>(null);
  const [hoveredMention, setHoveredMention] = useState<Mention | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  // ── Data fetching ──

  useEffect(() => {
    if (!ticker) return;
    fetch(`/api/stocks/${ticker}?market=${market}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [ticker, market]);

  // ── Chart rendering ──

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.prices.length === 0) return;

    // Cleanup previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersRef.current = null;
    }

    const container = chartContainerRef.current;
    const width = container.clientWidth;

    const chart = createChart(container, {
      width,
      height: 440,
      layout: {
        background: { color: "transparent" },
        textColor: "#888888",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(128,128,128,0.08)" },
        horzLines: { color: "rgba(128,128,128,0.08)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.05, bottom: 0.25 },
        autoScale: true,
      },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "#888888", width: 1, style: 2, labelVisible: false },
        horzLine: { color: "#888888", width: 1, style: 2, labelVisible: false },
        mode: 0,
      },
    });

    chartRef.current = chart;

    // ── Candlestick series (K-line) ──
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up.fill,
      downColor: COLORS.down.fill,
      borderUpColor: COLORS.up.border,
      borderDownColor: COLORS.down.border,
      wickUpColor: COLORS.up.wick,
      wickDownColor: COLORS.down.wick,
    });
    candleSeriesRef.current = candleSeries;

    const candleData = data.prices.map((p) => ({
      time: p.date.slice(0, 10) as Time,
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
    }));
    candleSeries.setData(candleData);

    // ── Volume histogram (pane below K-line) ──
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
    });
    volumeSeriesRef.current = volumeSeries;

    // Set up volume scale (bottom pane)
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      borderVisible: false,
    });

    const volumeData = data.prices.map((p, i) => {
      const prevClose = i > 0 ? data.prices[i - 1].close : p.open;
      const isUp = p.close >= prevClose;
      return {
        time: p.date.slice(0, 10) as Time,
        value: p.volume || 0,
        color: isUp ? COLORS.volumeUp : COLORS.volumeDown,
      };
    });
    volumeSeries.setData(volumeData);

    // ── Mention markers (blogger sentiment arrows) ──
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
          text: uniqueBloggers.length > 1 && i === 0
            ? `${uniqueBloggers.length}`
            : "",
          size: 2,
        });
      });
    }
    markers.sort((a, b) => (a.time < b.time ? -1 : 1));
    markersRef.current = createSeriesMarkers(candleSeries, markers);

    // ── Crosshair: tooltip hover ──
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setHoveredMention(null);
        return;
      }
      const dateStr = param.time as string;
      const mentions = mentionsByDate.get(dateStr);
      if (mentions && mentions.length > 0) {
        const w = container.clientWidth;
        setHoveredMention(mentions[0]);
        setTooltipPos({ x: Math.min(param.point.x, w - 300), y: Math.max(0, param.point.y - 100) });
      } else {
        setHoveredMention(null);
      }
    });

    // ── Click handler ──
    chart.subscribeClick((param) => {
      if (!param.time || !data) return;
      const clickDate = param.time as string;
      const mention = data.mentions.find(
        (m) => m.post.postedAt.slice(0, 10) === clickDate
      );
      if (mention) onMentionClick(mention.post.id);
    });

    // ── Resize handler ──
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    chart.timeScale().fitContent();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersRef.current = null;
    };
  }, [data, selectedBlogger]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Association label helper ──
  const associationLabel = (mention: Mention) => {
    if (mention.associationType === "direct_sector") return "直接板块";
    if (mention.associationType === "inferred_sector") return "弱关联推断";
    return "直接标的";
  };

  // ── Empty / loading states ──

  if (!ticker) {
    return (
      <div className="flex items-center justify-center h-[440px] text-[var(--text-secondary)] text-sm">
        选择左侧股票查看价格曲线
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-[440px] text-[var(--text-secondary)] text-sm">
        加载中...
      </div>
    );
  }

  // ── Blogger mention counts ──
  const bloggerCounts = new Map<
    string,
    { color: string; count: number }
  >();
  for (const m of data.mentions) {
    const key = m.post.blogger.xUsername;
    const existing = bloggerCounts.get(key);
    if (existing) existing.count++;
    else bloggerCounts.set(key, { color: m.post.blogger.color, count: 1 });
  }

  const priceChange =
    data.prices.length >= 2
      ? data.prices[data.prices.length - 1].close -
        data.prices[data.prices.length - 2].close
      : 0;
  const priceChangePct =
    data.prices.length >= 2 && data.prices[data.prices.length - 2].close > 0
      ? (priceChange / data.prices[data.prices.length - 2].close) * 100
      : 0;

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-serif-title text-lg">
            {data.market === "US" ? "$" : ""}{data.ticker}
          </span>
          {data.companyName && (
            <span className="text-sm text-[var(--text-secondary)]">
              {data.companyName}
            </span>
          )}
          {data.latestPrice && (
            <>
              <span className="font-mono text-lg font-bold">
                {Number(data.latestPrice).toFixed(data.currency === "USD" ? 2 : 3)}
              </span>
              <span
                className={`text-xs font-mono ${
                  priceChange >= 0 ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {priceChange >= 0 ? "+" : ""}
                {priceChange.toFixed(3)} ({priceChangePct >= 0 ? "+" : ""}
                {priceChangePct.toFixed(2)}%)
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Blogger badges */}
          {Array.from(bloggerCounts.entries()).map(([username, info]) => (
            <span
              key={username}
              className="inline-flex items-center gap-1 text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-full px-2 py-0.5"
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: info.color }}
              />
              @{username} ×{info.count}
            </span>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative">
        <div ref={chartContainerRef} />

        {/* Mention tooltip on hover */}
        {hoveredMention && (
          <div
            className="absolute z-10 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-md p-3 max-w-[280px] text-xs pointer-events-none"
            style={{ left: tooltipPos.x, top: tooltipPos.y }}
          >
            <div className="flex items-center gap-1 mb-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: hoveredMention.post.blogger.color }}
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
                {new Date(hoveredMention.post.postedAt).toLocaleDateString("zh-CN")}
              </span>
            </div>
            <p className="text-[var(--text-primary)] line-clamp-3">
              {hoveredMention.post.content}
            </p>
            {hoveredMention.evidence && (
              <p className="mt-1 text-[var(--text-secondary)]">
                关联依据：{hoveredMention.evidence}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
