interface Props {
  result: string; // "correct" | "incorrect" | "neutral"
  returnPct?: number;
}

export default function BacktestVerdict({ result, returnPct }: Props) {
  const config = {
    correct: {
      label: "正确",
      icon: "✅",
      className: "bg-emerald-100 text-emerald-700 border-emerald-200",
    },
    incorrect: {
      label: "错误",
      icon: "❌",
      className: "bg-red-100 text-red-700 border-red-200",
    },
    neutral: {
      label: "中性",
      icon: "⚪",
      className: "bg-gray-100 text-gray-500 border-gray-200",
    },
  }[result] ?? {
    label: result,
    icon: "",
    className: "bg-gray-100 text-gray-500 border-gray-200",
  };

  const sign =
    returnPct !== undefined ? (returnPct >= 0 ? "+" : "") : "";

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium border ${config.className}`}
      title={
        returnPct !== undefined
          ? `${config.label}: ${sign}${returnPct.toFixed(1)}%`
          : config.label
      }
    >
      {config.icon}{" "}
      {returnPct !== undefined
        ? `${sign}${returnPct.toFixed(1)}%`
        : config.label}
    </span>
  );
}
