import type { TelemetryAnalysis } from "@/lib/telemetry-types";
import type { MetricInvestigationAnalysis } from "./types";

export function SummaryStats({
  analysis,
  metricAnalyses,
}: {
  analysis?: TelemetryAnalysis;
  metricAnalyses?: MetricInvestigationAnalysis[];
}) {
  const issueCounts = getIssueCounts(analysis, metricAnalyses);
  const allMetricSummary = getAllMetricSummary(metricAnalyses);
  const stats = allMetricSummary
    ? [
        { label: "Metrics", value: allMetricSummary.metricCount },
        { label: "Records", value: allMetricSummary.recordCount },
        { label: "Missing", value: issueCounts.missing, emphasis: issueCounts.missing ? "caution" as const : undefined },
        { label: "Out of range", value: issueCounts.outOfRange, emphasis: issueCounts.outOfRange ? "danger" as const : undefined },
      ]
    : [
        { label: "Average", value: analysis?.summary.average ?? 0 },
        { label: "Minimum", value: analysis?.summary.minimum ?? 0 },
        { label: "Maximum", value: analysis?.summary.maximum ?? 0, emphasis: analysis?.rangeViolations.length ? "warn" as const : undefined },
        { label: "Out of range", value: issueCounts.outOfRange, emphasis: issueCounts.outOfRange ? "danger" as const : undefined },
      ];

  return (
    <div className="overflow-hidden rounded-[6px] border border-border bg-bg-surface">
      <div className="grid grid-cols-2 md:grid-cols-4">
        {stats.map((stat) => (
          <Stat
            emphasis={stat.emphasis}
            key={stat.label}
            label={stat.label}
            value={stat.value}
          />
        ))}
      </div>
    </div>
  );
}

function getAllMetricSummary(metricAnalyses?: MetricInvestigationAnalysis[]) {
  if (!metricAnalyses || metricAnalyses.length <= 1) return null;

  return metricAnalyses.reduce(
    (summary, item) => ({
      metricCount: summary.metricCount + 1,
      recordCount: summary.recordCount + item.analysis.summary.recordCount,
    }),
    { metricCount: 0, recordCount: 0 },
  );
}

function getIssueCounts(
  analysis?: TelemetryAnalysis,
  metricAnalyses?: MetricInvestigationAnalysis[],
) {
  if (metricAnalyses?.length) {
    return metricAnalyses.reduce(
      (counts, item) => ({
        missing: counts.missing + item.analysis.summary.missingRecordCount,
        outOfRange: counts.outOfRange + item.analysis.rangeViolations.length,
        warnings: counts.warnings + item.analysis.thresholdCrossings.length,
      }),
      { missing: 0, outOfRange: 0, warnings: 0 },
    );
  }

  return {
    missing: analysis?.summary.missingRecordCount ?? 0,
    outOfRange: analysis?.rangeViolations.length ?? 0,
    warnings: analysis?.thresholdCrossings.length ?? 0,
  };
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: "caution" | "warn" | "danger";
}) {
  const valueClass = emphasis === "danger"
    ? "text-danger"
    : emphasis === "caution" || emphasis === "warn"
      ? "text-warning"
      : "text-text-primary";

  return (
    <div className="min-w-[120px] border-r border-b border-border px-4 py-3 last:border-r-0 md:border-b-0">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-1 font-mono text-base font-semibold ${valueClass}`}>{formatStatValue(value)}</p>
    </div>
  );
}

function formatStatValue(value: number) {
  if (!Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? value : Number(value.toFixed(2));
}
