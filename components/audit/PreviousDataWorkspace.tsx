"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CheckCircle2, History, LoaderCircle, Play, RotateCcw, Square, TriangleAlert } from "lucide-react";

const STORAGE_KEY = "kloudvestigate.previous-data";
const DAY_PAUSE_MS = 5_000;
const MAX_DAY_ATTEMPTS = 3;
const DAY_MS = 86_400_000;
const LOG_LIMIT = 60;

type Totals = { saved: number; noData: number; kept: number; notCreated: number; failed: number };
type DayResult = Totals & { failures: string[]; rateLimited: boolean; finished: boolean };
type DayProgress = { station: string; completed: number; stationCount: number };
type SavedProgress = { from: string; to: string; nextDate: string };
type RunState = "idle" | "running" | "stopped" | "rate_limited" | "error" | "done";
type LogEntry = { date: string; text: string; tone: "ok" | "warn" | "error"; failures: string[] };

const EMPTY_TOTALS: Totals = { saved: 0, noData: 0, kept: 0, notCreated: 0, failed: 0 };
const progressListeners = new Set<() => void>();

class RebuildError extends Error {
  constructor(message: string, readonly rateLimited: boolean) {
    super(message);
  }
}

export function PreviousDataWorkspace({ earliestDate, latestDate }: { earliestDate: string; latestDate: string }) {
  const [from, setFrom] = useState(earliestDate);
  const [to, setTo] = useState(latestDate);
  const [runState, setRunState] = useState<RunState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const savedProgressJson = useSyncExternalStore(subscribeToProgress, readProgressSnapshot, () => null);
  const savedProgress = useMemo(() => parseSavedProgress(savedProgressJson), [savedProgressJson]);
  const [current, setCurrent] = useState<(DayProgress & { date: string; dayNumber: number; dayCount: number }) | null>(null);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [log, setLog] = useState<LogEntry[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const running = runState === "running";
  const rangeDays = listDates(from, to).length;
  const canResume = savedProgress && savedProgress.nextDate <= savedProgress.to;

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!running) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [running]);

  function addLog(entry: LogEntry) {
    setLog((entries) => [entry, ...entries].slice(0, LOG_LIMIT));
  }

  async function run(range: { from: string; to: string }, startDate: string) {
    const dates = listDates(startDate, range.to);
    if (!dates.length) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setRunState("running");
    setMessage(null);
    setTotals(EMPTY_TOTALS);
    setLog([]);

    for (const [index, date] of dates.entries()) {
      rememberProgress({ ...range, nextDate: date });
      const showProgress = (progress: DayProgress) =>
        setCurrent({ ...progress, date, dayNumber: index + 1, dayCount: dates.length });
      showProgress({ station: "Loading stations", completed: 0, stationCount: 0 });

      let result: DayResult | null = null;
      let lastError: unknown = null;
      // Vercel can end a long request early; the retry keeps stations that were already saved.
      for (let attempt = 1; attempt <= MAX_DAY_ATTEMPTS && !result?.finished; attempt += 1) {
        try {
          result = await rebuildDay(date, controller.signal, showProgress);
          lastError = null;
        } catch (error) {
          if (controller.signal.aborted) break;
          lastError = error;
          if (error instanceof RebuildError && error.rateLimited) break;
        }
        if (!result?.finished && attempt < MAX_DAY_ATTEMPTS && !controller.signal.aborted) {
          await wait(DAY_PAUSE_MS, controller.signal);
        }
      }

      if (controller.signal.aborted) {
        setRunState("stopped");
        setMessage(`Stopped at ${formatDate(date)}. Click Resume to continue from there.`);
        return;
      }

      if (result) {
        const dayResult = result;
        setTotals((previous) => addTotals(previous, dayResult));
        addLog({
          date,
          text: describeDay(dayResult),
          tone: dayResult.failed || !dayResult.finished ? "warn" : "ok",
          failures: dayResult.failures,
        });
      }

      const rateLimited = result?.rateLimited || (lastError instanceof RebuildError && lastError.rateLimited);
      if (rateLimited) {
        setRunState("rate_limited");
        setMessage(
          `KloudTrack is rate-limiting requests, so adding stopped at ${formatDate(date)}. `
          + "Wait about 15 minutes, then click Resume. Days already added are saved.",
        );
        return;
      }
      if (!result?.finished) {
        const reason = lastError instanceof Error ? lastError.message : "The request ended before the day finished.";
        addLog({ date, text: reason, tone: "error", failures: [] });
        setRunState("error");
        setMessage(`Could not finish ${formatDate(date)} after ${MAX_DAY_ATTEMPTS} tries: ${reason} Click Resume to try again.`);
        return;
      }

      if (index < dates.length - 1) await wait(DAY_PAUSE_MS, controller.signal);
    }

    if (controller.signal.aborted) return;
    rememberProgress(null);
    setCurrent(null);
    setRunState("done");
    setMessage(`Finished. Every day from ${formatDate(range.from)} to ${formatDate(range.to)} has been checked.`);
  }

  function stop() {
    controllerRef.current?.abort();
  }

  return (
    <div className="grid gap-4">
      <section className="panel grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="panel-title flex items-center gap-2">
              <History aria-hidden="true" className="h-4 w-4 text-accent" />
              Days to add
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-text-secondary">
              Rebuilds the audit for each day from KloudTrack readings, oldest day first. Reports that already exist
              are kept. Keep this tab open while it runs; if you leave, click Resume to continue.
            </p>
          </div>
          <span className="count-chip">{rangeDays} days</span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="field-label mt-0">
            From
            <input
              className="field"
              disabled={running}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              type="date"
              value={from}
            />
          </label>
          <label className="field-label mt-0">
            To
            <input
              className="field"
              disabled={running}
              max={latestDate}
              min={from}
              onChange={(event) => setTo(event.target.value)}
              type="date"
              value={to}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {running ? (
              <button className="primary-action inline-flex items-center gap-2 bg-danger text-white" onClick={stop} type="button">
                <Square aria-hidden="true" className="h-4 w-4" />
                Stop
              </button>
            ) : canResume ? (
              <>
                <button
                  className="primary-action inline-flex items-center gap-2"
                  onClick={() => {
                    setFrom(savedProgress.from);
                    setTo(savedProgress.to);
                    void run(savedProgress, savedProgress.nextDate);
                  }}
                  type="button"
                >
                  <Play aria-hidden="true" className="h-4 w-4" />
                  Resume from {formatDate(savedProgress.nextDate)}
                </button>
                <button
                  className="nav-pill inline-flex items-center gap-2 disabled:opacity-40"
                  disabled={!rangeDays}
                  onClick={() => void run({ from, to }, from)}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" className="h-4 w-4" />
                  Start over from {formatDate(from)}
                </button>
              </>
            ) : (
              <button
                className="primary-action inline-flex items-center gap-2"
                disabled={!rangeDays}
                onClick={() => void run({ from, to }, from)}
                type="button"
              >
                <Play aria-hidden="true" className="h-4 w-4" />
                Start adding previous data
              </button>
            )}
          </div>
        </div>

        <ul className="grid gap-1 border-t border-border pt-3 text-xs leading-5 text-text-secondary">
          <li>A station that sent no readings on a day it already existed is saved as an error with 1,440 missing minutes.</li>
          <li>Days before a station existed are skipped. KloudTrack readings start in October 2025.</li>
          <li>Days before this month keep the daily summary only; per-minute details are kept for the current month.</li>
        </ul>
      </section>

      {running && current ? (
        <section className="panel grid gap-2" aria-live="polite" role="status">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="inline-flex items-center gap-2 font-semibold text-text-primary">
              <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
              Adding {formatDate(current.date)}
            </span>
            <span className="font-mono text-xs text-text-secondary">day {current.dayNumber} of {current.dayCount}</span>
          </div>
          <progress
            aria-label="Days processed"
            className="h-1.5 w-full accent-accent"
            max={current.dayCount}
            value={current.dayNumber - 1}
          />
          <p className="truncate text-xs text-text-secondary">
            {current.stationCount
              ? `Station ${current.completed} of ${current.stationCount}: ${current.station}`
              : current.station}
          </p>
        </section>
      ) : null}

      {message ? (
        <p
          className={`flex items-start gap-2 rounded border px-4 py-3 text-sm ${
            runState === "done"
              ? "border-success bg-success-bg text-success"
              : runState === "error"
                ? "border-danger bg-danger-bg text-danger"
                : "border-warning bg-warning-bg text-warning"
          }`}
          role={runState === "error" || runState === "rate_limited" ? "alert" : "status"}
        >
          {runState === "done"
            ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            : <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
          {message}
        </p>
      ) : null}

      {log.length ? (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-5">
            <TotalStat label="Saved" value={totals.saved} />
            <TotalStat label="No data (error)" value={totals.noData} emphasis={totals.noData > 0} />
            <TotalStat label="Already saved" value={totals.kept} />
            <TotalStat label="Not created yet" value={totals.notCreated} />
            <TotalStat label="Failed" value={totals.failed} emphasis={totals.failed > 0} />
          </div>

          <section className="panel p-0">
            <h2 className="panel-title border-b border-border px-4 py-3">Days processed this run</h2>
            <ul className="max-h-[420px] overflow-auto">
              {log.map((entry, index) => (
                <li className="border-b border-border px-4 py-2 text-sm" key={`${entry.date}-${index}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="w-36 shrink-0 font-mono text-xs text-text-secondary">{entry.date}</span>
                    <span className={entry.tone === "error" ? "text-danger" : entry.tone === "warn" ? "text-warning" : "text-text-primary"}>
                      {entry.text}
                    </span>
                  </div>
                  {entry.failures.length ? (
                    <ul className="mt-1 pl-39 text-xs text-danger">
                      {entry.failures.map((failure) => <li key={failure}>{failure}</li>)}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

function TotalStat({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="bg-bg-surface px-4 py-3">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className={`mt-1 block font-mono text-xl font-semibold ${emphasis ? "text-danger" : "text-text-primary"}`}>
        {value.toLocaleString("en-US")}
      </span>
    </div>
  );
}

async function rebuildDay(date: string, signal: AbortSignal, onProgress: (progress: DayProgress) => void): Promise<DayResult> {
  const response = await fetch("/api/audit-reports/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ date, replaceExisting: false }),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as { message?: string; code?: string } | null;
    throw new RebuildError(
      payload?.message ?? `Rebuild request failed (${response.status}).`,
      response.status === 429 || payload?.code === "rate_limited",
    );
  }

  const result: DayResult = { ...EMPTY_TOTALS, failures: [], rateLimited: false, finished: false };
  const stationNames = new Map<string, string>();
  let stationCount = 0;

  function handleLine(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as Record<string, unknown>;
    if (typeof event.stationCount === "number") stationCount = event.stationCount;
    const completed = typeof event.completedCount === "number" ? event.completedCount : 0;
    const stationName = typeof event.stationName === "string" ? event.stationName : "";

    if (event.event === "station_start") {
      onProgress({ station: stationName, completed, stationCount });
    } else if (event.event === "result") {
      stationNames.set(String(event.stationId), stationName);
      if (event.status === "stored") result.kept += 1;
      else if (event.status === "not_created") result.notCreated += 1;
      else if (event.status === "failed") result.failed += 1;
      else result.saved += 1;
      if (event.status === "no_data") result.noData += 1;
      onProgress({ station: stationName, completed, stationCount });
    } else if (event.event === "done") {
      result.finished = true;
      result.rateLimited = event.rateLimited === true;
      for (const report of event.reports as Array<{ stationId: string; status: string; message?: string }>) {
        if (report.status === "failed") {
          result.failures.push(`${stationNames.get(report.stationId) ?? report.stationId}: ${report.message ?? "Unknown error"}`);
        }
      }
    } else if (event.event === "error") {
      throw new RebuildError(String(event.message ?? "Rebuild failed."), event.rateLimited === true);
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (signal.aborted) throw error;
      // The connection dropped mid-day; the caller retries and keeps what was saved.
      return result;
    }
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
    if (chunk.done) break;
  }
  handleLine(buffer);
  return result;
}

function describeDay(result: DayResult) {
  const parts = [
    `${result.saved} saved${result.noData ? ` (${result.noData} with no data)` : ""}`,
    result.kept ? `${result.kept} already saved` : "",
    result.notCreated ? `${result.notCreated} not created yet` : "",
    result.failed ? `${result.failed} failed` : "",
    result.rateLimited ? "stopped by rate limit" : "",
  ].filter(Boolean);
  return parts.join(", ");
}

function addTotals(previous: Totals, day: Totals): Totals {
  return {
    saved: previous.saved + day.saved,
    noData: previous.noData + day.noData,
    kept: previous.kept + day.kept,
    notCreated: previous.notCreated + day.notCreated,
    failed: previous.failed + day.failed,
  };
}

function listDates(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return [];

  const dates: string[] = [];
  for (let time = start; time <= end; time += DAY_MS) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}

function rememberProgress(progress: SavedProgress | null) {
  try {
    if (progress) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the run still works; Resume just won't survive a reload.
  }
  progressListeners.forEach((listener) => listener());
}

function subscribeToProgress(listener: () => void) {
  progressListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    progressListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readProgressSnapshot() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseSavedProgress(json: string | null): SavedProgress | null {
  try {
    const value = JSON.parse(json ?? "null") as SavedProgress | null;
    return value && typeof value.nextDate === "string" && typeof value.from === "string" && typeof value.to === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00.000Z`));
}
