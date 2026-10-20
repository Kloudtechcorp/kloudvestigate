"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Activity, ChevronLeft, ChevronRight, Download, LoaderCircle, Search } from "lucide-react";
import type { StationMetadata } from "@/lib/telemetry-types";
import {
  formatUptimeMinute,
  getMinutePage,
  getMinuteRecordCount,
  getMinuteStatus,
  getUptimeHealth,
  type MinuteStatus,
  type UptimeHealth,
  type UptimePeriod,
  type UptimeReport,
} from "@/lib/station-uptime";

const HEALTH_CLASSES: Record<UptimeHealth, string> = {
  Healthy: "bg-success-bg text-success",
  Good: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  Fair: "bg-warning-bg text-warning",
  Poor: "bg-danger-bg text-danger",
};
const NUMBER = new Intl.NumberFormat("en-US");
const PAGE_SIZE = 100;
type StationFailure = { station: StationMetadata; message: string };

function percent(value: number | null) {
  // Avoid displaying 98.00% next to Good when a value just below 98 rounds upward.
  return value === null ? "—" : `${(Math.floor(value * 100) / 100).toFixed(2)}%`;
}

function HealthBadge({ health }: { health: UptimeHealth | null }) {
  return <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${health ? HEALTH_CLASSES[health] : "bg-bg-raised text-text-secondary"}`}>
    {health ?? "Pending"}
  </span>;
}

export function UptimeWorkspace({ initialDate, today }: { initialDate: string; today: string }) {
  const [stations, setStations] = useState<StationMetadata[]>([]);
  const [stationLoading, setStationLoading] = useState(true);
  const [stationError, setStationError] = useState<string | null>(null);
  const [stationRefresh, setStationRefresh] = useState(0);
  const [source, setSource] = useState<"demo" | "kloudtrack" | null>(null);
  const [period, setPeriod] = useState<UptimePeriod>("daily");
  const [date, setDate] = useState(initialDate);
  const [month, setMonth] = useState(initialDate.slice(0, 7));
  const [year, setYear] = useState(initialDate.slice(0, 4));
  const [stationId, setStationId] = useState("");
  const [health, setHealth] = useState<UptimeHealth | "all">("all");
  const [search, setSearch] = useState("");
  const [reports, setReports] = useState<UptimeReport[]>([]);
  const [failures, setFailures] = useState<StationFailure[]>([]);
  const [running, setRunning] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [selectedStationId, setSelectedStationId] = useState("");
  const [minuteStatus, setMinuteStatus] = useState<MinuteStatus | "all">("all");
  const [page, setPage] = useState(1);
  const requestController = useRef<AbortController | null>(null);
  const value = period === "daily" ? date : period === "monthly" ? month : year;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/stations", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || "Unable to load stations.");
        return payload as { stations: StationMetadata[]; source: "demo" | "kloudtrack" };
      })
      .then((payload) => {
        setStations(payload.stations);
        setSource(payload.source);
        setStationError(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setStationError(error instanceof Error ? error.message : "Unable to load stations.");
      })
      .finally(() => { if (!controller.signal.aborted) setStationLoading(false); });
    return () => controller.abort();
  }, [stationRefresh]);

  useEffect(() => () => requestController.current?.abort(), []);

  const filteredReports = useMemo(() => {
    const term = search.trim().toLowerCase();
    return reports.filter((report) => (health === "all" || report.health === health)
      && [report.station.name, report.station.id, report.station.city, report.station.organizationName]
        .some((text) => text?.toLowerCase().includes(term)))
      .sort((a, b) => (a.uptimePercent ?? -1) - (b.uptimePercent ?? -1) || a.station.name.localeCompare(b.station.name));
  }, [reports, search, health]);
  const selectedReport = filteredReports.find((report) => report.station.id === selectedStationId) ?? filteredReports[0];
  const totals = filteredReports.reduce((total, report) => ({
    expected: total.expected + report.window.expectedMinutes,
    received: total.received + report.receivedMinutes,
    missing: total.missing + report.missingMinutes,
  }), { expected: 0, received: 0, missing: 0 });
  const overall = totals.expected ? totals.received / totals.expected * 100 : null;
  const minutePage = selectedReport ? getMinutePage(selectedReport, minuteStatus, page, PAGE_SIZE) : { total: 0, minutes: [] };
  const pageCount = Math.max(1, Math.ceil(minutePage.total / PAGE_SIZE));

  function resetResults() {
    setReports([]);
    setFailures([]);
    setProgress({ completed: 0, total: 0 });
    setSelectedStationId("");
    setMinuteStatus("all");
    setPage(1);
    setCancelled(false);
  }

  async function computeUptime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runUptime(stationId ? stations.filter((station) => station.id === stationId) : stations);
  }

  async function runUptime(targets: StationMetadata[], retryFailures = false) {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    if (retryFailures) {
      setFailures([]);
      setCancelled(false);
    } else {
      resetResults();
    }
    setRunning(true);
    setProgress({ completed: 0, total: targets.length });
    let next = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(2, targets.length) }, async () => {
        while (next < targets.length && !controller.signal.aborted) {
          const station = targets[next++];
          try {
            const response = await fetch("/api/uptime", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stationId: station.id, period, value }),
              cache: "no-store",
              signal: controller.signal,
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.message || `Uptime request failed (${response.status}).`);
            if (controller.signal.aborted) return;
            const report = payload as UptimeReport;
            setReports((current) => [...current, report]);
            setSelectedStationId((current) => current || report.station.id);
          } catch (error) {
            if (controller.signal.aborted) return;
            setFailures((current) => [...current, {
              station,
              message: error instanceof Error ? error.message : "Unable to compute station uptime.",
            }]);
          } finally {
            if (!controller.signal.aborted) setProgress((current) => ({ ...current, completed: current.completed + 1 }));
          }
        }
      }));
    } finally {
      if (requestController.current === controller) setRunning(false);
    }
  }

  function selectStation(id: string) {
    setSelectedStationId(id);
    setMinuteStatus("all");
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {source === "demo" && (
        <div className="rounded border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning" role="status">
          Demo data — the selected environment has no KloudTrack API token. These scores are examples, not live station reliability.
        </div>
      )}

      <form className="panel space-y-4" onSubmit={(event) => void computeUptime(event)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="panel-title flex items-center gap-2"><Activity aria-hidden="true" className="h-4 w-4 text-accent" /> Uptime scope</h2>
          <span className="text-xs text-text-secondary">1 expected reading / minute · Asia/Manila (UTC+8)</span>
        </div>
        <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_2fr_auto]">
          <label className="field-label">Period
            <select className="field" value={period} disabled={running} onChange={(event) => { setPeriod(event.target.value as UptimePeriod); resetResults(); }}>
              <option value="daily">Daily</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
            </select>
          </label>
          <label className="field-label">{period === "daily" ? "Date" : period === "monthly" ? "Month" : "Year"}
            {period === "daily" ? <input className="field" type="date" required max={today} min="1000-01-01" disabled={running} value={date}
              onChange={(event) => { setDate(event.target.value); resetResults(); }} />
              : period === "monthly" ? <input className="field" type="month" required max={today.slice(0, 7)} min="1000-01" disabled={running} value={month}
                onChange={(event) => { setMonth(event.target.value); resetResults(); }} />
                : <input className="field" type="number" required min={1000} max={Number(today.slice(0, 4))} step={1} disabled={running} value={year}
                  onChange={(event) => { setYear(event.target.value); resetResults(); }} />}
          </label>
          <label className="field-label">Station
            <select className="field" value={stationId} disabled={stationLoading || running} onChange={(event) => { setStationId(event.target.value); resetResults(); }}>
              <option value="">{stationLoading ? "Loading stations…" : `All stations (${stations.length})`}</option>
              {stations.map((station) => <option value={station.id} key={station.id}>{station.name}{station.city ? ` · ${station.city}` : ""}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button className="primary-action inline-flex items-center justify-center gap-2" type="submit" disabled={running || stationLoading || !stations.length}>
              {running ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Activity aria-hidden="true" className="h-4 w-4" />}
              {running ? "Computing…" : "Compute uptime"}
            </button>
            {running && <button className="nav-pill" type="button" onClick={() => { requestController.current?.abort(); setCancelled(true); }}>Stop</button>}
          </div>
        </div>
        {stationError && <div className="flex items-center gap-3 text-sm text-danger" role="alert">
          {stationError}<button className="nav-pill" type="button" onClick={() => { setStationLoading(true); setStationRefresh((current) => current + 1); }}>Retry station list</button>
        </div>}
        {!stationLoading && !stationError && stations.length === 0 && <p className="text-sm text-text-secondary">No stations are available in this environment.</p>}
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-text-secondary">
          <span><strong className="text-success">Healthy</strong> ≥ 98%</span>
          <span><strong className="text-sky-700 dark:text-sky-300">Good</strong> ≥ 90% to &lt; 98%</span>
          <span><strong className="text-warning">Fair</strong> ≥ 80% to &lt; 90%</span>
          <span><strong className="text-danger">Poor</strong> &lt; 80%</span>
        </div>
      </form>

      {(running || progress.total > 0) && <div className="space-y-2" role="status" aria-live="polite">
        <p className="text-sm text-text-secondary">
          {cancelled ? "Stopped." : running ? "Computing station uptime…" : "Report complete."} {progress.completed} of {progress.total} stations processed.
          {running && period === "yearly" ? " Annual reports fetch daily histories and can take several minutes." : ""}
          {running ? " Requests are paced and automatically retried if KloudTrack asks us to wait." : ""}
        </p>
        {running && <progress className="h-1.5 w-full accent-accent" value={progress.completed} max={progress.total} aria-label="Stations processed" />}
      </div>}

      {failures.length > 0 && <div className="rounded border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger" role="alert">
        <p className="font-semibold">{failures.length} station report{failures.length === 1 ? "" : "s"} could not be computed.</p>
        <ul className="mt-2 space-y-1">{failures.map((failure) => <li key={failure.station.id}>{failure.station.name}: {failure.message}</li>)}</ul>
        <p className="mt-2">Failed requests are excluded from the scores.</p>
        <button className="nav-pill mt-2 disabled:opacity-40" type="button" disabled={running}
          onClick={() => void runUptime(failures.map((failure) => failure.station), true)}>
          Retry failed stations
        </button>
      </div>}

      {reports.length > 0 ? <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Station reliability · {reports[0].window.value}</h2>
            <p className="mt-1 text-xs text-text-secondary">{NUMBER.format(reports[0].window.totalMinutes)} one-minute rows per station in this period. Scores below follow the station filters.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="field-label">Search stations
              <span className="relative"><Search aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 text-text-secondary" />
                <input className="field !pl-8" type="search" placeholder="Name, ID, city, organization" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
              </span>
            </label>
            <label className="field-label">Health
              <select className="field" value={health} onChange={(event) => { setHealth(event.target.value as UptimeHealth | "all"); setPage(1); }}>
                <option value="all">All health levels</option>
                {Object.keys(HEALTH_CLASSES).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Overall uptime" value={percent(overall)} detail={<HealthBadge health={getUptimeHealth(overall)} />} />
          <Stat label="Expected minutes" value={NUMBER.format(totals.expected)} detail={`${filteredReports.length} station${filteredReports.length === 1 ? "" : "s"} · elapsed minutes only`} />
          <Stat label="Received minutes" value={NUMBER.format(totals.received)} detail="Minutes with at least one reading" />
          <Stat label="Missing minutes" value={NUMBER.format(totals.missing)} detail="Elapsed minutes without a reading" />
        </div>

        <section className="panel !p-0" aria-label="Station uptime results">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h3 className="panel-title">Stations <span className="ml-1 text-text-secondary">({filteredReports.length})</span></h3>
            <p className="text-xs text-text-secondary">Select a station to inspect its minute log.</p>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="ops-table !min-w-[820px]">
              <thead><tr><th className="w-[26%]">Station</th><th>Uptime</th><th>Health</th><th>Expected</th><th>Received</th><th>Missing</th><th>Extra readings</th></tr></thead>
              <tbody>{filteredReports.map((report) => <tr key={report.station.id} className={selectedReport?.station.id === report.station.id ? "bg-accent-subtle" : ""}>
                <td><button type="button" aria-pressed={selectedReport?.station.id === report.station.id} className="text-left font-semibold text-text-primary underline decoration-border underline-offset-4 hover:decoration-accent"
                  onClick={() => selectStation(report.station.id)}>{report.station.name}</button>
                  <div className="mt-1 text-xs text-text-secondary">{report.station.city || report.station.id}</div></td>
                <td className="font-mono">{percent(report.uptimePercent)}</td><td><HealthBadge health={report.health} /></td>
                <td className="font-mono">{NUMBER.format(report.window.expectedMinutes)}</td><td className="font-mono text-success">{NUMBER.format(report.receivedMinutes)}</td>
                <td className="font-mono text-danger">{NUMBER.format(report.missingMinutes)}</td><td className="font-mono">{NUMBER.format(report.duplicateRecords)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {filteredReports.length === 0 && <p className="p-6 text-center text-sm text-text-secondary">No stations match these filters.</p>}
        </section>

        {selectedReport && <>
          <section className="panel space-y-4" aria-label="Uptime trend">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="panel-title">{selectedReport.station.name} · {period === "daily" ? "Hourly" : period === "monthly" ? "Daily" : "Monthly"} availability</h3>
              <span className="text-xs text-text-secondary">Score as of {formatUptimeMinute(selectedReport.window.asOf, 0)} PHT</span>
            </div>
            <div className="grid h-32 gap-1" style={{ gridTemplateColumns: `repeat(${selectedReport.buckets.length}, minmax(0, 1fr))` }} role="img"
              aria-label={`${selectedReport.station.name} availability by ${period === "daily" ? "hour" : period === "monthly" ? "day" : "month"}. ${selectedReport.buckets.map((bucket) => `${bucket.label}: ${percent(bucket.uptimePercent)}`).join("; ")}`}>
              {selectedReport.buckets.map((bucket, index) => {
                const bucketHealth = getUptimeHealth(bucket.uptimePercent);
                const color = bucketHealth === "Healthy" ? "bg-success" : bucketHealth === "Good" ? "bg-sky-500"
                  : bucketHealth === "Fair" ? "bg-warning" : bucketHealth === "Poor" ? "bg-danger" : "bg-missing";
                return <div key={bucket.label} className="flex min-w-0 flex-col justify-end gap-2" title={`${bucket.label}: ${percent(bucket.uptimePercent)} · ${NUMBER.format(bucket.receivedMinutes)} / ${NUMBER.format(bucket.expectedMinutes)} minutes`}>
                  <div className="flex h-24 items-end rounded-sm bg-bg-raised"><div className={`w-full rounded-sm ${color}`} style={{ height: `${Math.max(3, bucket.uptimePercent ?? 0)}%` }} /></div>
                  <span className="h-4 text-center font-mono text-[10px] text-text-secondary">{index % Math.ceil(selectedReport.buckets.length / 12) === 0
                    ? period === "daily" ? bucket.label.slice(0, 2) : period === "monthly" ? bucket.label.slice(8) : bucket.label.slice(5) : ""}</span>
                </div>;
              })}
            </div>
            <p className="text-xs leading-5 text-text-secondary">Uptime = minutes with a reading ÷ expected elapsed minutes × 100. Multiple readings in the same minute count once.
              Sensor values outside their normal range still count as received telemetry.
              {selectedReport.window.pendingMinutes > 0 ? ` ${NUMBER.format(selectedReport.window.pendingMinutes)} current or future minutes are pending and excluded from the score.` : ""}</p>
          </section>

          <section className="panel !p-0" aria-label="Minute log">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4">
              <div><h3 className="panel-title">Minute log · {selectedReport.station.name}</h3>
                <p className="mt-1 text-xs text-text-secondary">{NUMBER.format(selectedReport.window.totalMinutes)} rows · Philippine time · {PAGE_SIZE} rows per page</p></div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="field-label">Minute status
                  <select className="field" value={minuteStatus} onChange={(event) => { setMinuteStatus(event.target.value as MinuteStatus | "all"); setPage(1); }}>
                    <option value="all">All minutes</option><option value="received">Received only</option><option value="missing">Missing only</option><option value="pending">Pending only</option>
                  </select>
                </label>
                <button className="nav-pill inline-flex items-center gap-2" type="button" onClick={() => exportMinuteCsv(selectedReport)}>
                  <Download aria-hidden="true" className="h-4 w-4" /> Export full CSV
                </button>
              </div>
            </div>
            <div className="max-h-[460px] overflow-auto">
              <table className="ops-table !min-w-[560px]">
                <thead className="sticky top-0"><tr><th className="w-[15%]">Row</th><th className="w-[40%]">Minute (PHT)</th><th>Status</th><th>Readings</th></tr></thead>
                <tbody>{minutePage.minutes.map((minute) => {
                  const status = getMinuteStatus(selectedReport, minute);
                  return <tr key={minute}>
                    <td className="font-mono text-text-secondary">{NUMBER.format(minute + 1)}</td>
                    <td className="font-mono">{formatUptimeMinute(selectedReport.window.start, minute)}</td>
                    <td><span className={`rounded px-2 py-1 text-xs font-semibold ${status === "received" ? "bg-success-bg text-success" : status === "missing" ? "bg-danger-bg text-danger" : "bg-missing-bg text-missing"}`}>
                      {status === "received" ? "Received" : status === "missing" ? "Missing" : "Pending"}</span></td>
                    <td className="font-mono">{status === "pending" ? "—" : getMinuteRecordCount(selectedReport.runs, minute)}</td>
                  </tr>;
                })}</tbody>
              </table>
              {minutePage.total === 0 && <p className="p-6 text-center text-sm text-text-secondary">No {minuteStatus} minutes in this period.</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <p className="text-xs text-text-secondary">{minutePage.total ? `${NUMBER.format((page - 1) * PAGE_SIZE + 1)}–${NUMBER.format(Math.min(page * PAGE_SIZE, minutePage.total))}` : "0"} of {NUMBER.format(minutePage.total)} matching rows</p>
              <div className="flex items-center gap-2">
                <button className="nav-pill disabled:opacity-40" type="button" disabled={page <= 1} onClick={() => setPage(1)}>First</button>
                <button className="icon-button disabled:opacity-40" type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
                <span className="text-xs text-text-secondary">{NUMBER.format(page)} / {NUMBER.format(pageCount)}</span>
                <button className="icon-button disabled:opacity-40" type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
                <button className="nav-pill disabled:opacity-40" type="button" disabled={page >= pageCount} onClick={() => setPage(pageCount)}>Last</button>
              </div>
            </div>
          </section>
        </>}
      </> : !running && failures.length === 0 && <div className="panel flex flex-col items-center gap-3 py-12 text-center">
        <Activity aria-hidden="true" className="h-8 w-8 text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">See how reliably your stations report</h2>
        <p className="max-w-lg text-sm leading-6 text-text-secondary">Choose a station and period, then compute uptime. A complete day has 1,440 one-minute rows. Months follow the actual calendar; years include leap days.</p>
      </div>}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: React.ReactNode }) {
  return <div className="panel space-y-2"><p className="text-xs font-medium text-text-secondary">{label}</p>
    <p className="font-mono text-2xl text-text-primary">{value}</p><div className="text-xs text-text-secondary">{detail}</div></div>;
}

function exportMinuteCsv(report: UptimeReport) {
  const escape = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const station = `${escape(report.station.id)},${escape(report.station.name)}`;
  const chunks = ["\uFEFFRow,Station ID,Station,Minute (PHT),Status,Readings\r\n"];
  for (let start = 0; start < report.window.totalMinutes; start += 1440) {
    const rows: string[] = [];
    for (let minute = start; minute < Math.min(start + 1440, report.window.totalMinutes); minute += 1) {
      const status = getMinuteStatus(report, minute);
      rows.push(`${minute + 1},${station},${formatUptimeMinute(report.window.start, minute)},${status},${status === "pending" ? "" : getMinuteRecordCount(report.runs, minute)}`);
    }
    chunks.push(`${rows.join("\r\n")}\r\n`);
  }
  const url = URL.createObjectURL(new Blob(chunks, { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `uptime-${report.station.id}-${report.window.value}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
