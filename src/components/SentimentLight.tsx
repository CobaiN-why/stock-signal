interface Props {
  signalStrength: number; // 0-100, 50 = neutral, >50 = bullish, <50 = bearish
  size?: "sm" | "md" | "lg";
}

export default function SentimentLight({ signalStrength, size = "md" }: Props) {
  const sizeClass =
    size === "sm" ? "w-2.5 h-2.5" : size === "lg" ? "w-5 h-5" : "w-3.5 h-3.5";

  // Color: green = bullish (A-share convention: red=up/bullish), red = bearish (green=down/bearish)
  let color: string;
  let label: string;

  if (signalStrength >= 65) {
    color = "bg-red-500 shadow-red-300"; // strong bullish
    label = "强看多";
  } else if (signalStrength >= 55) {
    color = "bg-red-400 shadow-red-200"; // weak bullish
    label = "弱看多";
  } else if (signalStrength <= 35) {
    color = "bg-green-500 shadow-green-300"; // strong bearish
    label = "强看空";
  } else if (signalStrength <= 45) {
    color = "bg-green-400 shadow-green-200"; // weak bearish
    label = "弱看空";
  } else {
    color = "bg-amber-400 shadow-amber-200"; // neutral
    label = "中性";
  }

  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span
        className={`inline-block ${sizeClass} rounded-full ${color} shadow-sm`}
      />
      {size === "lg" && (
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      )}
    </span>
  );
}
