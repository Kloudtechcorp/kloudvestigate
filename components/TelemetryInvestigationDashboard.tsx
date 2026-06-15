"use client";

import { useEffect, useState } from "react";
import { PageShell } from "./layout/PageShell";
import type { InvestigationMetricKey, StationMetadata } from "@/lib/telemetry-types";
import { CopilotPanel } from "./telemetry/CopilotPanel";
import { EventsPanel } from "./telemetry/EventsPanel";
import { FetchedValuesTable } from "./telemetry/FetchedValuesTable";
import { InvestigationScopePanel } from "./telemetry/InvestigationScopePanel";
import { OutlierOverview } from "./telemetry/OutlierOverview";
import { SummaryStats } from "./telemetry/SummaryStats";
import { TelemetryTimeline } from "./telemetry/TelemetryTimeline";
import { metrics, questions } from "./telemetry/constants";
import type { InvestigationBatchCacheResponse, InvestigationResponse, StationsResponse } from "./telemetry/types";
import { phtDayBoundaryToUtcISOString, philippineInputToUtcISOString, toInputValue } from "./telemetry/utils";
import { useInvestigationQuickActionStore } from "./telemetry/useInvestigationQuickActionStore";

const QUICK_ACTION_REQUEST_GAP_MS = 350;
const QUICK_ACTION_REQUEST_TIMEOUT_MS = 300_000;

export function TelemetryInvestigationDashboard() {
  const [stationId, setStationId] = useState("station-001");
  const [stations, setStations] = useState<StationMetadata[]>([]);
  const [stationSource, setStationSource] = useState<"demo" | "kloudtrack">("demo");
  const [metric, setMetric] = useState<InvestigationMetricKey>("all");
  const [aggregationMinutes, setAggregationMinutes] = useState(60);
  const [start, setStart] = useState(() => {
    const date = new Date();

    date.setDate(date.getDate() - 1);
    date.setHours(0, 0, 0, 0);

    return toInputValue(date);
  });

  const [end, setEnd] = useState(() => {
    const date = new Date();

    date.setHours(12, 0, 0, 0);

    return toInputValue(date);
  });
  const [question, setQuestion] = useState(questions[0]);
  const [data, setData] = useState<InvestigationResponse | null>(null);
  const [manualDataStationId, setManualDataStationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchCustomScopeEnabled, setBatchCustomScopeEnabled] = useState(false);
  const [batchStart, setBatchStart] = useState(() => buildYesterdayFullDayInputRange().start);
  const [batchEnd, setBatchEnd] = useState(() => buildYesterdayFullDayInputRange().end);
  const [batchAggregationMinutes, setBatchAggregationMinutes] = useState(1);
  const [batchStationIds, setBatchStationIds] = useState<string[] | null>(null);
  const quickActionStatus = useInvestigationQuickActionStore((state) => state.status);
  const quickActionCompletedStations = useInvestigationQuickActionStore((state) => state.completedStations);
  const quickActionTotalStations = useInvestigationQuickActionStore((state) => state.totalStations);
  const quickActionResultsByStationId = useInvestigationQuickActionStore((state) => state.resultsByStationId);
  const quickActionError = useInvestigationQuickActionStore((state) => state.error);
  const beginQuickAction = useInvestigationQuickActionStore((state) => state.start);
  const setQuickActionStation = useInvestigationQuickActionStore((state) => state.setActiveStation);
  const setQuickActionResult = useInvestigationQuickActionStore((state) => state.setStationResult);
  const hydrateSavedQuickActionResults = useInvestigationQuickActionStore((state) => state.hydrateSavedResults);
  const completeQuickAction = useInvestigationQuickActionStore((state) => state.complete);
  const resetQuickAction = useInvestigationQuickActionStore((state) => state.reset);

  const quickActionRunning = quickActionStatus === "running";
  const quickActionData = quickActionStatus !== "idle" ? quickActionResultsByStationId[stationId] ?? null : null;
  const displayedData = quickActionData ?? (manualDataStationId === stationId ? data : null);
  const sourceLabel =
    displayedData?.source === "kloudtrack" || stationSource === "kloudtrack"
      ? "KloudTrack API"
      : "Demo fallback";

  async function loadSavedBatchInvestigations(nextStations: StationMetadata[]) {
    if (!nextStations.length) return;

    const { start, end } = buildYesterdayFullDayRange();
    const params = new URLSearchParams({
      stationIds: nextStations.map((station) => station.id).join(","),
      metric: "all",
      aggregationMinutes: "1",
      start,
      end,
    });

    try {
      const response = await fetch(`/api/investigations?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) return;

      const payload = (await response.json()) as InvestigationBatchCacheResponse;
      if (Object.keys(payload.resultsByStationId).length > 0) {
        hydrateSavedQuickActionResults(nextStations.length, payload.resultsByStationId);
      }
    } catch {
      // Saved batch data is a convenience; investigation still works without it.
    }
  }

  useEffect(() => {
    async function loadStations() {
      try {
        const response = await fetch("/api/stations", { cache: "no-store" });
        if (!response.ok) throw new Error(`Station list request failed (${response.status})`);
        const payload = (await response.json()) as StationsResponse;
        setStations(payload.stations);
        setBatchStationIds((current) => reconcileSelectedStationIds(current, payload.stations));
        setStationSource(payload.source);
        const firstStationId = payload.stations[0]?.id ?? stationId;
        if (firstStationId !== stationId) setStationId(firstStationId);
        void loadSavedBatchInvestigations(payload.stations);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unknown station list error");
      }
    }

    void loadStations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runInvestigation({
    askCopilot = false,
    nextQuestion = question,
    selectedStationId = stationId,
  }: {
    askCopilot?: boolean;
    nextQuestion?: string;
    selectedStationId?: string;
  } = {}) {
    if (quickActionRunning) return;

    resetQuickAction();
    setLoading(true);
    setError(null);
    setData(null);
    setManualDataStationId(selectedStationId);

    try {
      const response = await fetch("/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stationId: selectedStationId,
          metric,
          aggregationMinutes,
          start: philippineInputToUtcISOString(start),
          end: philippineInputToUtcISOString(end),
          question: nextQuestion,
          askCopilot,
          useDemoData: false,
        }),
      });

      if (!response.ok) throw new Error(`Investigation request failed (${response.status})`);
      setData((await response.json()) as InvestigationResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unknown request error");
    } finally {
      setLoading(false);
    }
  }

  async function runInvestigateEveryStation() {
    const selectedBatchStationIds = batchStationIds ?? stations.map((station) => station.id);
    const selectedBatchStations = stations.filter((station) => selectedBatchStationIds.includes(station.id));
    if (quickActionRunning || loading || !selectedBatchStations.length) return;

    const populatedResults = quickActionResultsByStationId;
    const hasPopulatedResults = !batchCustomScopeEnabled
      && selectedBatchStations.some((station) => populatedResults[station.id]);
    const skipPopulatedStations = hasPopulatedResults
      ? window.confirm("There is already populated investigation data. Skip stations that already have data?")
      : false;
    const initialResults = skipPopulatedStations
      ? Object.fromEntries(
        selectedBatchStations
          .filter((station) => populatedResults[station.id])
          .map((station) => [station.id, populatedResults[station.id]]),
      )
      : {};

    setError(null);
    if (!skipPopulatedStations) resetQuickAction();
    setManualDataStationId(null);
    setData(null);
    beginQuickAction(selectedBatchStations.length, initialResults);

    const batchScope = buildBatchInvestigationScope({
      customScopeEnabled: batchCustomScopeEnabled,
      customStart: batchStart,
      customEnd: batchEnd,
      customAggregationMinutes: batchAggregationMinutes,
    });

    for (const [index, station] of selectedBatchStations.entries()) {
      setQuickActionStation(station.id, index);
      setStationId(station.id);

      const existingResult = initialResults[station.id];
      if (existingResult) {
        setData(existingResult);
        setQuickActionStation(station.id, index + 1);
        continue;
      }

      try {
        const response = await fetchWithTimeout(
          "/api/investigations",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stationId: station.id,
              metric: "all",
              aggregationMinutes: batchScope.aggregationMinutes,
              start: batchScope.start,
              end: batchScope.end,
              question: batchScope.question,
              askCopilot: false,
              useDemoData: false,
            }),
          },
          QUICK_ACTION_REQUEST_TIMEOUT_MS,
        );

        if (!response.ok) {
          throw new Error(`Investigation request failed (${response.status})`);
        }

        const payload = (await response.json()) as InvestigationResponse;
        setQuickActionResult(station.id, payload);
        setQuickActionStation(station.id, index + 1);
        setData(payload);
      } catch {
        setQuickActionStation(station.id, index + 1);
      }

      if (index < selectedBatchStations.length - 1) {
        await wait(QUICK_ACTION_REQUEST_GAP_MS);
      }
    }

    completeQuickAction();
  }

  return (
    <PageShell
      eyebrow="Internal telemetry intelligence"
      title="Telemetry Investigation Copilot"
    >
      <main className="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <InvestigationScopePanel
          stations={stations}
          stationId={stationId}
          metric={metric}
          metrics={metrics}
          start={start}
          end={end}
          aggregationMinutes={aggregationMinutes}
          onStationChange={setStationId}
          onMetricChange={setMetric}
          onStartChange={setStart}
          onEndChange={setEnd}
          onAggregationChange={setAggregationMinutes}
          onRunInvestigation={() => void runInvestigation()}
          runInvestigationBusy={loading}
          runInvestigationDisabled={quickActionRunning}
          onQuickInvestigateEveryStation={() => void runInvestigateEveryStation()}
          quickActionBusy={quickActionRunning}
          quickActionProgress={`${quickActionCompletedStations}/${quickActionTotalStations}`}
          quickActionResultsByStationId={quickActionStatus !== "idle" ? quickActionResultsByStationId : undefined}
          batchCustomScopeEnabled={batchCustomScopeEnabled}
          batchStart={batchStart}
          batchEnd={batchEnd}
          batchAggregationMinutes={batchAggregationMinutes}
          batchStationIds={batchStationIds}
          onBatchStationIdsChange={setBatchStationIds}
          onBatchCustomScopeEnabledChange={setBatchCustomScopeEnabled}
          onBatchStartChange={setBatchStart}
          onBatchEndChange={setBatchEnd}
          onBatchAggregationChange={setBatchAggregationMinutes}
        />

        <section className="grid min-w-0 gap-4">
          <div className="panel flex min-w-0 flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-label">
                  Investigation workspace
                </p>
                <h2 className="mt-1 text-xl font-semibold text-heading">Evidence first, assistance on demand</h2>
              </div>
              <span className="status-chip">{sourceLabel}</span>
            </div>
            {error ? <div className="panel border-danger-strong text-danger-foreground-muted">{error}</div> : null}
            {quickActionError ? <div className="panel border-danger-strong text-danger-foreground-muted">{quickActionError}</div> : null}
            <SummaryStats
              analysis={displayedData?.analysis}
              metricAnalyses={displayedData?.metricAnalyses}
            />
            <OutlierOverview analysis={displayedData?.analysis} metricAnalyses={displayedData?.metricAnalyses} />
            <TelemetryTimeline
              analysis={displayedData?.analysis}
              metricAnalyses={displayedData?.metricAnalyses}
              aggregationMinutes={displayedData?.selection.aggregationMinutes}
              sourceLabel={sourceLabel}
            />
            <EventsPanel analysis={displayedData?.analysis} metricAnalyses={displayedData?.metricAnalyses} />
            <FetchedValuesTable
              analysis={displayedData?.analysis}
              records={displayedData?.records ?? []}
              metricAnalyses={displayedData?.metricAnalyses}
            />
          </div>
        </section>
      </main>

      <CopilotPanel
        question={question}
        metric={metric}
        data={displayedData}
        loading={loading}
        onQuestionChange={setQuestion}
        onRun={() => void runInvestigation({ askCopilot: true })}
      />
    </PageShell>
  );
}

function buildYesterdayFullDayRange() {
  return {
    start: phtDayBoundaryToUtcISOString(-1),
    end: phtDayBoundaryToUtcISOString(0),
  };
}

function buildYesterdayFullDayInputRange() {
  return {
    start: toInputValue(new Date(phtDayBoundaryToUtcISOString(-1))),
    end: toInputValue(new Date(phtDayBoundaryToUtcISOString(0))),
  };
}

function reconcileSelectedStationIds(current: string[] | null, stations: StationMetadata[]) {
  const stationIds = stations.map((station) => station.id);
  if (!current) return stationIds;

  const stationIdSet = new Set(stationIds);
  const next = current.filter((stationId) => stationIdSet.has(stationId));

  return next;
}

function buildBatchInvestigationScope({
  customScopeEnabled,
  customStart,
  customEnd,
  customAggregationMinutes,
}: {
  customScopeEnabled: boolean;
  customStart: string;
  customEnd: string;
  customAggregationMinutes: number;
}) {
  if (!customScopeEnabled) {
    return {
      ...buildYesterdayFullDayRange(),
      aggregationMinutes: 1,
      question: "Summarize every metric for yesterday's full day.",
    };
  }

  return {
    start: philippineInputToUtcISOString(customStart),
    end: philippineInputToUtcISOString(customEnd),
    aggregationMinutes: customAggregationMinutes,
    question: "Summarize every metric for the selected custom batch range.",
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
