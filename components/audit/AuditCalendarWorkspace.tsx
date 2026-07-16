"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, RefreshCw } from "lucide-react";

type CalendarSummary = {
  date: string;
  missingCount: number;
  rangeViolationCount: number;
};

type StationOption = { id: string; name: string };

type AuditLog = {
  id: string;
  type: "rangeViolation" | "missing";
  eventDate: string;
  rowContents: unknown;
};

type DailySummary = {
  stationId: string;
  stationName: string;
  missingCount: number;
  rangeViolationCount: number;
  rangeViolationSummary: unknown;
  auditLogs: AuditLog[];
};

type MonthlyResponse = {
  month: string;
  summaries: CalendarSummary[];
  stations: StationOption[];
};

type DailyResponse = { date: string; summaries: DailySummary[] };

type RebuildProgress = {
  completed: number;
  total: number;
  stationName: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function AuditCalendarWorkspace() {
  const hydrated = useHydrated();
  const [month, setMonth] = useState(getCurrentPhtMonth);
  const [stationId, setStationId] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<CalendarSummary[]>([]);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState<RebuildProgress | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ month });
    if (stationId) params.set("stationId", stationId);

    fetch(`/api/audit-reports?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Summary request failed (${response.status})`);
        return response.json() as Promise<MonthlyResponse>;
      })
      .then((payload) => {
        setSummaries(payload.summaries);
        setStations(payload.stations);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : "Unable to load audit summaries.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSummaryLoading(false);
      });

    return () => controller.abort();
  }, [month, stationId, refreshKey]);

  useEffect(() => {
    if (!selectedDate) return;

    const controller = new AbortController();
    const params = new URLSearchParams({ date: selectedDate });
    if (stationId) params.set("stationId", stationId);

    fetch(`/api/audit-reports?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Audit request failed (${response.status})`);
        return response.json() as Promise<DailyResponse>;
      })
      .then((payload) => setDailySummaries(payload.summaries))
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : "Unable to load daily audits.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });

    return () => controller.abort();
  }, [selectedDate, stationId, refreshKey]);

  const summariesByDate = useMemo(
    () => new Map(summaries.map((summary) => [summary.date, summary])),
    [summaries],
  );
  const calendarDays = useMemo(() => buildCalendarDays(month), [month]);
  const rangeRows = dailySummaries.flatMap((summary) =>
    summary.auditLogs
      .filter((log) => log.type === "rangeViolation")
      .map((log) => ({ ...log, stationId: summary.stationId, stationName: summary.stationName })),
  );
  const missingRows = dailySummaries.filter((summary) => summary.missingCount > 0);

  function changeMonth(offset: number) {
    setSummaryLoading(true);
    setError(null);
    setDailySummaries([]);
    setMonth((current) => offsetMonth(current, offset));
    setSelectedDate(null);
  }

  function changeStation(nextStationId: string) {
    setSummaryLoading(true);
    setDetailLoading(Boolean(selectedDate));
    setError(null);
    setDailySummaries([]);
    setStationId(nextStationId);
  }

  function selectDate(date: string) {
    if (date === selectedDate) return;
    setDetailLoading(true);
    setError(null);
    setDailySummaries([]);
    setSelectedDate(date);
  }

  async function rebuildSelectedDate() {
    if (!selectedDate || rebuildLoading) return;

    const scopeLabel = stationId
      ? stations.find((station) => station.id === stationId)?.name ?? stationId
      : "all stations";
    if (!window.confirm(
      `Rebuild ${formatDate(selectedDate)} for ${scopeLabel}? Existing summaries and audit logs will be replaced.`,
    )) return;

    setRebuildLoading(true);
    setRebuildProgress({ completed: 0, total: stationId ? 1 : 0, stationName: "Loading stations" });
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/audit-reports/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ date: selectedDate, stationId: stationId || undefined }),
      });
      if (!response.ok) throw new Error(`Rebuild failed (${response.status})`);
      const result = await consumeRebuildStream(response, setRebuildProgress);
      if (result.failedCount > 0) {
        throw new Error(`${result.failedCount} station rebuilds failed; their existing reports were preserved.`);
      }

      setNotice(`Rebuilt ${result.stationCount} station report${result.stationCount === 1 ? "" : "s"} for ${formatDate(selectedDate)}.`);
      setSummaryLoading(true);
      setDetailLoading(true);
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to rebuild the selected date.");
    } finally {
      setRebuildLoading(false);
      setRebuildProgress(null);
    }
  }

  return (
    <div className="grid gap-4">
      <section className="panel p-0">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <button className="icon-button" type="button" onClick={() => changeMonth(-1)} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <h2 className="min-w-40 text-center text-sm font-semibold text-text-primary">{formatMonth(month)}</h2>
            <button className="icon-button" type="button" onClick={() => changeMonth(1)} aria-label="Next month">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Station
              <select
                className="field min-w-52 normal-case"
                value={stationId}
                onChange={(event) => changeStation(event.target.value)}
              >
                <option value="">All stations</option>
                {stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
              </select>
            </label>
            <button
              className="primary-action inline-flex items-center justify-center gap-2"
              disabled={hydrated ? !selectedDate || rebuildLoading : undefined}
              onClick={() => void rebuildSelectedDate()}
              type="button"
            >
              <RefreshCw className={`h-4 w-4 ${rebuildLoading ? "animate-spin" : ""}`} aria-hidden="true" />
              {rebuildLoading
                ? `Rebuilding ${rebuildProgress?.completed ?? 0}/${rebuildProgress?.total || "…"}`
                : "Rebuild selected date"}
            </button>
          </div>
        </div>

        {error ? <p className="border-b border-danger bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
        {notice ? <p className="border-b border-success bg-success-bg px-4 py-3 text-sm text-success">{notice}</p> : null}
        {rebuildLoading && rebuildProgress ? (
          <div className="border-b border-border bg-bg-raised px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
              <span className="truncate">{rebuildProgress.stationName}</span>
              <span className="shrink-0 font-mono">
                {rebuildProgress.completed}/{rebuildProgress.total || "…"} stations
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-[2px] bg-border">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{
                  width: `${rebuildProgress.total
                    ? (rebuildProgress.completed / rebuildProgress.total) * 100
                    : 0}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto p-3">
          <div className="grid min-w-[760px] grid-cols-7 border-l border-t border-border">
            {WEEKDAYS.map((day) => (
              <div className="border-b border-r border-border bg-bg-raised px-2 py-2 text-xs font-semibold text-text-secondary" key={day}>
                {day}
              </div>
            ))}
            {calendarDays.map((day) => {
              const summary = day.date ? summariesByDate.get(day.date) : undefined;
              const selected = day.date === selectedDate;
              return (
                <button
                  className={`min-h-28 border-b border-r border-border p-2 text-left align-top transition-colors ${
                    selected ? "bg-accent-subtle" : "bg-bg-surface hover:bg-bg-raised"
                  } ${day.date ? "" : "cursor-default opacity-40"}`}
                  disabled={!day.date}
                  key={day.key}
                  onClick={() => day.date && selectDate(day.date)}
                  type="button"
                >
                  <span className="font-mono text-xs text-text-secondary">{day.dayNumber}</span>
                  <span className="mt-3 flex flex-col items-start gap-1">
                    {summary?.missingCount ? <span className="count-chip">{summary.missingCount} missing</span> : null}
                    {summary?.rangeViolationCount ? <span className="count-chip count-chip-danger">{summary.rangeViolationCount} out of range</span> : null}
                    {!summary && day.date && !summaryLoading ? <span className="text-[11px] text-text-muted">No report</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {!selectedDate ? (
        <div className="panel py-8 text-center text-sm text-text-secondary">Select a calendar date to load audit details.</div>
      ) : detailLoading ? (
        <div className="panel py-8 text-center text-sm text-text-secondary">Loading {formatDate(selectedDate)} audits…</div>
      ) : (
        <>
          <StationDateSummary date={selectedDate} summaries={dailySummaries} />
          <AuditDetails date={selectedDate} rangeRows={rangeRows} missingRows={missingRows} />
        </>
      )}
    </div>
  );
}

function StationDateSummary({ date, summaries }: { date: string; summaries: DailySummary[] }) {
  return (
    <section className="panel p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="panel-title">Station Summary</h2>
          <p className="mt-1 text-xs text-text-secondary">Recorded findings per station for {formatDate(date)}.</p>
        </div>
        <span className="status-chip">{summaries.length} stations</span>
      </div>
      <div className="overflow-x-auto">
        <table className="ops-table">
          <thead>
            <tr><th>Station</th><th>Missing records</th><th>Out of range</th><th>Range violations by metric</th><th>Status</th></tr>
          </thead>
          <tbody>
            {summaries.length ? summaries.map((summary) => {
              const issueCount = summary.missingCount + summary.rangeViolationCount;
              const violationsByMetric = readRangeViolationSummary(summary.rangeViolationSummary);
              return (
                <tr key={summary.stationId}>
                  <td>
                    <span className="font-medium text-text-primary">{summary.stationName}</span><br />
                    <span className="font-mono text-xs text-text-muted">{summary.stationId}</span>
                  </td>
                  <td><span className={summary.missingCount ? "count-chip" : "text-text-muted"}>{summary.missingCount}</span></td>
                  <td><span className={summary.rangeViolationCount ? "count-chip count-chip-danger" : "text-text-muted"}>{summary.rangeViolationCount}</span></td>
                  <td>
                    {violationsByMetric.length ? (
                      <span className="flex flex-wrap gap-1">
                        {violationsByMetric.map(({ metric, count }) => (
                          <span className="count-chip count-chip-danger" key={metric}>
                            {formatMetricLabel(metric)} {count}
                          </span>
                        ))}
                      </span>
                    ) : <span className="text-text-muted">—</span>}
                  </td>
                  <td>
                    <span className={issueCount ? "count-chip count-chip-caution" : "count-chip"}>
                      {issueCount ? "Attention" : "Clear"}
                    </span>
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={5} className="py-8 text-center text-text-muted">No station summaries recorded for this date.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AuditDetails({
  date,
  rangeRows,
  missingRows,
}: {
  date: string;
  rangeRows: Array<AuditLog & { stationId: string; stationName: string }>;
  missingRows: DailySummary[];
}) {
  const [tableMode, setTableMode] = useState<"normal" | "full">("normal");
  const tablePanelClass = tableMode === "full"
    ? "panel fixed inset-x-4 top-16 bottom-4 z-30 overflow-hidden p-0"
    : "panel min-w-0 overflow-hidden p-0";

  return (
    <section className="grid gap-4">
      <div className={tablePanelClass}>
        <div className="flex h-full min-w-0 flex-col">
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="panel-title">Acceptable Range Audit</h2>
            <p className="mt-1 text-xs text-text-secondary">Exact violating rows recorded for {formatDate(date)}.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="count-chip count-chip-danger">{rangeRows.length} rows</span>
            <button
              aria-label="Minimize acceptable range audit"
              aria-pressed={tableMode === "normal"}
              className={`icon-button ${tableMode === "normal" ? "nav-pill-active" : ""}`}
              onClick={() => setTableMode("normal")}
              title="Minimize"
              type="button"
            >
              <Minimize2 aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              aria-label="Expand acceptable range audit"
              aria-pressed={tableMode === "full"}
              className={`icon-button ${tableMode === "full" ? "nav-pill-active" : ""}`}
              onClick={() => setTableMode("full")}
              title="Expand"
              type="button"
            >
              <Maximize2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className={`min-w-0 overflow-auto ${tableMode === "full" ? "min-h-0 flex-1" : "max-h-[440px]"}`}>
          <table className="ops-table">
            <thead><tr><th className="sticky top-0 z-10">Station</th><th className="sticky top-0 z-10">Metric</th><th className="sticky top-0 z-10">Timestamp</th><th className="sticky top-0 z-10">Value</th><th className="sticky top-0 z-10">Stored row</th></tr></thead>
            <tbody>
              {rangeRows.length ? rangeRows.map((row) => {
                const contents = readRowContents(row.rowContents);
                return (
                  <tr key={row.id}>
                    <td><span className="font-medium text-text-primary">{row.stationName}</span><br /><span className="font-mono text-xs text-text-muted">{row.stationId}</span></td>
                    <td>{contents.metric ?? "—"}</td>
                    <td className="font-mono">{contents.timestamp ? formatTimestamp(contents.timestamp) : "—"}</td>
                    <td className="font-mono text-danger">{contents.value ?? "—"}</td>
                    <td><code className="block max-w-xl whitespace-pre-wrap break-all text-xs text-text-secondary">{JSON.stringify(row.rowContents)}</code></td>
                  </tr>
                );
              }) : <tr><td colSpan={5} className="py-8 text-center text-text-muted">No acceptable-range violations recorded.</td></tr>}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      <div className="panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="panel-title">Data Quality</h2>
            <p className="mt-1 text-xs text-text-secondary">Missing-data findings recorded for this date.</p>
          </div>
          <span className="count-chip">{missingRows.length} stations</span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {missingRows.length ? missingRows.map((summary) => (
            <div className="event-row" key={summary.stationId}>
              <p className="text-sm font-medium text-text-primary">{summary.stationName}</p>
              <p className="mt-1 text-xs text-text-secondary">{summary.missingCount} missing records</p>
            </div>
          )) : <p className="text-sm text-text-muted">No missing data recorded.</p>}
        </div>
      </div>
    </section>
  );
}

function readRowContents(value: unknown): { metric?: string; timestamp?: string; value?: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  return {
    metric: typeof row.metric === "string" ? row.metric : undefined,
    timestamp: typeof row.timestamp === "string" ? row.timestamp : undefined,
    value: typeof row.value === "number" ? row.value : undefined,
  };
}

function readRangeViolationSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  return Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([metric, count]) => ({ metric, count }))
    .sort((a, b) => b.count - a.count || a.metric.localeCompare(b.metric));
}

function formatMetricLabel(metric: string) {
  return metric.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function buildCalendarDays(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Math.ceil((firstWeekday + dayCount) / 7) * 7;

  return Array.from({ length: cells }, (_, index) => {
    const day = index - firstWeekday + 1;
    const valid = day >= 1 && day <= dayCount;
    return {
      key: `${monthKey}-${index}`,
      dayNumber: valid ? day : "",
      date: valid ? `${monthKey}-${String(day).padStart(2, "0")}` : null,
    };
  });
}

function getCurrentPhtMonth() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function offsetMonth(monthKey: string, offset: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(monthKey: string) {
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${monthKey}-01T00:00:00.000Z`));
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00.000Z`));
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(timestamp));
}

async function consumeRebuildStream(
  response: Response,
  onProgress: (progress: RebuildProgress) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Rebuild response did not provide a readable progress stream.");

  const decoder = new TextDecoder();
  let buffer = "";
  let stationCount = 0;
  let failedCount = 0;

  function processLine(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as Record<string, unknown>;
    const eventName = typeof event.event === "string" ? event.event : "";
    const total = typeof event.stationCount === "number" ? event.stationCount : stationCount;
    const completed = typeof event.completedCount === "number" ? event.completedCount : 0;
    const stationName = typeof event.stationName === "string" ? event.stationName : "Preparing stations";
    stationCount = total;

    if (eventName === "init") {
      onProgress({ completed: 0, total, stationName: "Preparing station investigations" });
    } else if (eventName === "station_start") {
      onProgress({ completed, total, stationName: `Rebuilding ${stationName}` });
    } else if (eventName === "result") {
      if (event.status === "failed") failedCount += 1;
      onProgress({ completed, total, stationName: `${stationName} complete` });
    } else if (eventName === "error") {
      throw new Error(typeof event.message === "string" ? event.message : "Rebuild stream failed.");
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
    if (done) break;
  }
  if (buffer.trim()) processLine(buffer);

  return { stationCount, failedCount };
}

function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
