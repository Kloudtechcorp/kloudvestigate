import { useMemo, useSyncExternalStore } from "react";

// Runs the Add Previous Data backfill outside any component, so moving to another tab in the app
// does not stop it. Only reloading or closing the browser tab does; Resume continues from there.

const STORAGE_KEY = "kloudvestigate.previous-data";
const DAY_PAUSE_MS = 5_000;
const MAX_DAY_ATTEMPTS = 3;
const DAY_MS = 86_400_000;
const PHT_OFFSET_MS = 8 * 60 * 60_000;
const LOG_LIMIT = 60;
const DEFAULT_LIMIT_WAIT_MS = 60_000;
// A little past KloudTrack's reset, so the first request after waiting is not rejected again.
const LIMIT_WAIT_MARGIN_MS = 5_000;

export type Totals = { saved: number; noData: number; kept: number; notCreated: number; failed: number };
export type RunState = "idle" | "running" | "waiting" | "stopped" | "error" | "done";
export type SavedProgress = { from: string; to: string; nextDate: string };
export type LogEntry = { date: string; text: string; tone: "ok" | "warn" | "error"; failures: string[] };
export type RunProgress = { title: string; step: string; detail: string; value: number; max: number };
export type RunSnapshot = {
  runState: RunState;
  message: string | null;
  progress: RunProgress | null;
  waitUntil: number | null;
  totals: Totals;
  log: LogEntry[];
  range: { from: string; to: string } | null;
};

type DayResult = Totals & { failures: string[]; rateLimited: boolean; retryAfterMs: number | null; finished: boolean };
type DayProgress = { station: string; completed: number; stationCount: number };

const EMPTY_TOTALS: Totals = { saved: 0, noData: 0, kept: 0, notCreated: 0, failed: 0 };
const INITIAL_SNAPSHOT: RunSnapshot = {
  runState: "idle",
  message: null,
  progress: null,
  waitUntil: null,
  totals: EMPTY_TOTALS,
  log: [],
  range: null,
};

class RebuildError extends Error {
  constructor(message: string, readonly rateLimited: boolean, readonly retryAfterMs: number | null) {
    super(message);
  }
}

let snapshot = INITIAL_SNAPSHOT;
let controller: AbortController | null = null;
const runListeners = new Set<() => void>();
const progressListeners = new Set<() => void>();

export function usePreviousDataRun() {
  return useSyncExternalStore(subscribeToRun, () => snapshot, () => INITIAL_SNAPSHOT);
}

export function useSavedPreviousDataProgress() {
  const json = useSyncExternalStore(subscribeToProgress, readProgressSnapshot, () => null);
  return useMemo(() => parseSavedProgress(json), [json]);
}

export function startPreviousDataRun(range: { from: string; to: string }, startDate: string) {
  if (controller) return;
  void run(range, startDate);
}

export function stopPreviousDataRun() {
  controller?.abort();
}

async function run(range: { from: string; to: string }, startDate: string) {
  const dates = listDates(startDate, range.to);
  if (!dates.length) return;

  const runController = new AbortController();
  controller = runController;
  const { signal } = runController;
  window.addEventListener("beforeunload", warnBeforeLeaving);
  update({ ...INITIAL_SNAPSHOT, runState: "running", range });

  try {
    await checkFirstReadings(startDate, signal);
    for (const [index, date] of dates.entries()) {
      rememberProgress({ ...range, nextDate: date });
      const outcome = await runDay(date, index + 1, dates.length, signal);
      if (outcome === "stopped") break;
      if (outcome === "error") return;
      if (index < dates.length - 1) await wait(DAY_PAUSE_MS, signal);
    }
  } catch (error) {
    if (!signal.aborted) {
      update({
        runState: "error",
        progress: null,
        waitUntil: null,
        message: `${error instanceof Error ? error.message : "The run stopped unexpectedly."} Click Resume to try again.`,
      });
      return;
    }
  } finally {
    controller = null;
    window.removeEventListener("beforeunload", warnBeforeLeaving);
  }

  if (signal.aborted) {
    const nextDate = parseSavedProgress(readProgressSnapshot())?.nextDate;
    update({
      runState: "stopped",
      progress: null,
      waitUntil: null,
      message: nextDate ? `Stopped at ${formatDate(nextDate)}. Click Resume to continue from there.` : "Stopped.",
    });
    return;
  }

  rememberProgress(null);
  update({
    runState: "done",
    progress: null,
    message: `Finished. Every day from ${formatDate(range.from)} to ${formatDate(range.to)} has been checked.`,
  });
}

// Each first-reading lookup is a long KloudTrack query, so they run one per request here instead of
// piling up inside a day's rebuild. The results are cached on the server for the day rebuilds.
async function checkFirstReadings(startDate: string, signal: AbortSignal) {
  const response = await fetch("/api/stations", { cache: "no-store", signal });
  if (!response.ok) return;
  const payload = await response.json() as {
    source?: string;
    stations: Array<{ id: string; name: string; activatedAt?: string | null }>;
  };
  if (payload.source === "demo") return;

  const stations = payload.stations.filter((station) => {
    const activatedAt = station.activatedAt ? Date.parse(station.activatedAt) : Number.NaN;
    return Number.isNaN(activatedAt) || toPhilippineDateKey(activatedAt) >= startDate;
  });
  for (const [index, station] of stations.entries()) {
    update({
      progress: {
        title: "Checking when each station first reported",
        step: `station ${index + 1} of ${stations.length}`,
        detail: station.name,
        value: index,
        max: stations.length,
      },
    });
    while (true) {
      const lookup = await fetch(`/api/audit-reports/first-reading?stationId=${encodeURIComponent(station.id)}`, {
        cache: "no-store",
        signal,
      });
      if (lookup.status !== 429) break;
      const failure = await lookup.json().catch(() => null) as { retryAfterMs?: number } | null;
      await waitForLimit(failure?.retryAfterMs ?? null, signal);
      signal.throwIfAborted();
    }
  }
}

async function runDay(date: string, dayNumber: number, dayCount: number, signal: AbortSignal) {
  const showProgress = (progress: DayProgress) => update({
    progress: {
      title: `Adding ${formatDate(date)}`,
      step: `day ${dayNumber} of ${dayCount}`,
      detail: progress.stationCount
        ? `Station ${progress.completed} of ${progress.stationCount}: ${progress.station}`
        : progress.station,
      value: dayNumber - 1,
      max: dayCount,
    },
  });
  showProgress({ station: "Loading stations", completed: 0, stationCount: 0 });

  // Stations saved before a pause show up as "already saved" in the retry, so count them here.
  let savedEarlier = 0;
  let noDataEarlier = 0;
  let attempts = 0;
  while (true) {
    let result: DayResult | null = null;
    let failure: unknown = null;
    try {
      result = await rebuildDay(date, signal, showProgress);
    } catch (error) {
      failure = error;
    }
    if (signal.aborted) return "stopped";

    const rateLimit = result?.rateLimited
      ? { retryAfterMs: result.retryAfterMs }
      : failure instanceof RebuildError && failure.rateLimited ? { retryAfterMs: failure.retryAfterMs } : null;
    if ((result && !result.finished) || rateLimit) {
      savedEarlier += result?.saved ?? 0;
      noDataEarlier += result?.noData ?? 0;
    }
    if (rateLimit) {
      await waitForLimit(rateLimit.retryAfterMs, signal);
      if (signal.aborted) return "stopped";
      continue;
    }

    if (result?.finished) {
      const day: Totals = {
        saved: savedEarlier + result.saved,
        noData: noDataEarlier + result.noData,
        kept: Math.max(0, result.kept - savedEarlier),
        notCreated: result.notCreated,
        failed: result.failed,
      };
      const entry: LogEntry = { date, text: describeDay(day), tone: day.failed ? "warn" : "ok", failures: result.failures };
      update({ totals: addTotals(snapshot.totals, day), log: [entry, ...snapshot.log].slice(0, LOG_LIMIT) });
      return "done";
    }

    // Vercel can end a long request early; the retry keeps stations that were already saved.
    attempts += 1;
    if (attempts >= MAX_DAY_ATTEMPTS) {
      const reason = failure instanceof Error ? failure.message : "The request ended before the day finished.";
      update({
        runState: "error",
        progress: null,
        log: [{ date, text: reason, tone: "error" as const, failures: [] }, ...snapshot.log].slice(0, LOG_LIMIT),
        message: `Could not finish ${formatDate(date)} after ${MAX_DAY_ATTEMPTS} tries: ${reason} Click Resume to try again.`,
      });
      return "error";
    }
    await wait(DAY_PAUSE_MS, signal);
  }
}

async function waitForLimit(retryAfterMs: number | null, signal: AbortSignal) {
  const waitMs = Math.max(retryAfterMs ?? DEFAULT_LIMIT_WAIT_MS, 0) + LIMIT_WAIT_MARGIN_MS;
  update({
    runState: "waiting",
    waitUntil: Date.now() + waitMs,
    message: "KloudTrack's request limit was reached, so adding is paused and will continue by itself. Days already added are saved.",
  });
  await wait(waitMs, signal);
  if (!signal.aborted) update({ runState: "running", waitUntil: null, message: null });
}

async function rebuildDay(date: string, signal: AbortSignal, onProgress: (progress: DayProgress) => void): Promise<DayResult> {
  const response = await fetch("/api/audit-reports/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ date, replaceExisting: false }),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as { message?: string; code?: string; retryAfterMs?: number } | null;
    throw new RebuildError(
      payload?.message ?? `Rebuild request failed (${response.status}).`,
      response.status === 429 || payload?.code === "rate_limited",
      payload?.retryAfterMs ?? null,
    );
  }

  const result: DayResult = { ...EMPTY_TOTALS, failures: [], rateLimited: false, retryAfterMs: null, finished: false };
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
      result.retryAfterMs = typeof event.retryAfterMs === "number" ? event.retryAfterMs : null;
      for (const report of event.reports as Array<{ stationId: string; status: string; message?: string }>) {
        if (report.status === "failed") {
          result.failures.push(`${stationNames.get(report.stationId) ?? report.stationId}: ${report.message ?? "Unknown error"}`);
        }
      }
      // The station stopped by the limit is retried after the wait, so it is not a failure.
      if (result.rateLimited) {
        result.failed = Math.max(0, result.failed - 1);
        result.failures.pop();
      }
    } else if (event.event === "error") {
      throw new RebuildError(
        String(event.message ?? "Rebuild failed."),
        event.rateLimited === true,
        typeof event.retryAfterMs === "number" ? event.retryAfterMs : null,
      );
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

function update(patch: Partial<RunSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  runListeners.forEach((listener) => listener());
}

function subscribeToRun(listener: () => void) {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}

function warnBeforeLeaving(event: BeforeUnloadEvent) {
  event.preventDefault();
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

function describeDay(day: Totals) {
  return [
    `${day.saved} saved${day.noData ? ` (${day.noData} with no data)` : ""}`,
    day.kept ? `${day.kept} already saved` : "",
    day.notCreated ? `${day.notCreated} not created yet` : "",
    day.failed ? `${day.failed} failed` : "",
  ].filter(Boolean).join(", ");
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

export function listDates(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return [];

  const dates: string[] = [];
  for (let time = start; time <= end; time += DAY_MS) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}

function toPhilippineDateKey(time: number) {
  return new Date(time + PHT_OFFSET_MS).toISOString().slice(0, 10);
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

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00.000Z`));
}
