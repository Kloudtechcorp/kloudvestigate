"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Maximize2, Minimize2 } from "lucide-react";
import type { MetricKey, RangeViolation, TelemetryAnalysis } from "@/lib/telemetry-types";
import { formatTime } from "./utils";
import type { MetricInvestigationAnalysis } from "./types";

type AuditMode = "normal" | "full";

type AuditCell = {
  value: number;
  rangeViolation?: RangeViolation;
};

type AuditRow = {
  timestamp: string;
  cells: Partial<Record<MetricKey, AuditCell>>;
};

type AuditSortKey = "timestamp" | MetricKey;
type AuditSortDirection = "asc" | "desc";

export function OutlierOverview({
  analysis,
  metricAnalyses,
}: {
  analysis?: TelemetryAnalysis;
  metricAnalyses?: MetricInvestigationAnalysis[];
}) {
  const [mode, setMode] = useState<AuditMode>("normal");
  const analyses = useMemo(
    () => (
      metricAnalyses?.length
        ? metricAnalyses
        : analysis
          ? [{ metric: analysis.metricProfile.metric, analysis, records: [] }]
          : []
    ),
    [analysis, metricAnalyses],
  );
  const auditRows = useMemo(() => buildAuditRows(analyses), [analyses]);
  const rangeCount = analyses.reduce((count, item) => count + item.analysis.rangeViolations.length, 0);

  const panelClass = mode === "full"
    ? "panel fixed inset-x-4 top-16 bottom-4 z-30 overflow-hidden"
    : "panel min-w-0 overflow-hidden";

  return (
    <div className={panelClass}>
      <div className="flex h-full min-w-0 flex-col">
        <div className="flex flex-col gap-3 border-b border-border bg-bg-raised px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="panel-title">Acceptable Range Audit</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="status-chip">{rangeCount} range flags</span>
            <span className="status-chip">{auditRows.length} rows</span>
            <button
              aria-label="Minimize acceptable range audit"
              aria-pressed={mode === "normal"}
              className={`icon-button ${mode === "normal" ? "nav-pill-active" : ""}`}
              title="Minimize"
              type="button"
              onClick={() => setMode("normal")}
            >
              <Minimize2 aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              aria-label="Expand acceptable range audit"
              aria-pressed={mode === "full"}
              className={`icon-button ${mode === "full" ? "nav-pill-active" : ""}`}
              title="Expand"
              type="button"
              onClick={() => setMode("full")}
            >
              <Maximize2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        <p className="px-4 pt-3 text-sm text-muted-foreground">
          {analyses.length > 1
            ? `Auditing ${analyses.length} metrics from the all-metric history response.`
            : analysis
              ? `Accepted range: ${analysis.metricProfile.acceptableRange.minimum} to ${analysis.metricProfile.acceptableRange.maximum} ${analysis.metricProfile.unit}`
              : "Run an investigation to populate the audit table."}
        </p>

        <JoinedAuditTable analyses={analyses} rows={auditRows} expanded={mode === "full"} />
      </div>
    </div>
  );
}

function JoinedAuditTable({
  analyses,
  rows,
  expanded,
}: {
  analyses: MetricInvestigationAnalysis[];
  rows: AuditRow[];
  expanded: boolean;
}) {
  const [sortKey, setSortKey] = useState<AuditSortKey>("timestamp");
  const [sortDirection, setSortDirection] = useState<AuditSortDirection>("asc");
  const metricColumns = analyses.map((item) => ({
    key: item.metric,
    label: item.analysis.metricProfile.label,
  }));
  const sortedRows = useMemo(
    () => sortAuditRows(rows, sortKey, sortDirection),
    [rows, sortDirection, sortKey],
  );

  if (!rows.length) {
    return <p className="px-4 py-6 text-sm italic text-text-muted">No range violations detected.</p>;
  }

  function setSort(nextKey: AuditSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection("asc");
  }

  return (
    <div className={`mt-3 min-w-0 overflow-auto ${expanded ? "min-h-0 flex-1" : "max-h-[520px]"}`}>
      <table className="ops-table min-w-[1100px]">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 bg-surface-table-header">
              <SortableAuditHeader
                label="Timestamp (PH)"
                sortKey="timestamp"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={setSort}
              />
            </th>
            {metricColumns.map((metric) => (
              <th className="sticky top-0 z-10 bg-surface-table-header" key={metric.key}>
                <SortableAuditHeader
                  label={metric.label}
                  sortKey={metric.key}
                  activeKey={sortKey}
                  direction={sortDirection}
                  onSort={setSort}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.timestamp}>
              <td className="sticky left-0 z-10 bg-surface font-mono">{formatTime(row.timestamp)}</td>
              {metricColumns.map((metric) => {
                const cell = row.cells[metric.key];
                return (
                  <td
                    className={getAuditCellClass(cell)}
                    key={metric.key}
                    title={cell ? getAuditCellTitle(cell, metric.label) : undefined}
                  >
                    {cell ? (
                      <div className="grid gap-1">
                        <span className={cell.rangeViolation ? "font-semibold" : "font-normal"}>{cell.value}</span>
                        <div className="flex flex-wrap gap-1">
                          {cell.rangeViolation ? <span className="mini-chip mini-chip-danger">range</span> : null}
                        </div>
                      </div>
                    ) : (
                      <span className="text-text-muted italic">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableAuditHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: AuditSortKey;
  activeKey: AuditSortKey;
  direction: AuditSortDirection;
  onSort: (key: AuditSortKey) => void;
}) {
  const active = activeKey === sortKey;
  const SortIcon = !active ? ChevronsUpDown : direction === "asc" ? ChevronUp : ChevronDown;

  return (
    <button
      className="flex w-full items-center justify-between gap-2 text-left"
      type="button"
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      <SortIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function sortAuditRows(
  rows: AuditRow[],
  sortKey: AuditSortKey,
  direction: AuditSortDirection,
) {
  const multiplier = direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    if (sortKey === "timestamp") {
      return (Date.parse(a.timestamp) - Date.parse(b.timestamp)) * multiplier;
    }

    const aValue = a.cells[sortKey]?.value;
    const bValue = b.cells[sortKey]?.value;

    if (aValue === undefined && bValue === undefined) {
      return Date.parse(a.timestamp) - Date.parse(b.timestamp);
    }
    if (aValue === undefined) return 1;
    if (bValue === undefined) return -1;

    const valueSort = (aValue - bValue) * multiplier;
    return valueSort || Date.parse(a.timestamp) - Date.parse(b.timestamp);
  });
}

function buildAuditRows(analyses: MetricInvestigationAnalysis[]): AuditRow[] {
  const rows = new Map<string, AuditRow>();
  const rangeTimestamps = new Set(
    analyses.flatMap((item) => item.analysis.rangeViolations.map((violation) => violation.timestamp)),
  );

  for (const item of analyses) {
    const violationsByTimestamp = new Map(
      item.analysis.rangeViolations.map((violation) => [violation.timestamp, violation]),
    );

    for (const record of item.records) {
      if (!rangeTimestamps.has(record.timestamp)) continue;

      const row = getOrCreateRow(rows, record.timestamp);
      const violation = violationsByTimestamp.get(record.timestamp);
      const cell: AuditCell = { value: record.value };
      if (violation) cell.rangeViolation = violation;
      row.cells[item.metric] = cell;
    }
  }

  return [...rows.values()]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function getOrCreateRow(rows: Map<string, AuditRow>, timestamp: string): AuditRow {
  const existing = rows.get(timestamp);
  if (existing) return existing;

  const row: AuditRow = { timestamp, cells: {} };
  rows.set(timestamp, row);
  return row;
}

function getAuditCellClass(cell?: AuditCell) {
  if (!cell) return "audit-cell";
  return cell.rangeViolation ? "audit-cell audit-cell-range" : "audit-cell";
}

function getAuditCellTitle(cell: AuditCell, metricLabel: string) {
  const details = [`${metricLabel}: ${cell.value}`];
  if (cell.rangeViolation) {
    details.push(
      `range ${cell.rangeViolation.direction} ${cell.rangeViolation.minimum} to ${cell.rangeViolation.maximum}`,
    );
  }
  return details.join(" | ");
}
