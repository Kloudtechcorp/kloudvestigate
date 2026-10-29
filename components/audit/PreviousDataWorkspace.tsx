"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, History, LoaderCircle, Play, RotateCcw, Square, TriangleAlert } from "lucide-react";
import {
  formatDate,
  listDates,
  startPreviousDataRun,
  stopPreviousDataRun,
  usePreviousDataRun,
  useSavedPreviousDataProgress,
} from "./previous-data-runner";

export function PreviousDataWorkspace({ earliestDate, latestDate }: { earliestDate: string; latestDate: string }) {
  const run = usePreviousDataRun();
  const savedProgress = useSavedPreviousDataProgress();
  const [fromInput, setFromInput] = useState(earliestDate);
  const [toInput, setToInput] = useState(latestDate);
  const active = run.runState === "running" || run.runState === "waiting";
  // While a run is going, the fields show its range even after leaving and returning to this tab.
  const from = active && run.range ? run.range.from : fromInput;
  const to = active && run.range ? run.range.to : toInput;
  const rangeDays = listDates(from, to).length;
  const canResume = Boolean(savedProgress && savedProgress.nextDate <= savedProgress.to);
  const secondsLeft = useSecondsUntil(run.waitUntil);

  function start(startDate: string, range = { from, to }) {
    setFromInput(range.from);
    setToInput(range.to);
    startPreviousDataRun(range, startDate);
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
              are kept. It keeps running while you use other tabs in this app; reloading or closing the browser tab
              stops it, and Resume continues from there.
            </p>
          </div>
          <span className="count-chip">{rangeDays} days</span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="field-label mt-0">
            From
            <input
              className="field"
              disabled={active}
              max={to}
              onChange={(event) => setFromInput(event.target.value)}
              type="date"
              value={from}
            />
          </label>
          <label className="field-label mt-0">
            To
            <input
              className="field"
              disabled={active}
              max={latestDate}
              min={from}
              onChange={(event) => setToInput(event.target.value)}
              type="date"
              value={to}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {active ? (
              <button className="primary-action inline-flex items-center gap-2 bg-danger text-white" onClick={stopPreviousDataRun} type="button">
                <Square aria-hidden="true" className="h-4 w-4" />
                Stop
              </button>
            ) : canResume && savedProgress ? (
              <>
                <button
                  className="primary-action inline-flex items-center gap-2"
                  onClick={() => start(savedProgress.nextDate, { from: savedProgress.from, to: savedProgress.to })}
                  type="button"
                >
                  <Play aria-hidden="true" className="h-4 w-4" />
                  Resume from {formatDate(savedProgress.nextDate)}
                </button>
                <button
                  className="nav-pill inline-flex items-center gap-2 disabled:opacity-40"
                  disabled={!rangeDays}
                  onClick={() => start(from)}
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
                onClick={() => start(from)}
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
          <li>Days before a station first reported are skipped without asking KloudTrack. Readings start in October 2025.</li>
          <li>Requests are paced to stay inside KloudTrack&apos;s limits; if a limit is reached anyway, it waits and continues by itself.</li>
          <li>Days before this month keep the daily summary only; per-minute details are kept for the current month.</li>
        </ul>
      </section>

      {active && run.progress ? (
        <section className="panel grid gap-2" aria-live="polite" role="status">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="inline-flex items-center gap-2 font-semibold text-text-primary">
              {run.runState === "waiting"
                ? <Clock aria-hidden="true" className="h-4 w-4 text-warning" />
                : <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {run.progress.title}
            </span>
            <span className="font-mono text-xs text-text-secondary">{run.progress.step}</span>
          </div>
          <progress aria-label="Progress" className="h-1.5 w-full accent-accent" max={run.progress.max} value={run.progress.value} />
          <p className="truncate text-xs text-text-secondary">
            {run.runState === "waiting" && secondsLeft !== null
              ? `Waiting for KloudTrack's limit to reset: continuing in ${formatCountdown(secondsLeft)}`
              : run.progress.detail}
          </p>
        </section>
      ) : null}

      {run.message ? (
        <p
          className={`flex items-start gap-2 rounded border px-4 py-3 text-sm ${
            run.runState === "done"
              ? "border-success bg-success-bg text-success"
              : run.runState === "error"
                ? "border-danger bg-danger-bg text-danger"
                : "border-warning bg-warning-bg text-warning"
          }`}
          role={run.runState === "error" ? "alert" : "status"}
        >
          {run.runState === "done"
            ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            : <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
          {run.message}
        </p>
      ) : null}

      {run.log.length ? (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-5">
            <TotalStat label="Saved" value={run.totals.saved} />
            <TotalStat label="No data (error)" value={run.totals.noData} emphasis={run.totals.noData > 0} />
            <TotalStat label="Already saved" value={run.totals.kept} />
            <TotalStat label="Not created yet" value={run.totals.notCreated} />
            <TotalStat label="Failed" value={run.totals.failed} emphasis={run.totals.failed > 0} />
          </div>

          <section className="panel p-0">
            <h2 className="panel-title border-b border-border px-4 py-3">Days processed this run</h2>
            <ul className="max-h-[420px] overflow-auto">
              {run.log.map((entry, index) => (
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

function useSecondsUntil(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return until === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${String(seconds % 60).padStart(2, "0")} s` : `${seconds} s`;
}
