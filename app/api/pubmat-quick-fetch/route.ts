import { assertInternalAccess } from "@/lib/auth";
import {
  getAllTelemetryHistoryFromKloudtrackApi,
  getDashboardDataFromKloudtrackApi,
  getTelemetryMetricHistoryFromKloudtrackApi,
  normalizeAllTelemetry,
  normalizeDashboardStations,
  normalizeTelemetry,
} from "@/lib/kloudtrack-api";
import {
  resolveKloudtrackConfigFromRequest,
  type KloudtrackEnvironmentConfig,
} from "@/lib/kloudtrack-environment";
import { readMetricRangeOverridesFromCookies } from "@/lib/metric-range-config.server";
import { allMetricKeys, getMetricAnalysisProfile } from "@/lib/metric-profiles";
import { createDemoTelemetry, demoStations } from "@/lib/mock-telemetry";
import { analyzeTelemetry, defaultWarningLevels } from "@/lib/telemetry-analysis";
import type {
  InvestigationMetricKey,
  MetricKey,
  StationMetadata,
  TelemetryAnalysis,
  TelemetryRecord,
} from "@/lib/telemetry-types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type QuickFetchStatus = "ready" | "attention" | "missing" | "failed";

interface PubmatQuickFetchBody {
  metric?: InvestigationMetricKey;
  timestamp?: string;
  intervalMinutes?: number;
  requestGapMs?: number;
  useDemoData?: boolean;
}

interface BucketWindow {
  bucketStart: string;
  bucketEnd: string;
  fetchStart: string;
  fetchEnd: string;
}

const validMetrics: InvestigationMetricKey[] = ["all", ...allMetricKeys];

export async function POST(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  try {
    const metricRangeOverrides = await readMetricRangeOverridesFromCookies();
    const kloudtrackConfig = resolveKloudtrackConfigFromRequest(request);
    const body = (await request.json()) as PubmatQuickFetchBody;
    const metric = body.metric && validMetrics.includes(body.metric) ? body.metric : "precipitation";
    const intervalMinutes = clampInterval(body.intervalMinutes);
    const requestGapMs = Math.max(body.requestGapMs ?? 600, 350);
    const useDemoData = body.useDemoData || !kloudtrackConfig.apiToken;
    const window = buildBucketWindow(body.timestamp, intervalMinutes);
    const selectedMetricKeys = metric === "all" ? allMetricKeys : [metric];
    const stations = await loadStations(useDemoData, kloudtrackConfig);
    const results = [];

    for (const [index, station] of stations.entries()) {
      if (request.signal.aborted) break;

      results.push(await fetchStationBucket(
        station,
        metric,
        selectedMetricKeys,
        window,
        useDemoData,
        kloudtrackConfig,
        metricRangeOverrides,
      ));

      if (index < stations.length - 1 && !request.signal.aborted) {
        await sleep(requestGapMs);
      }
    }

    return Response.json({
      selection: {
        metric,
        intervalMinutes,
        requestGapMs,
        selectedMetricKeys,
        timestamp: window.bucketEnd,
      },
      window,
      source: useDemoData ? "demo" : "kloudtrack",
      environment: kloudtrackConfig.environment,
      stationCount: stations.length,
      results,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Pubmat quick fetch failed",
        message: error instanceof Error ? error.message : "Unknown request error",
      },
      { status: 400 },
    );
  }
}

async function loadStations(
  useDemoData: boolean,
  kloudtrackConfig: KloudtrackEnvironmentConfig,
): Promise<StationMetadata[]> {
  if (useDemoData) return demoStations;

  const dashboard = await getDashboardDataFromKloudtrackApi(kloudtrackConfig);
  return normalizeDashboardStations(dashboard);
}

async function fetchStationBucket(
  station: StationMetadata,
  metric: InvestigationMetricKey,
  selectedMetricKeys: MetricKey[],
  window: BucketWindow,
  useDemoData: boolean,
  kloudtrackConfig: KloudtrackEnvironmentConfig,
  metricRangeOverrides: Record<string, { minimum: number; maximum: number }>,
) {
  try {
    const source = await loadTelemetryForStation(station, metric, window, useDemoData, kloudtrackConfig);
    const values: Partial<Record<MetricKey, number>> = {};
    const classifications = new Set<string>();

    for (const key of selectedMetricKeys) {
      const item = source.series.find((series) => series.metric === key);
      if (!item) continue;

      const record = item.records.find((candidate) => candidate.timestamp === window.bucketStart);
      const analysis = analyzeTelemetry(item.records, defaultWarningLevels, {
        start: window.fetchStart,
        end: window.fetchEnd,
        aggregationMinutes: minutesBetween(window.bucketStart, window.bucketEnd),
        expectedIntervalMinutes: minutesBetween(window.bucketStart, window.bucketEnd),
        metricProfile: getMetricAnalysisProfile(key, metricRangeOverrides),
      });

      if (record) values[key] = record.value;
      classifyMetric(analysis, window.bucketStart).forEach((label) => classifications.add(label));
    }

    const hasAnyValue = Object.values(values).some((value) => value !== undefined);
    const classList = [...classifications];

    return {
      station: source.station,
      status: (!hasAnyValue ? "missing" : classList.length ? "attention" : "ready") satisfies QuickFetchStatus,
      values,
      classifications: !hasAnyValue ? ["no target bucket returned"] : classList,
    };
  } catch (error) {
    return {
      station,
      status: "failed" satisfies QuickFetchStatus,
      values: {},
      classifications: [],
      error: error instanceof Error ? error.message : "Unknown station fetch error",
    };
  }
}

async function loadTelemetryForStation(
  station: StationMetadata,
  metric: InvestigationMetricKey,
  window: BucketWindow,
  useDemoData: boolean,
  kloudtrackConfig: KloudtrackEnvironmentConfig,
): Promise<{ station: StationMetadata; series: Array<{ metric: MetricKey; records: TelemetryRecord[] }> }> {
  if (metric === "all") return loadAllTelemetryForStation(station, window, useDemoData, kloudtrackConfig);

  if (useDemoData) {
    const demo = createDemoTelemetry(station.id, metric, window.fetchStart, window.fetchEnd);
    return {
      station: demo.station,
      series: [{
        metric,
        records: aggregateDemoTelemetryRecords(
          demo.records,
          window.fetchStart,
          minutesBetween(window.bucketStart, window.bucketEnd),
        ),
      }],
    };
  }

  const raw = await getTelemetryMetricHistoryFromKloudtrackApi(station.id, metric, {
    skip: "0",
    interval: minutesBetween(window.bucketStart, window.bucketEnd).toString(),
    startDate: window.fetchStart,
    endDate: window.fetchEnd,
  }, kloudtrackConfig);
  const normalized = normalizeTelemetry(raw);

  return {
    station: normalized.station,
    series: [{ metric, records: normalized.records }],
  };
}

async function loadAllTelemetryForStation(
  station: StationMetadata,
  window: BucketWindow,
  useDemoData: boolean,
  kloudtrackConfig: KloudtrackEnvironmentConfig,
) {
  if (useDemoData) {
    const demoSeries = allMetricKeys.map((metric) => {
      const demo = createDemoTelemetry(station.id, metric, window.fetchStart, window.fetchEnd);
      return {
        metric,
        records: aggregateDemoTelemetryRecords(
          demo.records,
          window.fetchStart,
          minutesBetween(window.bucketStart, window.bucketEnd),
        ),
        station: demo.station,
      };
    });

    return {
      station: demoSeries[0].station,
      series: demoSeries.map(({ metric, records }) => ({ metric, records })),
    };
  }

  const raw = await getAllTelemetryHistoryFromKloudtrackApi(station.id, {
    skip: "0",
    interval: minutesBetween(window.bucketStart, window.bucketEnd).toString(),
    startDate: window.fetchStart,
    endDate: window.fetchEnd,
  }, kloudtrackConfig);

  return normalizeAllTelemetry(raw);
}

function classifyMetric(analysis: TelemetryAnalysis, timestamp: string) {
  const labels: string[] = [];
  if (analysis.rangeViolations.some((item) => item.timestamp === timestamp)) labels.push("out of range");
  if (analysis.spikes.some((item) => item.timestamp === timestamp)) labels.push("jump");
  if (analysis.thresholdCrossings.some((item) => item.timestamp === timestamp)) labels.push("warning level");
  return labels;
}

function aggregateDemoTelemetryRecords(
  records: TelemetryRecord[],
  start: string,
  aggregationMinutes: number,
): TelemetryRecord[] {
  const startMs = Date.parse(start);
  const bucketMs = aggregationMinutes * 60_000;
  const buckets = new Map<number, TelemetryRecord[]>();

  for (const record of records) {
    const time = Date.parse(record.timestamp);
    if (Number.isNaN(time)) continue;

    const bucketStart = startMs + Math.floor((time - startMs) / bucketMs) * bucketMs;
    const bucketRecords = buckets.get(bucketStart) ?? [];
    bucketRecords.push(record);
    buckets.set(bucketStart, bucketRecords);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketStart, bucketRecords]) => ({
      id: bucketRecords.at(-1)?.id,
      timestamp: new Date(bucketStart).toISOString(),
      value: Number(
        (
          bucketRecords.reduce((sum, record) => sum + record.value, 0) / bucketRecords.length
        ).toFixed(2),
      ),
    }));
}

function buildBucketWindow(timestampInput: string | undefined, intervalMinutes: number): BucketWindow {
  const bucketEndMs = Date.parse(timestampInput ? philippineInputToUtcISOString(timestampInput) : new Date().toISOString());
  if (Number.isNaN(bucketEndMs)) throw new Error("Invalid pubmat timestamp.");

  const intervalMs = intervalMinutes * 60_000;
  const bucketStartMs = bucketEndMs - intervalMs;

  return {
    bucketStart: new Date(bucketStartMs).toISOString(),
    bucketEnd: new Date(bucketEndMs).toISOString(),
    fetchStart: new Date(bucketStartMs - intervalMs).toISOString(),
    fetchEnd: new Date(bucketEndMs + intervalMs).toISOString(),
  };
}

function philippineInputToUtcISOString(value: string) {
  const inputWithSeconds = value.length === 16 ? `${value}:00` : value;
  return new Date(`${inputWithSeconds}+08:00`).toISOString();
}

function clampInterval(value: number | undefined) {
  const interval = Number(value ?? 60);
  return Number.isFinite(interval) && interval > 0 ? interval : 60;
}

function minutesBetween(start: string, end: string) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
