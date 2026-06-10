"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
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
  const markersRef = useRef<any>(null);
  const [data, setData] = useState<StockDetail | null>(null);
  const [hoveredMention, setHoveredMention] = useState<Mention | null>(null);
  const [tooltipMentions, setTooltipMentions] = useState<Mention[]>([]);
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
    markersRef.current = null;
    if (chartRef.current) {
      try { chartRef.current.remove(); } catch {}
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    }
    const container = chartContainerRef.current;
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
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

    // ── Daily sentiment markers: one per day, arrow by dominant view ──
    const byDate = new Map<string, { bull: number; bear: number }>();
    for (const m of data.mentions) {
      if (selectedBlogger && m.post.blogger.xUsername !== selectedBlogger) continue;
      const d = m.post.postedAt.slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, { bull: 0, bear: 0 });
      const entry = byDate.get(d)!;
      if (m.sentiment === "bullish") entry.bull++;
      else if (m.sentiment === "bearish") entry.bear++;
    }

    const markers: { time: Time; position: "belowBar"; color: string; shape: "arrowUp" | "arrowDown" | "circle"; text: string }[] = [];
    for (const [date, { bull, bear }] of byDate) {
      const total = bull + bear;
      markers.push({
        time: date as Time,
        position: "belowBar",
        color: bull > bear ? "#ef4444" : bear > bull ? "#22c55e" : "#9ca3af",
        shape: bull > bear ? "arrowUp" : bear > bull ? "arrowDown" : "circle",
        text: total > 1 ? String(total) : "",
      });
    }

    // Reuse existing markers plugin, or create one (createSeriesMarkers
    // always creates a NEW layer — only call it once per chart)
    if (markersRef.current) {
      console.log('[PriceChart] REUSING markers plugin, setting', markers.length, 'markers');
      markersRef.current.setMarkers(markers);
    } else {
      console.log('[PriceChart] CREATING new markers plugin with', markers.length, 'markers');
      markersRef.current = createSeriesMarkers(candleSeries, markers);
    }

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
        {tooltipMentions.length > 0 && (
          <div
            className="absolute z-10 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-md p-3 max-w-[300px] text-xs pointer-events-none"
            style={{ left: tooltipPos.x, top: tooltipPos.y }}
          >
            <div className="text-[var(--text-secondary)] mb-1">
              {tooltipMentions[0].post.postedAt.slice(0, 10)} · {tooltipMentions.length}位博主
            </div>
            {tooltipMentions.map((m, i) => (
              <div key={m.id} className={`flex items-center gap-1.5 ${i > 0 ? "mt-1.5 pt-1.5 border-t border-[var(--border)]" : ""}`}>
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: m.post.blogger.color }}
                />
                <span className="font-mono font-bold">@{m.post.blogger.xUsername}</span>
                {m.sentiment && (
                  <span
                    className="text-xs px-1 rounded"
                    style={{ color: m.sentiment === "bullish" ? "#ef4444" : "#22c55e" }}
                  >
                    {m.sentiment === "bullish" ? "看多" : "看空"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
