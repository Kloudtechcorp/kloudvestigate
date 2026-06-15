"use client";

import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ActiveDotProps, TooltipContentProps } from "recharts";
import type { IntervalSummary, MetricKey, TelemetryAnalysis } from "@/lib/telemetry-types";
import type { MetricInvestigationAnalysis } from "./types";
import { formatTime } from "./utils";

export function TelemetryTimeline({
  analysis,
  metricAnalyses,
  aggregationMinutes,
  sourceLabel,
}: {
  analysis?: TelemetryAnalysis;
  metricAnalyses?: MetricInvestigationAnalysis[];
  aggregationMinutes?: number;
  sourceLabel: string;
}) {
  return (
    <div className="panel">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="panel-title">Telemetry Timeline</h2>
          <p className="text-sm text-muted-foreground">
            Aggregated summaries with metric-specific ranges, spike limits, warnings, and missing-data markers.
          </p>
        </div>
        <span className="status-chip">{sourceLabel}</span>
      </div>
      <TelemetryChart
        analysis={analysis}
        metricAnalyses={metricAnalyses}
        aggregationMinutes={aggregationMinutes}
      />
    </div>
  );
}

function TelemetryChart({
  analysis,
  metricAnalyses,
  aggregationMinutes,
}: {
  analysis?: TelemetryAnalysis;
  metricAnalyses?: MetricInvestigationAnalysis[];
  aggregationMinutes?: number;
}) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [connectNulls, setConnectNulls] = useState(true);
  const [selectedTooltipOnly, setSelectedTooltipOnly] = useState(true);
  const analyses = useMemo(
    () => getTimelineAnalyses(analysis, metricAnalyses),
    [analysis, metricAnalyses],
  );
  const chartOptions = useMemo(
    () => analyses.filter((item) => item.metric !== "windDirection"),
    [analyses],
  );
  const selected = chartOptions.find((item) => item.metric === selectedMetric) ?? chartOptions[0];
  const intervals = useMemo(() => selected?.analysis.intervals ?? [], [selected?.analysis.intervals]);
  const tooltipValuesByTimestamp = useMemo(
    () => buildTooltipValuesByTimestamp(analyses),
    [analyses],
  );
  const chartData = useMemo(
    () => intervals.map((interval) => ({
      interval,
      start: interval.start,
      end: interval.end,
      label: interval.label,
      maximum: getIntervalChartValue(interval),
      values: tooltipValuesByTimestamp.get(interval.start) ?? [],
    })),
    [intervals, tooltipValuesByTimestamp],
  );
  const selectedChartData = useMemo(
    () => chartData.map((point) => ({
      ...point,
      values: selectedTooltipOnly
        ? point.values.filter((item) => item.metric === selected?.metric)
        : point.values,
    })),
    [chartData, selected?.metric, selectedTooltipOnly],
  );
  const chartKind = selected ? getMetricChartKind(selected.metric) : "line";
  const profile = selected?.analysis.metricProfile;
  const intervalMinutes = aggregationMinutes ?? inferAggregationMinutes(intervals);

  if (!selected) {
    return (
      <div className="rounded border border-border-subtle bg-surface p-4 text-sm text-muted-foreground">
        No plottable metric is available for this timeline.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="inline-flex w-full flex-wrap gap-1 rounded-xl border border-border bg-accent-muted-surface p-1 sm:w-auto">
            {chartOptions.map((item) => {
              const active = item.metric === selected.metric;
              const itemProfile = item.analysis.metricProfile;

              return (
                <button
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "bg-card text-card-foreground shadow-hairline"
                      : "text-muted-foreground hover:bg-surface"
                  }`}
                  key={item.metric}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedMetric(item.metric)}
                >
                  {itemProfile.label}
                </button>
              );
            })}
          </div>
          <button
            className={`w-fit rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              connectNulls
                ? "border-accent-border bg-card text-card-foreground shadow-hairline"
                : "border-border text-muted-foreground hover:bg-surface"
            }`}
            type="button"
            aria-pressed={connectNulls}
            onClick={() => setConnectNulls((current) => !current)}
          >
            Connect missing points: {connectNulls ? "On" : "Off"}
          </button>
          <button
            className={`w-fit rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              selectedTooltipOnly
                ? "border-accent-border bg-card text-card-foreground shadow-hairline"
                : "border-border text-muted-foreground hover:bg-surface"
            }`}
            type="button"
            aria-pressed={selectedTooltipOnly}
            onClick={() => setSelectedTooltipOnly((current) => !current)}
          >
            Tooltip selected only: {selectedTooltipOnly ? "On" : "Off"}
          </button>
        </div>
        {profile ? (
          <p className="text-xs text-label">
            {profile.label}: {getMetricChartKindLabel(chartKind)} chart; acceptable range{" "}
            {profile.acceptableRange.minimum} to {profile.acceptableRange.maximum} {profile.unit}; spike limit{" "}
            {profile.spikeDelta} {profile.unit}; interval {formatIntervalMinutes(intervalMinutes)}.
          </p>
        ) : null}
      </div>
      <div className="h-[260px] rounded border border-border-subtle bg-surface">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={selectedChartData}
            margin={{ top: 12, right: 12, bottom: 12, left: 12 }}
            accessibilityLayer
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              interval="preserveStartEnd"
              minTickGap={28}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              content={TimelineTooltip}
              cursor={{ stroke: "var(--chart-grid)", strokeDasharray: "4 4" }}
              allowEscapeViewBox={{ x: true, y: true }}
            />
            <MetricSeries kind={chartKind} data={selectedChartData} connectNulls={connectNulls} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type ChartKind = "line" | "area" | "bar";

interface TimelinePoint {
  interval: IntervalSummary;
  start: string;
  end: string;
  label: string;
  maximum: number | null;
  values: TooltipMetricValue[];
}

interface TooltipMetricValue {
  metric: MetricKey;
  label: string;
  unit: string;
  maximum: number | null;
  average: number;
  missing: boolean;
}

interface TimelineAnalysisOption {
  metric: MetricKey;
  analysis: TelemetryAnalysis;
}

function MetricSeries({
  kind,
  data,
  connectNulls,
}: {
  kind: ChartKind;
  data: TimelinePoint[];
  connectNulls: boolean;
}) {
  if (kind === "area") {
    return (
      <Area
        type="monotone"
        dataKey="maximum"
        stroke="var(--chart-line)"
        strokeWidth={3}
        fill="var(--chart-line)"
        fillOpacity={0.16}
        dot={false}
        activeDot={TimelineActiveDot}
        connectNulls={connectNulls}
        isAnimationActive={false}
      />
    );
  }

  if (kind === "bar") {
    return (
      <Bar dataKey="maximum" radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {data.map((point) => (
          <Cell fill={getIntervalColor(point.interval)} key={point.start} />
        ))}
      </Bar>
    );
  }

  return (
    <Line
      type="monotone"
      dataKey="maximum"
      stroke="var(--chart-line)"
      strokeWidth={3}
      dot={false}
      activeDot={TimelineActiveDot}
      connectNulls={connectNulls}
      isAnimationActive={false}
    />
  );
}

function TimelineTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as TimelinePoint | undefined;

  if (!active || !point) return null;

  return (
    <div className="min-w-58 max-w-80 rounded-[6px] border border-border-strong bg-card p-3 text-xs shadow-lg">
      <p className="font-semibold text-card-foreground">
        {formatTime(point.interval.start)}
      </p>
      <p className="mt-1 text-label">
        to {formatTime(point.interval.end)}
      </p>
      <div className="mt-3 grid gap-2">
        {point.values.length ? point.values.map((item) => (
          <div className="flex items-center justify-between gap-4" key={item.label}>
            <span className="text-subtle-foreground">{item.label}</span>
            <span className="font-mono font-semibold text-foreground">
              {item.missing ? "Missing" : `${formatMetricValue(item.maximum)} ${item.unit}`}
            </span>
          </div>
        )) : (
          <div className="flex items-center justify-between gap-4">
            <span className="text-subtle-foreground">Maximum</span>
            <span className="font-mono font-semibold text-foreground">
              {point.interval.recordCount ? formatMetricValue(point.interval.maximum) : "Missing"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineActiveDot({ cx, cy, payload }: ActiveDotProps) {
  if (typeof cx !== "number" || typeof cy !== "number") return null;

  const point = payload as TimelinePoint;

  return (
    <circle
      cx={cx}
      cy={cy}
      r="6"
      fill={getIntervalColor(point.interval)}
      stroke="var(--surface)"
      strokeWidth="2"
    />
  );
}

function getTimelineAnalyses(
  analysis?: TelemetryAnalysis,
  metricAnalyses?: MetricInvestigationAnalysis[],
): TimelineAnalysisOption[] {
  if (metricAnalyses?.length) {
    return metricAnalyses.map((item) => ({
      metric: item.metric,
      analysis: item.analysis,
    }));
  }

  return analysis
    ? [{
      metric: analysis.metricProfile.metric,
      analysis,
    }]
    : [];
}

function buildTooltipValuesByTimestamp(
  analyses: TimelineAnalysisOption[],
) {
  const values = new Map<string, TooltipMetricValue[]>();

  for (const item of analyses) {
    const profile = item.analysis.metricProfile;
    for (const interval of item.analysis.intervals) {
      const row = values.get(interval.start) ?? [];
      row.push({
        metric: profile.metric,
        label: profile.label,
        unit: profile.unit,
        maximum: getIntervalChartValue(interval),
        average: interval.average,
        missing: interval.recordCount === 0,
      });
      values.set(interval.start, row);
    }
  }

  return values;
}

function getIntervalChartValue(interval: IntervalSummary) {
  return interval.recordCount > 0 ? interval.maximum : null;
}

function getMetricChartKind(metric: MetricKey): ChartKind {
  if (metric === "humidity" || metric === "lightIntensity" || metric === "pressure") return "area";
  if (metric === "precipitation" || metric === "uvIndex" || metric === "windSpeed") return "bar";
  return "line";
}

function getMetricChartKindLabel(kind: ChartKind) {
  if (kind === "area") return "area";
  if (kind === "bar") return "bar";
  return "line";
}

function inferAggregationMinutes(intervals: IntervalSummary[]) {
  const first = intervals[0];
  if (!first) return undefined;

  const start = new Date(first.start).getTime();
  const end = new Date(first.end).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;

  const minutes = Math.round((end - start) / 60_000);
  return minutes > 0 ? minutes : undefined;
}

function formatIntervalMinutes(minutes?: number) {
  if (!minutes) return "from fetched buckets";
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hr${minutes === 60 ? "" : "s"}`;
  return `${minutes} min`;
}

function formatMetricValue(value: number | null) {
  if (value === null) return "Missing";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function getIntervalColor(item: IntervalSummary) {
  if (item.dominantWarningLevel === "Critical" || item.dominantWarningLevel === "Warning") return "var(--danger)";
  if (item.missingCount) return "var(--warning)";
  return "var(--chart-line)";
}
