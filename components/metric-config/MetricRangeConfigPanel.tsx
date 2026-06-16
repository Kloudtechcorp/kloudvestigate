"use client";

import { useMemo, useState } from "react";
import type { MetricRange, MetricRangeOverrides } from "@/lib/metric-range-config";
import type { MetricKey } from "@/lib/telemetry-types";

type MetricRangeRow = {
  metric: MetricKey;
  label: string;
  unit: string;
  defaultRange: MetricRange;
};

type DraftState = Record<MetricKey, { minimum: string; maximum: string }>;

export function MetricRangeConfigPanel({
  metrics,
  initialOverrides,
}: {
  metrics: MetricRangeRow[];
  initialOverrides: MetricRangeOverrides;
}) {
  const [draft, setDraft] = useState<DraftState>(() => buildDraftState(metrics, initialOverrides));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  const changedCount = useMemo(() => countOverrides(metrics, draft), [draft, metrics]);

  async function saveOverrides() {
    setSaving(true);
    setStatus(null);

    try {
      const overrides = buildOverridesFromDraft(metrics, draft);
      const response = await fetch("/api/metric-range-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });

      if (!response.ok) {
        throw new Error(`Save failed (${response.status})`);
      }

      const payload = (await response.json()) as { overrides: MetricRangeOverrides };
      setDraft(buildDraftState(metrics, payload.overrides));
      setStatus(`Saved ${Object.keys(payload.overrides).length} override(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unknown save error");
    } finally {
      setSaving(false);
    }
  }

  function resetMetric(metric: MetricKey) {
    setDraft((current) => ({
      ...current,
      [metric]: {
        minimum: "",
        maximum: "",
      },
    }));
  }

  function resetAll() {
    setDraft(buildDraftState(metrics, {}));
    setConfirmResetAll(false);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Metric Range Settings</h2>
          <p className="mt-1 text-sm text-text-secondary">Empty override cells use the profile default.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={changedCount ? "status-chip bg-warning-bg text-warning" : "status-chip bg-success-bg text-success"}>{changedCount} edited</span>
          {confirmResetAll ? (
            <>
              <button className="nav-pill text-danger" type="button" onClick={resetAll}>
                Confirm reset?
              </button>
              <button className="nav-pill" type="button" onClick={() => setConfirmResetAll(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="nav-pill text-danger" type="button" onClick={() => setConfirmResetAll(true)}>
              Reset all
            </button>
          )}
          <button className="primary-action" type="button" disabled={saving || changedCount === 0} onClick={() => void saveOverrides()}>
            {saving ? "Saving..." : "Save overrides"}
          </button>
        </div>
      </div>

      {status ? <p className="mt-3 text-sm text-muted-foreground">{status}</p> : null}
      {changedCount ? (
        <div className="sticky top-12 z-20 border border-warning bg-warning-bg px-4 py-2 text-xs text-warning">
          You have {changedCount} unsaved changes. Click Save overrides to apply.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[6px] border border-border bg-bg-surface">
        <table className="ops-table min-w-[760px]">
          <thead>
            <tr>
              <th className="w-[190px]">Metric</th>
              <th className="w-[70px]">Unit</th>
              <th className="w-[120px]">Default Min</th>
              <th className="w-[120px]">Default Max</th>
              <th className="w-[120px]">Min</th>
              <th className="w-[120px]">Max</th>
              <th className="w-[140px]">State</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => {
              const draftRow = draft[metric.metric];
              const minimumValue = draftRow.minimum || String(metric.defaultRange.minimum);
              const maximumValue = draftRow.maximum || String(metric.defaultRange.maximum);
              const isCustom = minimumValue !== String(metric.defaultRange.minimum) || maximumValue !== String(metric.defaultRange.maximum);

              return (
                <tr key={metric.metric}>
                  <td>
                    <div className="grid gap-1">
                      <span className="font-medium text-text-primary">{metric.label}</span>
                      <span className="font-mono text-xs text-text-muted">{metric.metric}</span>
                    </div>
                  </td>
                  <td className="font-mono text-text-muted">{metric.unit}</td>
                  <td className="font-mono text-text-muted">{metric.defaultRange.minimum}</td>
                  <td className="font-mono text-text-muted">{metric.defaultRange.maximum}</td>
                  <td>
                    <input
                      className={`field h-8 w-24 text-right font-mono ${isCustom ? "border-accent" : ""}`}
                      inputMode="decimal"
                      placeholder={String(metric.defaultRange.minimum)}
                      type="number"
                      value={draftRow.minimum}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        [metric.metric]: { ...current[metric.metric], minimum: event.target.value },
                      }))}
                    />
                  </td>
                  <td>
                    <input
                      className={`field h-8 w-24 text-right font-mono ${isCustom ? "border-accent" : ""}`}
                      inputMode="decimal"
                      placeholder={String(metric.defaultRange.maximum)}
                      type="number"
                      value={draftRow.maximum}
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        [metric.metric]: { ...current[metric.metric], maximum: event.target.value },
                      }))}
                    />
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      {isCustom ? <span className="status-chip bg-accent-subtle text-[#7A5F00]">custom</span> : <span className="status-chip">default</span>}
                      {isCustom ? (
                        <button className="text-xs text-text-muted hover:text-danger" type="button" onClick={() => resetMetric(metric.metric)}>
                          reset
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildDraftState(metrics: MetricRangeRow[], overrides: MetricRangeOverrides): DraftState {
  return Object.fromEntries(
    metrics.map((metric) => {
      const range = overrides[metric.metric];
      return [metric.metric, {
        minimum: range ? String(range.minimum) : "",
        maximum: range ? String(range.maximum) : "",
      }];
    }),
  ) as DraftState;
}

function buildOverridesFromDraft(metrics: MetricRangeRow[], draft: DraftState): MetricRangeOverrides {
  const overrides: MetricRangeOverrides = {};

  for (const metric of metrics) {
    const minimumRaw = draft[metric.metric].minimum.trim();
    const maximumRaw = draft[metric.metric].maximum.trim();
    const minimum = Number(minimumRaw);
    const maximum = Number(maximumRaw);

    if (!minimumRaw && !maximumRaw) {
      continue;
    }

    if (!minimumRaw || !maximumRaw) {
      throw new Error(`${metric.label} needs both override cells filled, or both empty.`);
    }

    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
      throw new Error(`${metric.label} needs numeric minimum and maximum values.`);
    }

    if (minimum > maximum) {
      throw new Error(`${metric.label} minimum cannot be greater than maximum.`);
    }

    if (minimum !== metric.defaultRange.minimum || maximum !== metric.defaultRange.maximum) {
      overrides[metric.metric] = { minimum, maximum };
    }
  }

  return overrides;
}

function countOverrides(metrics: MetricRangeRow[], draft: DraftState) {
  return metrics.reduce((count, metric) => {
    const row = draft[metric.metric];
    const minimum = row.minimum.trim();
    const maximum = row.maximum.trim();
    return (minimum || maximum)
      && (minimum !== String(metric.defaultRange.minimum) || maximum !== String(metric.defaultRange.maximum))
      ? count + 1
      : count;
  }, 0);
}
