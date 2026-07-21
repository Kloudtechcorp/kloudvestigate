"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, RefreshCw } from "lucide-react";

type CalendarSummary = {
  date: string;
  missingCount: number;
  rangeViolationCount: number;
  rangeViolationStations: StationOption[];
  stationSummaries: DailySummary[];
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
  const detailRequestController = useRef<AbortController | null>(null);
  const selectedDateRef = useRef<string | null>(null);
  const [month, setMonth] = useState(getCurrentPhtMonth);
  const [stationId, setStationId] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<CalendarSummary[]>([]);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [dailySummaryLoading, setDailySummaryLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailsLoaded, setDetailsLoaded] = useState(false);
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
        const currentDate = selectedDateRef.current;
        if (currentDate) {
          setDailySummaries(
            payload.summaries.find((summary) => summary.date === currentDate)?.stationSummaries ?? [],
          );
          setDailySummaryLoading(false);
        }
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
    resetAuditDetails();
    setSummaryLoading(true);
    setError(null);
    setDailySummaries([]);
    setMonth((current) => offsetMonth(current, offset));
    selectedDateRef.current = null;
    setSelectedDate(null);
  }

  function changeStation(nextStationId: string) {
    resetAuditDetails();
    setSummaryLoading(true);
    setDailySummaryLoading(Boolean(selectedDate));
    setError(null);
    setDailySummaries([]);
    setStationId(nextStationId);
  }

  function selectDate(date: string) {
    if (date === selectedDate) return;
    resetAuditDetails();
    setDailySummaryLoading(false);
    setError(null);
    setDailySummaries(summariesByDate.get(date)?.stationSummaries ?? []);
    selectedDateRef.current = date;
    setSelectedDate(date);
  }

  async function loadAuditDetails() {
    if (!selectedDate || detailLoading || detailsLoaded) return;

    const controller = new AbortController();
    detailRequestController.current = controller;
    const params = new URLSearchParams({ date: selectedDate, includeDetails: "true" });
    if (stationId) params.set("stationId", stationId);

    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/audit-reports?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Audit detail request failed (${response.status})`);
      const payload = await response.json() as DailyResponse;
      setDailySummaries(payload.summaries);
      setDetailsLoaded(true);
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(requestError instanceof Error ? requestError.message : "Unable to load audit details.");
      }
    } finally {
      if (!controller.signal.aborted) {
        detailRequestController.current = null;
        setDetailLoading(false);
      }
    }
  }

  function resetAuditDetails() {
    detailRequestController.current?.abort();
    detailRequestController.current = null;
    setDetailLoading(false);
    setDetailsLoaded(false);
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
      resetAuditDetails();
      setSummaryLoading(true);
      setDailySummaryLoading(true);
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
                ? `Rebuilding ${rebuildProgress?.completed ?? 0}/${rebuildProgress?.total || "..."}`
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
                {rebuildProgress.completed}/{rebuildProgress.total || "..."} stations
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
                    {summary?.rangeViolationStations.slice(0, 2).map((station) => (
                      <span
                        className="mini-chip mini-chip-danger text-xs max-w-full truncate normal-case tracking-normal"
                        key={station.id}
                        title={`${station.name} has range violations`}
                      >
                        {station.name}
                      </span>
                    ))}
                    {summary && summary.rangeViolationStations.length > 2 ? (
                      <span
                        className="mini-chip mini-chip-danger text-xs"
                        title={summary.rangeViolationStations.slice(2).map((station) => station.name).join(", ")}
                      >
                        +{summary.rangeViolationStations.length - 2} stations
                      </span>
                    ) : null}
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
      ) : dailySummaryLoading ? (
        <div className="panel py-8 text-center text-sm text-text-secondary">Loading {formatDate(selectedDate)} station summary...</div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="grid min-w-0 gap-4">
            <StationDateSummary date={selectedDate} summaries={dailySummaries} />
            {detailsLoaded ? (
              <AuditDetails date={selectedDate} rangeRows={rangeRows} missingRows={missingRows} />
            ) : (
              <section className="panel flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="panel-title">Detailed audits</h2>
                  <p className="mt-1 text-xs text-text-secondary">
                    Load the acceptable-range audit and data-quality sections only when you need them.
                  </p>
                </div>
                <button
                  className="primary-action shrink-0"
                  disabled={detailLoading}
                  onClick={() => void loadAuditDetails()}
                  type="button"
                >
                  {detailLoading ? "Loading details..." : "Load detailed audits"}
                </button>
              </section>
            )}
          </div>
          <CompactDateNavigator
            calendarDays={calendarDays}
            month={month}
            onSelectDate={selectDate}
            selectedDate={selectedDate}
            summariesByDate={summariesByDate}
          />
        </div>
      )}
    </div>
  );
}

function CompactDateNavigator({
  calendarDays,
  month,
  onSelectDate,
  selectedDate,
  summariesByDate,
}: {
  calendarDays: ReturnType<typeof buildCalendarDays>;
  month: string;
  onSelectDate: (date: string) => void;
  selectedDate: string;
  summariesByDate: Map<string, CalendarSummary>;
}) {
  return (
    <aside
      aria-label="Quick date navigation"
      className="panel sticky top-12 z-20 hidden p-3 shadow-lg xl:block"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Quick date</p>
          <p className="mt-0.5 text-sm font-semibold text-text-primary">{formatMonth(month)}</p>
        </div>
        <span className="status-chip">{Number(selectedDate.slice(-2))}</span>
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid">
        {WEEKDAYS.map((day) => (
          <span className="py-1 text-center text-[10px] font-semibold text-text-muted" key={day} role="columnheader">
            {day.slice(0, 1)}
          </span>
        ))}
        {calendarDays.map((day) => {
          const summary = day.date ? summariesByDate.get(day.date) : undefined;
          const selected = day.date === selectedDate;
          const hasFindings = Boolean(summary && (summary.missingCount || summary.rangeViolationCount));
          return day.date ? (
            <button
              aria-current={selected ? "date" : undefined}
              aria-label={`${formatDate(day.date)}${hasFindings ? ", has findings" : ""}`}
              className={`relative flex aspect-square items-center justify-center rounded text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                selected
                  ? "bg-accent text-white"
                  : "text-text-secondary hover:bg-bg-raised hover:text-text-primary"
              }`}
              key={day.key}
              onClick={() => onSelectDate(day.date!)}
              role="gridcell"
              type="button"
            >
              {day.dayNumber}
              {hasFindings ? (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-1 h-1 w-1 rounded-full ${selected ? "bg-white" : "bg-danger"}`}
                />
              ) : null}
            </button>
          ) : <span aria-hidden="true" key={day.key} role="gridcell" />;
        })}
      </div>
      <p className="mt-3 border-t border-border pt-2 text-[11px] leading-4 text-text-muted">
        Dates with findings are marked with a dot.
      </p>
    </aside>
  );
}

function StationDateSummary({ date, summaries }: { date: string; summaries: DailySummary[] }) {
  const sortedSummaries = [...summaries].sort((a, b) => {
    const groupSort = getStationGroup(a.stationName).localeCompare(
      getStationGroup(b.stationName),
      undefined,
      { numeric: true, sensitivity: "base" },
    );
    return groupSort || a.stationName.localeCompare(b.stationName, undefined, { numeric: true, sensitivity: "base" });
  });

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
            {sortedSummaries.length ? sortedSummaries.map((summary) => {
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
                    ) : <span className="text-text-muted">-</span>}
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

function getStationGroup(stationName: string) {
  return stationName.split("-").at(-1)?.trim() ?? stationName;
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
  const pivotedAudit = useMemo(() => buildRangeViolationPivot(rangeRows), [rangeRows]);
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
            <p className="mt-1 text-xs text-text-secondary">Violations grouped by station and recorded timestamp for {formatDate(date)}.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="count-chip count-chip-danger">{rangeRows.length} violations</span>
            <span className="count-chip">{pivotedAudit.rows.length} timestamps</span>
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
            <thead>
              <tr>
                <th className="sticky top-0 z-10">Station</th>
                <th className="sticky top-0 z-10">Timestamp</th>
                {pivotedAudit.metrics.map((metric) => (
                  <th className="sticky top-0 z-10" key={metric}>{formatMetricLabel(metric)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pivotedAudit.rows.length ? pivotedAudit.rows.map((row) => {
                return (
                  <tr key={row.key}>
                    <td><span className="font-medium text-text-primary">{row.stationName}</span><br /><span className="font-mono text-xs text-text-muted">{row.stationId}</span></td>
                    <td className="font-mono">{row.timestamp ? formatTimestamp(row.timestamp) : "-"}</td>
                    {pivotedAudit.metrics.map((metric) => {
                      const cell = row.values[metric];
                      return (
                        <td className="font-mono" key={metric}>
                          {cell ? (
                            <span className="text-danger" title={JSON.stringify(cell.rowContents)}>
                              {cell.value ?? "-"}
                            </span>
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              }) : <tr><td colSpan={pivotedAudit.metrics.length + 2} className="py-8 text-center text-text-muted">No acceptable-range violations recorded.</td></tr>}
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

function buildRangeViolationPivot(rangeRows: Array<AuditLog & { stationId: string; stationName: string }>) {
  type PivotCell = { value?: number; rowContents: unknown };
  type PivotRow = {
    key: string;
    stationId: string;
    stationName: string;
    timestamp?: string;
    values: Record<string, PivotCell>;
  };

  const metrics = new Set<string>();
  const rows = new Map<string, PivotRow>();

  for (const audit of rangeRows) {
    const contents = readRowContents(audit.rowContents);
    const metric = contents.metric ?? "unknown";
    const rowKey = `${audit.stationId}:${contents.timestamp ?? audit.id}`;
    const existing = rows.get(rowKey);
    const pivotRow = existing ?? {
      key: rowKey,
      stationId: audit.stationId,
      stationName: audit.stationName,
      timestamp: contents.timestamp,
      values: {},
    };

    metrics.add(metric);
    pivotRow.values[metric] = { value: contents.value, rowContents: audit.rowContents };
    rows.set(rowKey, pivotRow);
  }

  return {
    metrics: Array.from(metrics).sort((a, b) => formatMetricLabel(a).localeCompare(formatMetricLabel(b))),
    rows: Array.from(rows.values()).sort((a, b) => {
      const stationSort = a.stationName.localeCompare(b.stationName);
      if (stationSort) return stationSort;
      const aTime = a.timestamp ? Date.parse(a.timestamp) : Number.MAX_SAFE_INTEGER;
      const bTime = b.timestamp ? Date.parse(b.timestamp) : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    }),
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
