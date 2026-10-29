"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clipboard, LoaderCircle, X } from "lucide-react";
import { getStatusRowClass, StatusChip } from "@/components/telemetry/PubmatQuickFetch";
import { getMetricAnalysisProfile } from "@/lib/metric-profiles";
import type { MetricKey, StationMetadata } from "@/lib/telemetry-types";

const INTERVAL_OPTIONS = [
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "12 hours", value: 720 },
];
const PHT_OFFSET_MS = 8 * 60 * 60_000;

export type StationReadingsTarget = {
  date: string;
  stationId: string;
  stationName: string;
};

type ReadingRow = {
  timestamp: string;
  values: Partial<Record<MetricKey, number>>;
  flags: Partial<Record<MetricKey, string[]>>;
  auditViolations: Partial<Record<MetricKey, number>>;
};

type StationReadingsResponse = {
  date: string;
  intervalMinutes: number;
  station: StationMetadata;
  source: "demo" | "kloudtrack";
  metrics: MetricKey[];
  auditError: string | null;
  auditLogsExpired: boolean;
  recordedRangeViolations: number;
  rows: ReadingRow[];
};

type ReadingStatus = "ready" | "attention" | "missing";

type DisplayRow = ReadingRow & {
  status: ReadingStatus;
  auditCount: number;
  notes: string;
};

export function StationReadingsDialog({
  target,
  onClose,
}: {
  target: StationReadingsTarget;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [metric, setMetric] = useState<MetricKey | "all">("all");
  const [data, setData] = useState<StationReadingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      stationId: target.stationId,
      date: target.date,
      interval: String(intervalMinutes),
    });

    fetch(`/api/audit-reports/readings?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(payload?.message ?? `Readings request failed (${response.status})`);
        }
        return response.json() as Promise<StationReadingsResponse>;
      })
      .then(setData)
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : "Unable to load station readings.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [target.stationId, target.date, intervalMinutes]);

  const selectedMetric = metric !== "all" && data?.metrics.includes(metric) ? metric : "all";
  const visibleMetrics = useMemo(
    () => selectedMetric === "all" ? data?.metrics ?? [] : [selectedMetric],
    [data, selectedMetric],
  );
  const rows = useMemo(
    () => (data?.rows ?? []).map((row) => buildDisplayRow(row, visibleMetrics)),
    [data, visibleMetrics],
  );
  const attentionCount = rows.filter((row) => row.status === "attention").length;
  const missingCount = rows.filter((row) => row.status === "missing").length;
  const auditCount = rows.reduce((total, row) => total + row.auditCount, 0);
  const intervalLabel = INTERVAL_OPTIONS.find((option) => option.value === intervalMinutes)?.label ?? `${intervalMinutes} minutes`;

  function changeInterval(nextInterval: number) {
    setIntervalMinutes(nextInterval);
    setData(null);
    setLoading(true);
    setError(null);
    setCopyState("idle");
  }

  async function copyTsv() {
    if (!rows.length) return;

    try {
      await navigator.clipboard.writeText(buildTsv(target, rows, visibleMetrics));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <dialog
      aria-labelledby="station-readings-title"
      className="m-auto h-[calc(100dvh-2rem)] max-h-none w-[min(80rem,calc(100vw-2rem))] max-w-none flex-col overflow-hidden rounded-[6px] border border-border bg-bg-surface p-0 text-text-primary shadow-lg backdrop:bg-black/50 open:flex"
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Station readings · {formatDate(target.date)}
          </p>
          <h2 className="mt-0.5 truncate text-base font-semibold text-text-primary" id="station-readings-title">
            {target.stationName}
          </h2>
          <p className="font-mono text-xs text-text-muted">{target.stationId}</p>
        </div>
        <button
          aria-label="Close station readings"
          className="icon-button shrink-0"
          onClick={() => dialogRef.current?.close()}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <label className="field-label mt-0">
            Interval
            <select
              className="field min-w-36"
              onChange={(event) => changeInterval(Number(event.target.value))}
              value={intervalMinutes}
            >
              {INTERVAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field-label mt-0">
            Metric
            <select
              className="field min-w-44"
              disabled={!data?.metrics.length}
              onChange={(event) => {
                setMetric(event.target.value as MetricKey | "all");
                setCopyState("idle");
              }}
              value={selectedMetric}
            >
              <option value="all">All</option>
              {data?.metrics.map((key) => (
                <option key={key} value={key}>{getMetricAnalysisProfile(key).label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data ? (
            <>
              <span className="count-chip">{rows.length} rows</span>
              <span className={`count-chip ${attentionCount ? "count-chip-caution" : ""}`}>{attentionCount} need attention</span>
              {data.auditError || data.auditLogsExpired ? null : (
                <span className={`count-chip ${auditCount ? "count-chip-danger" : ""}`}>{auditCount} audit violations</span>
              )}
              {missingCount ? <span className="count-chip">{missingCount} missing</span> : null}
            </>
          ) : null}
          <button
            className="nav-pill inline-flex items-center justify-center gap-2 ring-2 ring-accent disabled:opacity-40"
            disabled={!rows.length}
            onClick={() => void copyTsv()}
            type="button"
          >
            <Clipboard aria-hidden="true" className="h-4 w-4" />
            {copyState === "copied" ? "Copied TSV" : copyState === "failed" ? "Copy failed" : "Copy TSV"}
          </button>
        </div>
      </div>

      {data?.source === "demo" ? (
        <p className="border-b border-warning bg-warning-bg px-4 py-2 text-xs text-warning" role="status">
          Demo data. The selected environment has no KloudTrack API token.
        </p>
      ) : null}
      {data?.auditError ? (
        <p className="border-b border-danger bg-danger-bg px-4 py-2 text-xs text-danger" role="alert">
          Audit marks could not be loaded, so audit violations are not shown: {data.auditError}
        </p>
      ) : null}
      {data?.auditLogsExpired ? (
        <p className="border-b border-warning bg-warning-bg px-4 py-2 text-xs text-warning" role="status">
          The audit recorded {data.recordedRangeViolations} out-of-range minutes on this day, but per-minute
          details are kept only for the current month, so they can&apos;t be marked on individual rows.
        </p>
      ) : null}
      <p className="border-b border-border bg-bg-raised px-4 py-2 text-[11px] leading-4 text-text-muted">
        Each row is the {intervalLabel} average in Philippine time. A red count beside a value is the number of
        minutes the audit flagged as out of range in that slot, because an average can hide a single bad minute.
      </p>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-secondary" role="status">
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
            Loading {intervalLabel} readings...
          </div>
        ) : error ? (
          <p className="m-4 border-l-4 border-danger bg-danger-bg px-4 py-3 text-sm text-danger" role="alert">{error}</p>
        ) : rows.length ? (
          <table className="ops-table" style={{ minWidth: 520 + visibleMetrics.length * 112 }}>
            <thead>
              <tr>
                <th className="sticky top-0 z-10 w-[130px] bg-surface-table-header">Time (PHT)</th>
                <th className="sticky top-0 z-10 w-[100px] bg-surface-table-header">Status</th>
                {visibleMetrics.map((key) => {
                  const profile = getMetricAnalysisProfile(key);
                  return (
                    <th className="sticky top-0 z-10 w-[112px] bg-surface-table-header" key={key}>
                      {profile.label}
                      <span className="block font-normal normal-case tracking-normal text-text-muted">{profile.unit}</span>
                    </th>
                  );
                })}
                <th className="sticky top-0 z-10 bg-surface-table-header">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className={getStatusRowClass(row.status)} key={row.timestamp}>
                  <td className="font-mono">
                    {formatSlotTime(row.timestamp)}–{formatSlotTime(row.timestamp, intervalMinutes)}
                  </td>
                  <td><StatusChip status={row.status} /></td>
                  {visibleMetrics.map((key) => {
                    const flags = row.flags[key] ?? [];
                    const audit = row.auditViolations[key] ?? 0;
                    const tone = audit || flags.includes("out of range")
                      ? "font-semibold text-danger"
                      : flags.length ? "font-semibold text-warning" : "";
                    return (
                      <td className="font-mono" key={key}>
                        <span className={tone} title={flags.length ? flags.join(", ") : undefined}>
                          {formatReading(row.values[key])}
                        </span>
                        {audit ? (
                          <span
                            className="mini-chip mini-chip-danger ml-1.5 align-middle"
                            title={`Audit found ${audit} out-of-range minute${audit === 1 ? "" : "s"} in this slot`}
                          >
                            {audit}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                  <td className="text-sm text-muted-foreground">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-16 text-center text-sm text-text-muted">No readings recorded for this date.</p>
        )}
      </div>
    </dialog>
  );
}

function buildDisplayRow(row: ReadingRow, metrics: MetricKey[]): DisplayRow {
  const notes: string[] = [];
  let hasValue = false;
  let auditCount = 0;

  for (const metric of metrics) {
    if (row.values[metric] !== undefined) hasValue = true;
    const audit = row.auditViolations[metric] ?? 0;
    const details = [
      ...(row.flags[metric] ?? []),
      ...(audit ? [`audit found ${audit} out-of-range min`] : []),
    ];
    auditCount += audit;
    if (details.length) notes.push(`${getMetricAnalysisProfile(metric).label}: ${details.join(", ")}`);
  }

  return {
    ...row,
    status: notes.length ? "attention" : hasValue ? "ready" : "missing",
    auditCount,
    notes: notes.join("; ") || (hasValue ? "ok" : "no readings"),
  };
}

function buildTsv(target: StationReadingsTarget, rows: DisplayRow[], metrics: MetricKey[]) {
  const headers = [
    "time_pht",
    "station_id",
    "station_name",
    "status",
    ...metrics.map((key) => getMetricAnalysisProfile(key).label),
    "notes",
  ];
  const lines = rows.map((row) => [
    toPhtDateTime(row.timestamp),
    target.stationId,
    target.stationName,
    row.status,
    ...metrics.map((key) => formatReading(row.values[key])),
    row.notes,
  ]);

  return [headers, ...lines].map((line) => line.map(escapeTsv).join("\t")).join("\n");
}

function escapeTsv(value: string) {
  return value.replaceAll("\t", " ").replaceAll("\n", " ");
}

function formatReading(value?: number) {
  return value === undefined ? "—" : value.toFixed(2);
}

function toPhtDateTime(timestamp: string, offsetMinutes = 0) {
  return new Date(Date.parse(timestamp) + offsetMinutes * 60_000 + PHT_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

function formatSlotTime(timestamp: string, offsetMinutes = 0) {
  return toPhtDateTime(timestamp, offsetMinutes).slice(11);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00.000Z`));
}
