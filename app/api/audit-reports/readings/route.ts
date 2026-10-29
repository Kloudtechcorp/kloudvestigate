import { assertInternalAccess } from "@/lib/auth";
import { getCachedDailyAudit } from "@/lib/audit-report-cache";
import { getPhilippineDayScope } from "@/lib/daily-station-investigations";
import { getAllTelemetryHistoryFromKloudtrackApi, normalizeAllTelemetry } from "@/lib/kloudtrack-api";
import {
  resolveKloudtrackConfigFromRequest,
  type KloudtrackEnvironmentConfig,
} from "@/lib/kloudtrack-environment";
import { readMetricRangeOverridesFromCookies } from "@/lib/metric-range-config.server";
import { allMetricKeys, getMetricAnalysisProfile } from "@/lib/metric-profiles";
import { createDemoTelemetry } from "@/lib/mock-telemetry";
import { analyzeTelemetry, defaultWarningLevels } from "@/lib/telemetry-analysis";
import type { MetricKey, StationMetadata, TelemetryRecord } from "@/lib/telemetry-types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const validIntervals = [15, 30, 60, 360, 720];

type DayScope = NonNullable<ReturnType<typeof getPhilippineDayScope>>;

type ReadingRow = {
  timestamp: string;
  values: Partial<Record<MetricKey, number>>;
  flags: Partial<Record<MetricKey, string[]>>;
  auditViolations: Partial<Record<MetricKey, number>>;
};

export async function GET(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const stationId = params.get("stationId")?.trim();
  const scope = getPhilippineDayScope(params.get("date") ?? "");
  const intervalMinutes = Number(params.get("interval") ?? 60);

  if (!stationId) {
    return Response.json({ error: "Invalid station", message: "Provide a stationId." }, { status: 400 });
  }
  if (!scope) {
    return Response.json({ error: "Invalid date", message: "Date must use YYYY-MM-DD format." }, { status: 400 });
  }
  if (!validIntervals.includes(intervalMinutes)) {
    return Response.json(
      { error: "Invalid interval", message: `Interval must be one of ${validIntervals.join(", ")} minutes.` },
      { status: 400 },
    );
  }

  try {
    const metricRangeOverrides = await readMetricRangeOverridesFromCookies();
    const kloudtrackConfig = resolveKloudtrackConfigFromRequest(request);
    const useDemoData = !kloudtrackConfig.apiToken;
    let auditError: string | null = null;
    const [source, auditSummary] = await Promise.all([
      loadDayTelemetry(stationId, scope, intervalMinutes, useDemoData, kloudtrackConfig, request.signal),
      // Readings stay useful without audit storage; the dialog warns that audit marks are missing.
      getCachedDailyAudit(scope.dateKey, stationId, true)
        .then((audit) => audit.summaries[0] ?? null)
        .catch((error: unknown) => {
          auditError = error instanceof Error ? error.message : "Unknown audit lookup error";
          return null;
        }),
    ]);
    const auditLogs = auditSummary?.auditLogs ?? [];
    const recordedRangeViolations = auditSummary?.rangeViolationCount ?? 0;

    const startMs = Date.parse(scope.start);
    const endMs = Math.min(Date.parse(scope.end), Date.now());
    const intervalMs = intervalMinutes * 60_000;
    const rows: ReadingRow[] = [];
    for (let time = startMs; time < endMs; time += intervalMs) {
      rows.push({ timestamp: new Date(time).toISOString(), values: {}, flags: {}, auditViolations: {} });
    }
    const rowIndexFor = (timestamp: string) => {
      const index = Math.floor((Date.parse(timestamp) - startMs) / intervalMs);
      return index >= 0 && index < rows.length ? index : null;
    };

    const metrics = new Set<MetricKey>();
    for (const item of source.series) {
      const records = aggregateDayRecords(item.records, startMs, Date.parse(scope.end), intervalMs);
      if (!records.length) continue;

      metrics.add(item.metric);
      const analysis = analyzeTelemetry(records, defaultWarningLevels, {
        start: scope.start,
        end: scope.end,
        aggregationMinutes: intervalMinutes,
        expectedIntervalMinutes: intervalMinutes,
        metricProfile: getMetricAnalysisProfile(item.metric, metricRangeOverrides),
      });
      const flagEvents = [
        ...analysis.rangeViolations.map((event) => ({ timestamp: event.timestamp, flag: "out of range" })),
        ...analysis.spikes.map((event) => ({ timestamp: event.timestamp, flag: "jump" })),
        ...analysis.thresholdCrossings.map((event) => ({ timestamp: event.timestamp, flag: "warning level" })),
      ];

      for (const record of records) {
        const index = rowIndexFor(record.timestamp);
        if (index !== null) rows[index].values[item.metric] = record.value;
      }
      for (const { timestamp, flag } of flagEvents) {
        const index = rowIndexFor(timestamp);
        if (index === null) continue;
        const flags = rows[index].flags[item.metric] ??= [];
        if (!flags.includes(flag)) flags.push(flag);
      }
    }

    // The audit checks one-minute data, so count its saved violations per slot;
    // slot averages alone can hide a single out-of-range minute.
    for (const log of auditLogs) {
      if (log.type !== "rangeViolation") continue;
      const contents = readViolationContents(log.rowContents);
      const index = contents ? rowIndexFor(contents.timestamp) : null;
      if (!contents || index === null) continue;

      const violations = rows[index].auditViolations;
      violations[contents.metric] = (violations[contents.metric] ?? 0) + 1;
      metrics.add(contents.metric);
    }

    return Response.json({
      date: scope.dateKey,
      intervalMinutes,
      station: source.station,
      source: useDemoData ? "demo" : "kloudtrack",
      metrics: allMetricKeys.filter((metric) => metrics.has(metric)),
      auditError,
      // Retention keeps per-minute logs only for the current month; older days keep just the count.
      auditLogsExpired: recordedRangeViolations > 0 && !auditLogs.some((log) => log.type === "rangeViolation"),
      recordedRangeViolations,
      rows,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Station readings failed",
        message: error instanceof Error ? error.message : "Unknown station readings error",
      },
      { status: 500 },
    );
  }
}

async function loadDayTelemetry(
  stationId: string,
  scope: DayScope,
  intervalMinutes: number,
  useDemoData: boolean,
  kloudtrackConfig: KloudtrackEnvironmentConfig,
  signal: AbortSignal,
): Promise<{ station: StationMetadata; series: Array<{ metric: MetricKey; records: TelemetryRecord[] }> }> {
  if (useDemoData) {
    const demoSeries = allMetricKeys.map((metric) => ({
      metric,
      ...createDemoTelemetry(stationId, metric, scope.start, scope.end),
    }));
    return {
      station: demoSeries[0].station,
      series: demoSeries.map(({ metric, records }) => ({ metric, records })),
    };
  }

  const raw = await getAllTelemetryHistoryFromKloudtrackApi(stationId, {
    skip: "0",
    interval: intervalMinutes.toString(),
    startDate: scope.start,
    endDate: scope.end,
  }, kloudtrackConfig, signal);
  return normalizeAllTelemetry(raw);
}

function aggregateDayRecords(
  records: TelemetryRecord[],
  startMs: number,
  endMs: number,
  intervalMs: number,
): TelemetryRecord[] {
  const buckets = new Map<number, number[]>();

  for (const record of records) {
    const time = Date.parse(record.timestamp);
    if (Number.isNaN(time) || time < startMs || time >= endMs) continue;

    const bucketStart = startMs + Math.floor((time - startMs) / intervalMs) * intervalMs;
    const values = buckets.get(bucketStart) ?? [];
    values.push(record.value);
    buckets.set(bucketStart, values);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketStart, values]) => ({
      timestamp: new Date(bucketStart).toISOString(),
      value: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
    }));
}

function readViolationContents(value: unknown): { metric: MetricKey; timestamp: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.timestamp !== "string" || !allMetricKeys.includes(row.metric as MetricKey)) return null;
  return { metric: row.metric as MetricKey, timestamp: row.timestamp };
}
