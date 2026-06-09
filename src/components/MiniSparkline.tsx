interface DataPoint {
  date: string;
  ratio: number | null; // 0-100, null = no data for that day
}

interface Props {
  data: DataPoint[];
  width?: number;
  height?: number;
  className?: string;
}

export default function MiniSparkline({
  data,
  width = 160,
  height = 36,
  className = "",
}: Props) {
  const validPoints = data
    .map((d, i) => ({ ...d, index: i }))
    .filter((d) => d.ratio !== null) as {
    date: string;
    ratio: number;
    index: number;
  }[];

  if (validPoints.length < 2) {
    return (
      <div
        className={`flex items-center justify-center text-xs text-[var(--text-secondary)] ${className}`}
        style={{ width, height }}
      >
        数据不足
      </div>
    );
  }

  const padding = 2;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const domainMin = 0;
  const domainMax = 100;

  const points = validPoints.map((d, i) => {
    const x = padding + (i / (validPoints.length - 1)) * chartW;
    const y = padding + chartH * (1 - (d.ratio - domainMin) / (domainMax - domainMin));
    return `${x},${y}`;
  });

  // Color based on trend: compare first and last
  const firstRatio = validPoints[0].ratio;
  const lastRatio = validPoints[validPoints.length - 1].ratio;
  const trend =
    lastRatio > firstRatio + 5 ? "up" : lastRatio < firstRatio - 5 ? "down" : "flat";

  const strokeColor =
    trend === "up"
      ? "#dc2626" // red = bullish in Chinese convention
      : trend === "down"
        ? "#16a34a" // green = bearish
        : "#6b6b6b"; // gray = flat

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={`overflow-visible ${className}`}
      preserveAspectRatio="none"
    >
      {/* Neutral zone band (40-60 = neutral) */}
      <rect
        x={padding}
        y={padding + chartH * 0.4}
        width={chartW}
        height={chartH * 0.2}
        fill="none"
      />
      {/* Midline */}
      <line
        x1={padding}
        y1={padding + chartH / 2}
        x2={padding + chartW}
        y2={padding + chartH / 2}
        stroke="#e8e0d0"
        strokeWidth={0.5}
        strokeDasharray="2 2"
      />
      {/* Polyline */}
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
