"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Focus, ListChecks } from "lucide-react";
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

type SingleStationInvestigationProps = Pick<
  InvestigationScopePanelProps,
  | "stations"
  | "stationId"
  | "metric"
  | "metrics"
  | "start"
  | "end"
  | "aggregationMinutes"
  | "onStationChange"
  | "onMetricChange"
  | "onStartChange"
  | "onEndChange"
  | "onAggregationChange"
  | "onRunInvestigation"
  | "runInvestigationBusy"
  | "runInvestigationDisabled"
  | "sourceLabel"
>;

export function InvestigationScopePanel(props: InvestigationScopePanelProps) {
  return (
    <aside className="grid min-w-0 gap-4 self-start lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-1 lg:pr-2 lg:[scrollbar-gutter:stable]">
      <SingleStationInvestigationCard {...props} />
      {props.onQuickInvestigateEveryStation ? <BatchStationInvestigationCard {...props} /> : null}
      <RelatedShortcutsCard />
    </aside>
  );
}

function SingleStationInvestigationCard(props: SingleStationInvestigationProps) {
  return (
    <CollapsiblePanel
      badge="1 station"
      description="Inspect one station using a specific metric, timeframe, and aggregation."
      icon={<Focus className="h-4 w-4" aria-hidden="true" />}
      iconTone="accent"
      panelId="single-investigation"
      title="Single Station Investigation"
    >
      <div className="grid gap-4">
        <ScopeFields {...props} />
        <RunInvestigationControl {...props} />
        <EnvironmentLine sourceLabel={props.sourceLabel} />
      </div>
    </CollapsiblePanel>
  );
}

function BatchStationInvestigationCard(props: InvestigationScopePanelProps) {
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
  } = props;
  const hasQuickActionResults = quickActionBusy || Object.keys(quickActionResultsByStationId).length > 0;
  if (!onQuickInvestigateEveryStation) return null;

  return (
    <CollapsiblePanel
      badge="Multi-station"
      description="Compare the same investigation window across several stations in one run."
      icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
      panelId="batch-investigation"
      title="Batch Station Investigation"
    >
      <div className="min-w-0">
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
      </div>
    </CollapsiblePanel>
  );
}

function CollapsiblePanel({
  badge,
  children,
  defaultExpanded = true,
  description,
  icon,
  iconTone = "neutral",
  panelId,
  title,
}: {
  badge?: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  description?: string;
  icon?: ReactNode;
  iconTone?: "accent" | "neutral";
  panelId: string;
  title: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = `${panelId}-content`;
  const titleId = `${panelId}-title`;

  return (
    <section className="panel min-w-0 shrink-0 overflow-hidden p-0" aria-labelledby={titleId}>
      <button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 bg-bg-raised px-4 py-3 text-left hover:bg-bg-surface focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        {icon ? (
          <span className={`mt-0.5 rounded-[4px] p-2 ${
            iconTone === "accent"
              ? "bg-accent text-[#111318]"
              : "bg-bg-surface text-text-primary ring-1 ring-border"
          }`}>
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-text-primary" id={titleId}>{title}</span>
            {badge ? <span className="status-chip">{badge}</span> : null}
          </span>
          {description ? <span className="mt-1 block text-xs leading-5 text-text-secondary">{description}</span> : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`mt-1 h-4 w-4 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded ? <div className="border-t border-border p-4" id={contentId}>{children}</div> : null}
    </section>
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
}: SingleStationInvestigationProps) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Target</p>
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
      </div>

      <div className="grid gap-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Time range</p>
          <span className="status-chip">PHT</span>
        </div>
        <label className="field-label">
          Start
          <input className="field min-w-0" type="datetime-local" value={start} onChange={(event) => onStartChange(event.target.value)} />
        </label>
        <label className="field-label">
          End
          <input className="field min-w-0" type="datetime-local" value={end} onChange={(event) => onEndChange(event.target.value)} />
        </label>
      </div>

      <div className="grid gap-2 border-t border-border pt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Aggregation</span>
        <div className="grid grid-cols-4 gap-1">
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
}: SingleStationInvestigationProps) {
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
      ) : "Run single-station investigation"}
    </button>
  );
}

function EnvironmentLine({ sourceLabel }: { sourceLabel?: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-3 text-[11px] text-text-muted">
      <span>
        ENV: <span className="font-mono">{sourceLabel?.includes("KloudTrack") ? "production" : "demo"}</span>
      </span>
      <span>
        SOURCE: <span className="font-mono">{sourceLabel ?? "Demo fallback"}</span>
      </span>
    </div>
  );
}

function RelatedShortcutsCard() {
  return (
    <CollapsiblePanel
      defaultExpanded={false}
      icon={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
      panelId="related-shortcuts"
      title="Related Shortcuts"
    >
      <div className="mt-3 grid gap-2">
        {quickCommands.map((item) => (
          <Link className="quick-link-button flex items-center justify-between gap-3" href={item.href} key={item.href}>
            <span>{item.label}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </CollapsiblePanel>
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
    <div className="grid min-w-0 gap-4">
      <div className={`rounded-[4px] border px-3 py-2 ${
        customScopeEnabled
          ? "border-accent bg-accent-subtle"
          : "border-border bg-bg-raised"
      }`}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          {customScopeEnabled ? "Custom batch scope" : "Default batch scope"}
        </p>
        <p className="mt-1 text-xs leading-5 text-text-secondary">
          {customScopeEnabled
            ? "Custom range · all metrics · selected interval"
            : "Yesterday · full day · all metrics · 1-minute aggregation"}
        </p>
      </div>
      {onSelectedStationIdsChange ? (
        <section className="min-w-0" aria-labelledby="batch-station-selection-title">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary" id="batch-station-selection-title">
                Station selection
              </h3>
              <p className="mt-1 text-xs text-text-muted">Choose which stations to include in this run.</p>
            </div>
            <span className="status-chip">{selectedCount}/{stations.length} selected</span>
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
        </section>
      ) : null}
      {canEditCustomScope ? (
        <section className="border-t border-border pt-4" aria-labelledby="batch-timeframe-title">
          <label className="flex items-center justify-between gap-3 text-sm font-medium text-card-foreground">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-wide text-text-secondary" id="batch-timeframe-title">
                Timeframe
              </span>
              <span className="mt-1 block text-xs font-normal text-text-muted">Override yesterday&apos;s default range.</span>
            </span>
            <input
              className="h-4 w-4 accent-primary"
              type="checkbox"
              checked={customScopeEnabled}
              onChange={(event) => onCustomScopeEnabledChange?.(event.target.checked)}
            />
          </label>
          {customScopeEnabled ? (
            <div className="mt-3 grid gap-3">
              <label className="field-label min-w-0">
                Batch start (PH)
                <input
                  className="field min-w-0"
                  type="datetime-local"
                  value={customStart ?? ""}
                  onChange={(event) => onCustomStartChange?.(event.target.value)}
                />
              </label>
              <label className="field-label min-w-0">
                Batch end (PH)
                <input
                  className="field min-w-0"
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
        </section>
      ) : null}
      <div className="border-t border-border pt-4">
        <button
          className="primary-action w-full"
          type="button"
          onClick={onQuickInvestigateEveryStation}
          disabled={batchDisabled}
        >
          {quickActionBusy
            ? `Investigating selected stations${quickActionProgress ? ` (${quickActionProgress})` : ""}`
            : `Run batch investigation (${selectedCount})`}
        </button>
        <p className="mt-2 text-xs leading-5 text-text-muted">
          Requests are throttled to 3 per second. Results appear below and can be opened in the main workspace.
        </p>
      </div>
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
