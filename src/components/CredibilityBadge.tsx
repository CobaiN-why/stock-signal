import type { ConfidenceLabel } from "@/lib/credibility";

interface Props {
  score: number;
  label?: ConfidenceLabel;
  showScore?: boolean;
}

export default function CredibilityBadge({
  score,
  label,
  showScore = true,
}: Props) {
  const resolvedLabel = label ?? getLabel(score);

  const colorClass =
    resolvedLabel === "高"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : resolvedLabel === "中"
        ? "bg-amber-100 text-amber-700 border-amber-200"
        : "bg-gray-100 text-gray-500 border-gray-200";

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${colorClass}`}
      title={`可信度: ${score}`}
    >
      {showScore && <span className="font-mono">{score}</span>}
      <span>{resolvedLabel}</span>
    </span>
  );
}

function getLabel(score: number): ConfidenceLabel {
  if (score >= 70) return "高";
  if (score >= 40) return "中";
  return "低";
}
