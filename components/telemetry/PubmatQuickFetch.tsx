"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clipboard, Loader2, Play, Square } from "lucide-react";
import { allMetricKeys, getMetricAnalysisProfile } from "@/lib/metric-profiles";
import type { InvestigationMetricKey, MetricKey } from "@/lib/telemetry-types";
import type {
  MetricOption,
  PubmatBucketWindow,
  PubmatQuickFetchResponse,
  PubmatQuickFetchResult,
  PubmatQuickFetchStatus,
  SourceKind,
} from "./types";
import { formatTime, philippineInputToUtcISOString, toInputValue } from "./utils";

const intervalOptions = [
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "12 hours", value: 720 },
  { label: "Daily", value: 1440 },
];

export function PubmatQuickFetch({
  autoRun = false,
  initialIntervalMinutes = 60,
  initialMetric = "temperature",
  metrics,
  onDataChange,
}: {
  autoRun?: boolean;
  initialIntervalMinutes?: number;
  initialMetric?: InvestigationMetricKey;
  metrics: MetricOption[];
  onDataChange?: (data: PubmatQuickFetchResponse | null) => void;
}) {
  const [metric, setMetric] = useState<InvestigationMetricKey>(initialMetric);
  const [timestamp, setTimestamp] = useState(() => {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    return toInputValue(date);
  });
  const [intervalMinutes, setIntervalMinutes] = useState(initialIntervalMinutes);
  const [requestGapMs, setRequestGapMs] = useState(600);
  const [results, setResults] = useState<PubmatQuickFetchResult[]>([]);
  const [responseWindow, setResponseWindow] = useState<PubmatBucketWindow | null>(null);
  const [source, setSource] = useState<SourceKind | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const abortControllerRef = useRef<AbortController | null>(null);
  const autoRunStartedRef = useRef(false);

  const selectedMetricKeys = useMemo(
    () => metric === "all" ? allMetricKeys : [metric],
    [metric],
  );
  const previewWindow = useMemo(
    () => buildBucketWindow(timestamp, intervalMinutes),
    [timestamp, intervalMinutes],
  );
  const window = responseWindow ?? previewWindow;
  const safeGapMs = Math.max(requestGapMs || 0, 350);
  const progressLabel = running
    ? "Fetching all stations"
    : results.length
      ? `${results.length} stations fetched`
      : "All stations queued";
  const rateLabel = `${(1000 / safeGapMs).toFixed(1)} req/sec`;

  const runQuickFetch = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResults([]);
    setResponseWindow(null);
    setSource(null);
    setCopyState("idle");
    onDataChange?.(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/pubmat-quick-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric,
          timestamp,
          intervalMinutes,
          requestGapMs: safeGapMs,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorPayload = await readErrorPayload(response);
        throw new Error(errorPayload ?? `Pubmat quick fetch failed (${response.status})`);
      }

      const payload = (await response.json()) as PubmatQuickFetchResponse;
      setResults(payload.results);
      setResponseWindow(payload.window);
      setSource(payload.source);
      onDataChange?.(payload);
    } catch (requestError) {
      if (controller.signal.aborted) {
        setError("Fetch stopped.");
      } else {
        setError(requestError instanceof Error ? requestError.message : "Unknown pubmat quick fetch error");
      }
    } finally {
      abortControllerRef.current = null;
      setRunning(false);
    }
  }, [intervalMinutes, metric, onDataChange, safeGapMs, timestamp]);

  useEffect(() => {
    if (!autoRun || autoRunStartedRef.current) return;

    autoRunStartedRef.current = true;
    void runQuickFetch();
  }, [autoRun, runQuickFetch]);

  function stopQuickFetch() {
    abortControllerRef.current?.abort();
    setRunning(false);
  }

  async function copyTsv() {
    const tsv = buildTsv(results, selectedMetricKeys);
    if (!tsv) return;

    try {
      await navigator.clipboard.writeText(tsv);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="grid gap-7">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-4xl">
          <h2 className="panel-title">Pubmat Quick Fetch</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            One backend job fetches the padded aggregate bucket for every station with server-side throttling.
          </p>
        </div>
          <div className="flex flex-wrap gap-2 xl:justify-end">
          <span className="status-chip">{progressLabel}</span>
          <span className="status-chip">{rateLabel}</span>
          {source ? <span className="status-chip">{source}</span> : null}
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_minmax(280px,1.1fr)_minmax(190px,0.7fr)_minmax(210px,0.7fr)]">
          <label className="field-label mt-0">
            Metric
            <select className="field" value={metric} onChange={(event) => setMetric(event.target.value as InvestigationMetricKey)}>
              {metrics.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="field-label mt-0">
            Pubmat timestamp end (PH)
            <input className="field" type="datetime-local" value={timestamp} onChange={(event) => setTimestamp(event.target.value)} />
          </label>
          <label className="field-label mt-0">
            Interval
            <select className="field" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}>
              {intervalOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="field-label mt-0">
            Server request gap (ms)
            <input
              className="field"
              min={350}
              step={50}
              type="number"
              value={requestGapMs}
              onChange={(event) => setRequestGapMs(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="grid gap-5 border-y border-border-subtle py-5 text-sm text-subtle-foreground lg:grid-cols-2">
          <div className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-label">Target bucket</span>
            <span className="leading-6 text-card-foreground">{formatTime(window.bucketStart)} to {formatTime(window.bucketEnd)}</span>
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-label">Fetched safely</span>
            <span className="leading-6 text-card-foreground">{formatTime(window.fetchStart)} to {formatTime(window.fetchEnd)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button className="primary-action inline-flex items-center justify-center gap-2" type="button" onClick={() => void runQuickFetch()} disabled={running}>
            {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {running ? "Fetching" : "Fetch all stations"}
          </button>
          <button className="nav-pill inline-flex items-center justify-center gap-2" type="button" onClick={stopQuickFetch} disabled={!running}>
            <Square size={16} />
            Stop
          </button>
          <button className="nav-pill inline-flex items-center justify-center gap-2" type="button" onClick={() => void copyTsv()} disabled={!results.length}>
            <Clipboard size={16} />
            {copyState === "copied" ? "Copied TSV" : copyState === "failed" ? "Copy failed" : "Copy TSV"}
          </button>
        </div>

        {error ? <div className="rounded-[6px] border border-danger-strong bg-surface p-3 text-sm text-danger-foreground-muted">{error}</div> : null}

        {results.length ? (
          <div className="overflow-auto border-t border-border-subtle pt-5">
            <table className="ops-table">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 bg-surface-table-header">Station</th>
                  <th className="sticky top-0 z-10 bg-surface-table-header">Class</th>
                  {selectedMetricKeys.map((key) => (
                    <th className="sticky top-0 z-10 bg-surface-table-header" key={key}>{getMetricAnalysisProfile(key).label}</th>
                  ))}
                  <th className="sticky top-0 z-10 bg-surface-table-header">Notes</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.station.id}>
                    <td>
                      <div className="grid gap-1">
                        <span className="font-semibold">{result.station.name}</span>
                        <span className="font-mono text-xs text-label">{result.station.id}</span>
                      </div>
                    </td>
                    <td><StatusChip status={result.status} /></td>
                    {selectedMetricKeys.map((key) => (
                      <td key={`${result.station.id}-${key}`} className="font-mono">
                        {formatValue(result.values[key])}
                      </td>
                    ))}
                    <td className="text-sm text-muted-foreground">
                      {result.error ?? (result.classifications.join(", ") || "ok")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StatusChip({ status }: { status: PubmatQuickFetchStatus }) {
  const label = status === "ready"
    ? "Ready"
    : status === "attention"
      ? "Review"
      : status === "missing"
        ? "Missing"
        : "Failed";
  const className = status === "ready"
    ? "mini-chip"
    : status === "attention"
      ? "mini-chip mini-chip-caution"
      : "mini-chip mini-chip-danger";

  return <span className={className}>{label}</span>;
}

function buildBucketWindow(timestampInput: string, intervalMinutes: number): PubmatBucketWindow {
  const bucketEndMs = Date.parse(philippineInputToUtcISOString(timestampInput));
  const intervalMs = intervalMinutes * 60_000;
  const bucketStartMs = bucketEndMs - intervalMs;

  return {
    bucketStart: new Date(bucketStartMs).toISOString(),
    bucketEnd: new Date(bucketEndMs).toISOString(),
    fetchStart: new Date(bucketStartMs - intervalMs).toISOString(),
    fetchEnd: new Date(bucketEndMs + intervalMs).toISOString(),
  };
}

function buildTsv(results: PubmatQuickFetchResult[], metricKeys: MetricKey[]) {
  if (!results.length) return "";

  const headers = [
    "station_id",
    "station_name",
    "province",
    "city",
    "classification",
    ...metricKeys.map((key) => getMetricAnalysisProfile(key).label),
    "notes",
  ];
  const rows = results.map((result) => [
    result.station.id,
    result.station.name,
    result.station.state,
    result.station.city,
    result.status,
    ...metricKeys.map((key) => formatValue(result.values[key])),
    result.error ?? result.classifications.join(", "),
  ]);

  return [headers, ...rows].map((row) => row.map(escapeTsv).join("\t")).join("\n");
}

function escapeTsv(value: string | number | undefined) {
  return String(value ?? "").replaceAll("\t", " ").replaceAll("\n", " ");
}

function formatValue(value?: number) {
  return value === undefined ? "-" : String(value.toFixed(2));
}

async function readErrorPayload(response: Response) {
  try {
    const payload = await response.json() as { error?: string; message?: string };
    return payload.message ?? payload.error ?? null;
  } catch {
    return null;
  }
}
