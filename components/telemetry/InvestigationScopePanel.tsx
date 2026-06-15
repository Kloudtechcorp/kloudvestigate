"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { InvestigationMetricKey, StationMetadata } from "@/lib/telemetry-types";
import type { InvestigationResponse, MetricOption } from "./types";

const quickCommands: Array<{ label: string; href: string }> = [
  { label: "Get Pubmat Heat Index (2PM)", href: "/pubmat?metric=heatIndex&interval=60&run=1" },
  { label: "Get Pubmat Temperature (2PM)", href: "/pubmat?metric=temperature&interval=60&run=1" },
  // { label: "Get Pubmat Rainfall (2PM)", href: "/pubmat?metric=rainfall&interval=60&run=1" },
  // { label: "Get Pubmat All Metrics (2PM)", href: "/pubmat?metric=all&interval=60&run=1" },
];

type InvestigationScopePanelProps = {
  stations: StationMetadata[];
  stationId: string;
  metric: InvestigationMetricKey;
  metrics: MetricOption[];
  start: string;
  end: string;
  aggregationMinutes: number;
  onStationChange: (value: string) => void;
  onMetricChange: (value: InvestigationMetricKey) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onAggregationChange: (value: number) => void;
  onRunInvestigation: () => void;
  runInvestigationBusy?: boolean;
  runInvestigationDisabled?: boolean;
  onQuickInvestigateEveryStation?: () => void;
  quickActionBusy?: boolean;
  quickActionProgress?: string;
  quickActionResultsByStationId?: Record<string, InvestigationResponse>;
  batchCustomScopeEnabled?: boolean;
  batchStart?: string;
  batchEnd?: string;
  batchAggregationMinutes?: number;
  batchStationIds?: string[] | null;
  onBatchStationIdsChange?: (value: string[] | null) => void;
  onBatchCustomScopeEnabledChange?: (value: boolean) => void;
  onBatchStartChange?: (value: string) => void;
  onBatchEndChange?: (value: string) => void;
  onBatchAggregationChange?: (value: number) => void;
  sourceLabel?: string;
};

export function InvestigationScopePanel(props: InvestigationScopePanelProps) {
  const {
    stations,
    stationId,
    onStationChange,
    onQuickInvestigateEveryStation,
    quickActionBusy,
    quickActionProgress,
    quickActionResultsByStationId = {},
    batchCustomScopeEnabled = false,
    batchStart,
    batchEnd,
    batchAggregationMinutes = 1,
    batchStationIds = null,
    onBatchStationIdsChange,
    onBatchCustomScopeEnabledChange,
    onBatchStartChange,
    onBatchEndChange,
    onBatchAggregationChange,
    sourceLabel,
  } = props;
  const hasQuickActionResults = quickActionBusy || Object.keys(quickActionResultsByStationId).length > 0;
  const batchControlsMounted = useHydrated();

  return (
    <aside className="panel h-fit overflow-hidden p-0 lg:sticky lg:top-16 lg:max-h-[calc(100vh-64px)] lg:overflow-y-auto">
      <div className="border-b border-border bg-bg-raised px-4 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Scope</h2>
      </div>
      <div className="grid gap-4 px-4 py-4">
        <ScopeFields {...props} />
        <RunInvestigationControl {...props} />
        <QuickCommandsSection />
        {onQuickInvestigateEveryStation ? (
          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-text-muted">
              Station Batch
            </summary>
            {batchControlsMounted ? (
              <StationBatchSection
                stations={stations}
                stationId={stationId}
                onStationChange={onStationChange}
                onQuickInvestigateEveryStation={onQuickInvestigateEveryStation}
                quickActionBusy={quickActionBusy}
                quickActionProgress={quickActionProgress}
                quickActionResultsByStationId={quickActionResultsByStationId}
                hasQuickActionResults={hasQuickActionResults}
                customScopeEnabled={batchCustomScopeEnabled}
                customStart={batchStart}
                customEnd={batchEnd}
                customAggregationMinutes={batchAggregationMinutes}
                selectedStationIds={batchStationIds}
                onSelectedStationIdsChange={onBatchStationIdsChange}
                onCustomScopeEnabledChange={onBatchCustomScopeEnabledChange}
                onCustomStartChange={onBatchStartChange}
                onCustomEndChange={onBatchEndChange}
                onCustomAggregationChange={onBatchAggregationChange}
              />
            ) : (
              <StationBatchPlaceholder />
            )}
          </details>
        ) : null}
        <EnvironmentLine sourceLabel={sourceLabel} />
      </div>
    </aside>
  );
}

const aggregationOptions = [
  { label: "1m", value: 1 },
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
  { label: "1h", value: 60 },
  { label: "6h", value: 360 },
  { label: "12h", value: 720 },
  { label: "Daily", value: 1440 },
];

function ScopeFields({
  stations,
  stationId,
  metric,
  metrics,
  start,
  end,
  aggregationMinutes,
  onStationChange,
  onMetricChange,
  onStartChange,
  onEndChange,
  onAggregationChange,
}: InvestigationScopePanelProps) {
  return (
    <section className="grid gap-3">
      <label className="field-label">
        Station
        {stations.length ? (
          <select className="field" value={stationId} onChange={(event) => onStationChange(event.target.value)}>
            {stations.map((station) => (
              <option key={station.id} value={station.id}>{station.name}</option>
            ))}
          </select>
        ) : (
          <span className="h-8 w-full animate-pulse rounded-[4px] bg-bg-raised" />
        )}
      </label>

      <label className="field-label">
        Metric
        <select className="field" value={metric} onChange={(event) => onMetricChange(event.target.value as InvestigationMetricKey)}>
          {metrics.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>

      <div className="grid gap-3">
        <label className="field-label">
          Start
          <span className="flex items-center gap-2">
            <input className="field min-w-0 flex-1" type="datetime-local" value={start} onChange={(event) => onStartChange(event.target.value)} />
            <span className="status-chip">PHT</span>
          </span>
        </label>
        <label className="field-label">
          End
          <span className="flex items-center gap-2">
            <input className="field min-w-0 flex-1" type="datetime-local" value={end} onChange={(event) => onEndChange(event.target.value)} />
            <span className="status-chip">PHT</span>
          </span>
        </label>
      </div>

      <div className="grid gap-1">
        <span className="field-label">Aggregation</span>
        <div className="grid grid-cols-3 gap-1">
          {aggregationOptions.map((option) => (
            <button
              className={`h-7 rounded-[3px] border px-2 text-xs font-medium ${
                aggregationMinutes === option.value
                  ? "border-accent bg-accent text-[#111318]"
                  : "border-border bg-bg-raised text-text-secondary hover:text-text-primary"
              }`}
              key={option.value}
              type="button"
              onClick={() => onAggregationChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function RunInvestigationControl({
  onRunInvestigation,
  runInvestigationBusy,
  runInvestigationDisabled,
}: InvestigationScopePanelProps) {
  return (
    <button
      className="primary-action h-9 w-full"
      type="button"
      onClick={onRunInvestigation}
      disabled={runInvestigationBusy || runInvestigationDisabled}
    >
      {runInvestigationBusy ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#111318] border-t-transparent" />
          Running...
        </span>
      ) : "Run investigation"}
    </button>
  );
}

function EnvironmentLine({ sourceLabel }: { sourceLabel?: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-text-muted">
      <span>
        ENV: <span className="font-mono">{sourceLabel?.includes("KloudTrack") ? "production" : "demo"}</span>
      </span>
      <span>
        SOURCE: <span className="font-mono">{sourceLabel ?? "Demo fallback"}</span>
      </span>
    </div>
  );
}

function QuickCommandsSection() {
  return (
    <div className="border-t border-border pt-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-label">Quick commands</p>
      <div className="mt-3 grid gap-2">
        {quickCommands.map((item) => (
          <Link className="quick-link-button" href={item.href} key={item.href}>
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function StationBatchPlaceholder() {
  return (
    <div className="mt-3">
      <div className="mt-3 rounded-[6px] border border-border-subtle bg-surface p-3">
        <p className="text-sm font-semibold text-card-foreground">Batch stations</p>
        <p className="mt-2 text-xs leading-5 text-label">Loading station selection</p>
      </div>
      <button className="primary-action mt-3 w-full" type="button" disabled>
        Loading batch controls
      </button>
    </div>
  );
}

function StationBatchSection({
  stations,
  stationId,
  onStationChange,
  onQuickInvestigateEveryStation,
  quickActionBusy,
  quickActionProgress,
  quickActionResultsByStationId,
  hasQuickActionResults,
  customScopeEnabled,
  customStart,
  customEnd,
  customAggregationMinutes,
  selectedStationIds,
  onSelectedStationIdsChange,
  onCustomScopeEnabledChange,
  onCustomStartChange,
  onCustomEndChange,
  onCustomAggregationChange,
}: {
  stations: StationMetadata[];
  stationId: string;
  onStationChange: (value: string) => void;
  onQuickInvestigateEveryStation: () => void;
  quickActionBusy?: boolean;
  quickActionProgress?: string;
  quickActionResultsByStationId: Record<string, InvestigationResponse>;
  hasQuickActionResults: boolean;
  customScopeEnabled: boolean;
  customStart?: string;
  customEnd?: string;
  customAggregationMinutes: number;
  selectedStationIds: string[] | null;
  onSelectedStationIdsChange?: (value: string[] | null) => void;
  onCustomScopeEnabledChange?: (value: boolean) => void;
  onCustomStartChange?: (value: string) => void;
  onCustomEndChange?: (value: string) => void;
  onCustomAggregationChange?: (value: number) => void;
}) {
  const canEditCustomScope =
    Boolean(onCustomScopeEnabledChange && onCustomStartChange && onCustomEndChange && onCustomAggregationChange);
  const allStationIds = stations.map((station) => station.id);
  const effectiveSelectedStationIds = selectedStationIds ?? allStationIds;
  const selectedStationIdSet = new Set(effectiveSelectedStationIds);
  const selectedCount = stations.filter((station) => selectedStationIdSet.has(station.id)).length;
  const batchDisabled = quickActionBusy || selectedCount === 0;

  function updateSelectedStation(stationId: string, selected: boolean) {
    if (!onSelectedStationIdsChange) return;

    const nextIds = selected
      ? [...effectiveSelectedStationIds, stationId]
      : effectiveSelectedStationIds.filter((id) => id !== stationId);

    onSelectedStationIdsChange([...new Set(nextIds)].filter((id) => allStationIds.includes(id)));
  }

  return (
    <div className="mt-3">
      {onSelectedStationIdsChange ? (
        <div className="mt-3 rounded-[6px] border border-border-subtle bg-surface p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-card-foreground">Batch stations</p>
            <span className="text-xs text-label">{selectedCount}/{stations.length}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="nav-pill min-h-8 px-2 py-1 text-xs"
              type="button"
              onClick={() => onSelectedStationIdsChange(allStationIds)}
            >
              Select all
            </button>
            <button
              className="nav-pill min-h-8 px-2 py-1 text-xs"
              type="button"
              onClick={() => onSelectedStationIdsChange(stationId ? [stationId] : [])}
            >
              Current only
            </button>
            <button
              className="nav-pill min-h-8 px-2 py-1 text-xs"
              type="button"
              onClick={() => onSelectedStationIdsChange([])}
            >
              Clear
            </button>
          </div>
          <div className="mt-3 max-h-56 overflow-auto rounded-[6px] border border-border-faint bg-surface-muted">
            {stations.length ? stations.map((station) => (
              <label
                className="flex min-h-11 items-center gap-3 border-b border-border-faint px-3 py-2 text-sm last:border-b-0"
                key={station.id}
              >
                <input
                  className="h-4 w-4 accent-primary"
                  type="checkbox"
                  checked={selectedStationIdSet.has(station.id)}
                  onChange={(event) => updateSelectedStation(station.id, event.target.checked)}
                />
                <span className="min-w-0 truncate text-card-foreground">{station.name}</span>
              </label>
            )) : (
              <p className="px-3 py-2 text-sm text-label">Loading stations</p>
            )}
          </div>
        </div>
      ) : null}
      {canEditCustomScope ? (
        <div className="mt-3 rounded-[6px] border border-border-subtle bg-surface p-3">
          <label className="flex items-center justify-between gap-3 text-sm font-medium text-card-foreground">
            <span>Custom batch scope</span>
            <input
              className="h-4 w-4 accent-primary"
              type="checkbox"
              checked={customScopeEnabled}
              onChange={(event) => onCustomScopeEnabledChange?.(event.target.checked)}
            />
          </label>
          {customScopeEnabled ? (
            <div className="mt-3 grid gap-3">
              <label className="field-label">
                Batch start (PH)
                <input
                  className="field"
                  type="datetime-local"
                  value={customStart ?? ""}
                  onChange={(event) => onCustomStartChange?.(event.target.value)}
                />
              </label>
              <label className="field-label">
                Batch end (PH)
                <input
                  className="field"
                  type="datetime-local"
                  value={customEnd ?? ""}
                  onChange={(event) => onCustomEndChange?.(event.target.value)}
                />
              </label>
              <label className="field-label">
                Batch interval
                <select
                  className="field"
                  value={customAggregationMinutes}
                  onChange={(event) => onCustomAggregationChange?.(Number(event.target.value))}
                >
                  <option value={1}>1 minute</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={360}>6 hours</option>
                  <option value={720}>12 hours</option>
                  <option value={1440}>Daily</option>
                </select>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        className="primary-action mt-3 w-full"
        type="button"
        onClick={onQuickInvestigateEveryStation}
        disabled={batchDisabled}
      >
        {quickActionBusy
          ? `Investigating selected stations${quickActionProgress ? ` (${quickActionProgress})` : ""}`
          : `Investigate selected stations (${selectedCount})`}
      </button>
      <p className="mt-2 text-xs leading-5 text-label">
        {customScopeEnabled
          ? "Custom range, all metrics, selected interval, selected stations only, throttled to 3 requests per second."
          : "Yesterday, full day, all metrics, 1-minute aggregation, selected stations only, throttled to 3 requests per second."}
      </p>
      {hasQuickActionResults ? (
        <StationBatchSummary
          stations={stations}
          stationId={stationId}
          onStationChange={onStationChange}
          quickActionBusy={quickActionBusy}
          quickActionProgress={quickActionProgress}
          quickActionResultsByStationId={quickActionResultsByStationId}
        />
      ) : null}
    </div>
  );
}

function StationBatchSummary({
  stations,
  stationId,
  onStationChange,
  quickActionBusy,
  quickActionProgress,
  quickActionResultsByStationId,
}: {
  stations: StationMetadata[];
  stationId: string;
  onStationChange: (value: string) => void;
  quickActionBusy?: boolean;
  quickActionProgress?: string;
  quickActionResultsByStationId: Record<string, InvestigationResponse>;
}) {
  return (
    <div className="mt-4 border-t border-border-subtle pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-label">Station summary</p>
        {quickActionProgress ? <span className="text-xs text-label">{quickActionProgress}</span> : null}
      </div>
      <div className="mt-3 max-h-[600px] overflow-auto rounded-[6px] border border-border-subtle bg-surface">
        {stations.map((station) => {
          const result = quickActionResultsByStationId[station.id];
          const counts = getStationIssueCounts(result);
          const isSelected = station.id === stationId;

          return (
            <button
              className={`grid w-full gap-2 border-b border-border-faint p-3 text-left last:border-b-0 hover:bg-surface-muted ${isSelected ? "bg-surface-selected" : ""}`}
              key={station.id}
              type="button"
              onClick={() => onStationChange(station.id)}
            >
              <span className="min-w-0 truncate text-sm font-semibold text-card-foreground">{station.name}</span>
              {result ? (
                <span className="grid grid-cols-2 gap-3 text-xs text-subtle-foreground">
                  <IssueCount label="Missing" value={counts.missing} tone={counts.missing ? "caution" : "neutral"} />
                  <IssueCount label="Range" value={counts.outOfRange} tone={counts.outOfRange ? "danger" : "neutral"} />
                  {/* <IssueCount label="Warnings" value={counts.warnings} tone={counts.warnings ? "danger" : "neutral"} /> */}
                </span>
              ) : (
                <span className="text-xs text-label">{quickActionBusy ? "Pending" : "No quick-action data"}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getStationIssueCounts(result?: InvestigationResponse) {
  if (result?.metricAnalyses?.length) {
    return result.metricAnalyses.reduce(
      (counts, item) => ({
        missing: counts.missing + item.analysis.summary.missingRecordCount,
        outOfRange: counts.outOfRange + item.analysis.rangeViolations.length,
        // warnings: counts.warnings + item.analysis.thresholdCrossings.length,
      }),
      { missing: 0, outOfRange: 0 },
    );
  }

  return {
    missing: result?.analysis.summary.missingRecordCount ?? 0,
    outOfRange: result?.analysis.rangeViolations.length ?? 0,
    // warnings: result?.analysis.thresholdCrossings.length ?? 0,
  };
}

function IssueCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "caution" | "danger";
}) {
  const toneClass = tone === "danger"
    ? "text-danger-foreground"
    : tone === "caution"
      ? "text-warning-foreground"
      : "text-label";

  return (
    <span className="grid gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-label">{label}</span>
      <span className={`font-mono text-sm font-semibold ${toneClass}`}>{value}</span>
    </span>
  );
}
