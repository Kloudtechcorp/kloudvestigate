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

const startedAutoRunKeys = new Set<string>();

type PubmatStreamInitEvent = {
  event: "init";
  selection: PubmatQuickFetchResponse["selection"];
  window: PubmatBucketWindow;
  source: SourceKind;
  stationCount: number;
};

type PubmatStreamResultEvent = {
  event: "result";
  result: PubmatQuickFetchResult;
  completedCount: number;
  stationCount: number;
};

type PubmatStreamDoneEvent = {
  event: "done";
  stationCount: number;
  results: PubmatQuickFetchResult[];
};

type PubmatStreamErrorEvent = {
  event: "error";
  message: string;
};

type PubmatStreamEvent =
  | PubmatStreamInitEvent
  | PubmatStreamResultEvent
  | PubmatStreamDoneEvent
  | PubmatStreamErrorEvent;

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
  const [stationCount, setStationCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
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
  const rateLabel = `${(1000 / safeGapMs).toFixed(1)} req/sec`;
  const progressPercent = stationCount ? Math.round((completedCount / stationCount) * 100) : 0;
  const autoRunKey = `${initialMetric}:${initialIntervalMinutes}:${autoRun ? "run" : "idle"}`;

  const runQuickFetch = useCallback(async () => {
    if (abortControllerRef.current) return;

    setRunning(true);
    setError(null);
    setResults([]);
    setStationCount(0);
    setCompletedCount(0);
    setResponseWindow(null);
    setSource(null);
    setCopyState("idle");
    onDataChange?.(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/pubmat-quick-fetch", {
        method: "POST",
        headers: {
          "Accept": "application/x-ndjson",
          "Content-Type": "application/json",
        },
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

      if (response.headers.get("content-type")?.includes("application/x-ndjson") && response.body) {
        const streamedResults: PubmatQuickFetchResult[] = [];
        let streamedPayload: Omit<PubmatQuickFetchResponse, "results"> | null = null;

        await readPubmatStream(response, {
          onInit(event) {
            streamedPayload = {
              selection: event.selection,
              window: event.window,
              source: event.source,
              stationCount: event.stationCount,
            };
            setResponseWindow(event.window);
            setSource(event.source);
            setStationCount(event.stationCount);
            setCompletedCount(0);
          },
          onResult(event) {
            upsertStationResult(streamedResults, event.result);
            setResults([...streamedResults]);
            setCompletedCount(streamedResults.length);
            setStationCount(event.stationCount);
          },
          onDone(event) {
            const dedupedResults = dedupeStationResults(event.results);
            setCompletedCount(dedupedResults.length);
            setStationCount(event.stationCount);
            if (streamedPayload) {
              onDataChange?.({
                ...streamedPayload,
                stationCount: event.stationCount,
                results: dedupedResults,
              });
            }
          },
        });
        return;
      }

      const payload = (await response.json()) as PubmatQuickFetchResponse;
      const dedupedResults = dedupeStationResults(payload.results);
      setResults(dedupedResults);
      setStationCount(payload.stationCount);
      setCompletedCount(dedupedResults.length);
      setResponseWindow(payload.window);
      setSource(payload.source);
      onDataChange?.({ ...payload, results: dedupedResults });
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
    if (startedAutoRunKeys.has(autoRunKey)) return;

    startedAutoRunKeys.add(autoRunKey);
    autoRunStartedRef.current = true;
    const timeoutId = globalThis.setTimeout(() => {
      void runQuickFetch();
    }, 0);

    return () => globalThis.clearTimeout(timeoutId);
  }, [autoRun, autoRunKey, runQuickFetch]);

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
    <section className="grid gap-4">
      {autoRun ? (
        <div className="border border-border bg-bg-raised px-3 py-2 text-xs text-text-muted">
          Auto-running from URL params...
        </div>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Daily Readings</h2>
        <div className="flex flex-wrap gap-2">
          <button className="primary-action inline-flex items-center justify-center gap-2" type="button" onClick={() => void runQuickFetch()} disabled={running}>
            {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {running ? "Fetching" : "Fetch all stations"}
          </button>
          {running ? (
            <button className="primary-action inline-flex items-center justify-center gap-2 bg-danger text-white" type="button" onClick={stopQuickFetch}>
              <Square size={16} />
              Stop
            </button>
          ) : null}
          {results.length ? (
            <button className="nav-pill inline-flex items-center justify-center gap-2 ring-2 ring-accent" type="button" onClick={() => void copyTsv()}>
              <Clipboard size={16} />
              {copyState === "copied" ? "Copied TSV" : copyState === "failed" ? "Copy failed" : "Copy TSV"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-4 border-b border-border pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(240px,1.2fr)_minmax(150px,0.7fr)_minmax(180px,0.7fr)]">
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

        <div className="min-w-[280px] rounded-[4px] border border-border bg-bg-raised px-3 py-2">
          <div className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Target</span>
            <span className="font-mono text-xs text-text-secondary">{formatTime(window.bucketStart)} to {formatTime(window.bucketEnd)} PHT</span>
          </div>
          <div className="mt-2 grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Fetched</span>
            <span className="font-mono text-xs text-text-secondary">{formatTime(window.fetchStart)} to {formatTime(window.fetchEnd)} PHT</span>
          </div>
        </div>
      </div>

      {(running || results.length) ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-border">
            <div className="h-full bg-accent" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-text-muted">
            <span>{completedCount} / {stationCount || "?"} stations</span>
            <span>{rateLabel}</span>
            <span>{source ?? "queued"}</span>
          </div>
        </div>
      ) : null}

      {error ? <div className="border-l-4 border-danger bg-danger-bg px-4 py-3 text-sm text-danger">{error}</div> : null}

      {results.length ? (
        <div className="overflow-auto rounded-[6px] border border-border bg-bg-surface">
            <table className="ops-table min-w-[760px]">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 w-[160px] bg-surface-table-header">Station</th>
                  <th className="sticky top-0 z-10 w-[80px] bg-surface-table-header">ID</th>
                  <th className="sticky top-0 z-10 bg-surface-table-header">Class</th>
                  <th className="sticky top-0 z-10 bg-surface-table-header">Status</th>
                  {selectedMetricKeys.map((key) => (
                    <th className="sticky top-0 z-10 bg-surface-table-header" key={key}>{getMetricAnalysisProfile(key).label}</th>
                  ))}
                  <th className="sticky top-0 z-10 bg-surface-table-header">Notes</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr className={getStatusRowClass(result.status)} key={result.station.id}>
                    <td>
                      <div className="grid gap-1">
                        <span className="font-semibold">{result.station.name}</span>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-text-muted">{result.station.id}</td>
                    <td><span className="status-chip">{result.station.type || "station"}</span></td>
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
        ) : (
        <div className="py-16 text-center text-sm text-text-muted">
          Configure the fetch above and click Fetch all stations.
        </div>
      )}
    </section>
  );
}

function upsertStationResult(results: PubmatQuickFetchResult[], result: PubmatQuickFetchResult) {
  const existingIndex = results.findIndex((item) => item.station.id === result.station.id);
  if (existingIndex >= 0) {
    results[existingIndex] = result;
    return;
  }

  results.push(result);
}

function dedupeStationResults(results: PubmatQuickFetchResult[]) {
  const resultsByStationId = new Map<string, PubmatQuickFetchResult>();
  for (const result of results) {
    resultsByStationId.set(result.station.id, result);
  }

  return [...resultsByStationId.values()];
}

async function readPubmatStream(
  response: Response,
  handlers: {
    onInit: (event: PubmatStreamInitEvent) => void;
    onResult: (event: PubmatStreamResultEvent) => void;
    onDone: (event: PubmatStreamDoneEvent) => void;
  },
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Pubmat quick fetch did not return a readable stream.");

  const decoder = new TextDecoder();
  let buffer = "";

  function processLine(line: string) {
    if (!line.trim()) return;

    const event = JSON.parse(line) as PubmatStreamEvent;
    if (event.event === "init") {
      handlers.onInit(event);
      return;
    }
    if (event.event === "result") {
      handlers.onResult(event);
      return;
    }
    if (event.event === "done") {
      handlers.onDone(event);
      return;
    }

    throw new Error(event.message);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  }

  buffer += decoder.decode();
  processLine(buffer);
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
    ? "mini-chip bg-success-bg text-success"
    : status === "attention"
      ? "mini-chip mini-chip-caution"
      : status === "missing"
        ? "mini-chip bg-missing-bg text-missing"
        : "mini-chip mini-chip-danger";

  return <span className={className}>{label}</span>;
}

function getStatusRowClass(status: PubmatQuickFetchStatus) {
  if (status === "ready") return "bg-success-bg";
  if (status === "attention") return "bg-warning-bg";
  if (status === "missing") return "bg-missing-bg";
  return "bg-danger-bg";
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
  return value === undefined ? "—" : String(value.toFixed(2));
}

async function readErrorPayload(response: Response) {
  try {
    const payload = await response.json() as { error?: string; message?: string };
    return payload.message ?? payload.error ?? null;
  } catch {
    return null;
  }
}
