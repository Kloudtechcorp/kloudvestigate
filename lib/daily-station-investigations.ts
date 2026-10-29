import { Prisma, type DailyStationSummary } from "@/app/generated/prisma/client";
import type { InvestigationResponse, StationsResponse } from "@/components/telemetry/types";
import { getPrisma } from "@/lib/prisma";
import { invalidateAuditReportDate } from "@/lib/audit-report-cache";
import { isAuditLogRetained } from "@/lib/audit-retention";
import type { StationMetadata } from "@/lib/telemetry-types";

const PHT_OFFSET_MS = 8 * 60 * 60_000;
const MINUTES_PER_DAY = 24 * 60;
const REQUEST_GAP_MS = 600;
const REPORT_TRANSACTION_MAX_WAIT_MS = 10_000;
const REPORT_TRANSACTION_TIMEOUT_MS = 30_000;

/** KloudTrack kept rate-limiting after its retries; callers should stop and resume later. */
export class AuditRateLimitError extends Error {
  constructor(message = "KloudTrack is rate-limiting requests. Try again later.") {
    super(message);
    this.name = "AuditRateLimitError";
  }
}

type DayScope = NonNullable<ReturnType<typeof getPhilippineDayScope>>;

type ReportData = {
  summary: {
    stationId: string;
    stationName: string;
    summaryDate: Date;
    missingCount: number;
    rangeViolationCount: number;
    rangeViolationSummary: Prisma.InputJsonObject;
  };
  auditLogs: Array<{
    type: "rangeViolation" | "missing";
    eventDate: Date;
    rowContents?: Prisma.InputJsonObject;
  }>;
};

type RunDailyStationInvestigationsOptions = {
  requestUrl: string;
  dateKey: string;
  stationId?: string;
  replaceExisting: boolean;
  onInit?: (event: { stationCount: number }) => void | Promise<void>;
  onStationStart?: (event: StationProgressEvent) => void | Promise<void>;
  onStationComplete?: (event: StationProgressEvent & { status: string }) => void | Promise<void>;
};

type StationProgressEvent = {
  stationId: string;
  stationName: string;
  completedCount: number;
  stationCount: number;
};

export async function runDailyStationInvestigations({
  requestUrl,
  dateKey,
  stationId,
  replaceExisting,
  onInit,
  onStationStart,
  onStationComplete,
}: RunDailyStationInvestigationsOptions) {
  const scope = getPhilippineDayScope(dateKey);
  if (!scope) throw new Error("Date must use YYYY-MM-DD format.");
  // Fail before fetching telemetry when audit persistence is unavailable.
  getPrisma();

  const requestHeaders = buildInternalRequestHeaders();
  const stationsResponse = await fetch(new URL("/api/stations", requestUrl), {
    headers: requestHeaders,
    cache: "no-store",
  });
  if (!stationsResponse.ok) {
    const failure = await readErrorPayload(stationsResponse);
    if (failure.code === "rate_limited") throw new AuditRateLimitError(failure.message);
    throw new Error(`Station lookup failed (${stationsResponse.status}).`);
  }

  const stationPayload = await readJsonResponse<StationsResponse>(
    stationsResponse,
    "Station lookup",
  );
  const stations = stationId
    ? stationPayload.stations.filter((station) => station.id === stationId)
    : stationPayload.stations;
  if (stationId && stations.length === 0) throw new Error(`Station ${stationId} was not found.`);
  await onInit?.({ stationCount: stations.length });

  const reports = [];
  let rateLimited = false;
  for (const [index, station] of stations.entries()) {
    await onStationStart?.({
      stationId: station.id,
      stationName: station.name,
      completedCount: index,
      stationCount: stations.length,
    });

    if (!replaceExisting) {
      const existing = await loadStoredReport(station.id, scope.summaryDate);
      if (existing) {
        const result = { stationId: station.id, status: "stored", report: existing };
        reports.push(result);
        await onStationComplete?.({
          stationId: station.id,
          stationName: station.name,
          completedCount: index + 1,
          stationCount: stations.length,
          status: result.status,
        });
        continue;
      }
    }

    try {
      reports.push(await auditStation(station, scope, requestUrl, requestHeaders, replaceExisting));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown station investigation error";
      console.error(
        `Daily investigation failed for station ${station.id} (${station.name}) on ${dateKey}.`,
        error,
      );
      reports.push({ stationId: station.id, status: "failed", message });
      rateLimited = error instanceof AuditRateLimitError;
    }

    await onStationComplete?.({
      stationId: station.id,
      stationName: station.name,
      completedCount: index + 1,
      stationCount: stations.length,
      status: reports.at(-1)?.status ?? "failed",
    });

    // Retrying the remaining stations would only extend the rate limit.
    if (rateLimited) break;
    if (index < stations.length - 1) await wait(REQUEST_GAP_MS);
  }

  return {
    reportDate: scope.dateKey,
    timezone: "Asia/Manila",
    stationCount: stations.length,
    rateLimited,
    reports,
  };
}

export function getPreviousPhilippineDateKey(now = new Date()) {
  const phtNow = new Date(now.getTime() + PHT_OFFSET_MS);
  const todayStartUtc = Date.UTC(
    phtNow.getUTCFullYear(),
    phtNow.getUTCMonth(),
    phtNow.getUTCDate(),
  ) - PHT_OFFSET_MS;
  return new Date(todayStartUtc - 24 * 60 * 60_000 + PHT_OFFSET_MS).toISOString().slice(0, 10);
}

export function getPhilippineDayScope(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const summaryDate = new Date(Date.UTC(year, month - 1, day));
  if (summaryDate.toISOString().slice(0, 10) !== dateKey) return null;

  const startMs = summaryDate.getTime() - PHT_OFFSET_MS;
  return {
    dateKey,
    summaryDate,
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 24 * 60 * 60_000).toISOString(),
  };
}

async function auditStation(
  station: StationMetadata,
  scope: DayScope,
  requestUrl: string,
  requestHeaders: Record<string, string>,
  replaceExisting: boolean,
) {
  const investigationResponse = await fetch(new URL("/api/investigations", requestUrl), {
    method: "POST",
    headers: { ...requestHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      stationId: station.id,
      metric: "all",
      aggregationMinutes: 1,
      start: scope.start,
      end: scope.end,
      useDemoData: false,
      bypassCache: true,
    }),
    cache: "no-store",
  });

  if (!investigationResponse.ok) {
    const failure = await readErrorPayload(investigationResponse);
    if (failure.code === "rate_limited") throw new AuditRateLimitError(failure.message);
    if (failure.code !== "no_telemetry") {
      throw new Error(
        `Investigation request failed (${investigationResponse.status})${failure.message ? `: ${failure.message}` : "."}`,
      );
    }

    // A station that sent nothing is only an audit finding once it existed for the whole day.
    if (!await stationExistedBefore(station, scope)) {
      return { stationId: station.id, status: "not_created" };
    }
    const report = await saveReport(buildNoDataReport(station, scope), replaceExisting);
    return { stationId: station.id, status: "no_data", report };
  }

  const investigation = await readJsonResponse<InvestigationResponse>(
    investigationResponse,
    "Investigation request",
  );
  const report = await saveReport(buildInvestigationReport(investigation, scope.summaryDate), replaceExisting);
  return { stationId: station.id, status: replaceExisting ? "replaced" : "created", report };
}

async function stationExistedBefore(station: StationMetadata, scope: DayScope) {
  const activatedAt = station.activatedAt ? Date.parse(station.activatedAt) : Number.NaN;
  if (!Number.isNaN(activatedAt) && toPhilippineDateKey(activatedAt) < scope.dateKey) return true;

  // KloudTrack resets activatedAt when a station is reactivated, so an earlier saved report
  // also proves the station existed. Backfills therefore rebuild the oldest day first.
  const earlierReport = await getPrisma().dailyStationSummary.findFirst({
    where: { stationId: station.id, summaryDate: { lt: scope.summaryDate } },
    select: { id: true },
  });
  return Boolean(earlierReport);
}

function buildNoDataReport(station: StationMetadata, scope: DayScope): ReportData {
  return {
    summary: {
      stationId: station.id,
      stationName: station.name,
      summaryDate: scope.summaryDate,
      missingCount: MINUTES_PER_DAY,
      rangeViolationCount: 0,
      rangeViolationSummary: {},
    },
    auditLogs: [{
      type: "missing",
      eventDate: scope.summaryDate,
      rowContents: {
        reason: "noTelemetry",
        missingCount: MINUTES_PER_DAY,
        periods: [{ start: scope.start, end: scope.end, missingCount: MINUTES_PER_DAY }],
      },
    }],
  };
}

function buildInvestigationReport(investigation: InvestigationResponse, summaryDate: Date): ReportData {
  const analyses = investigation.metricAnalyses ?? [];
  const missingCount = analyses.reduce(
    (total, item) => total + item.analysis.summary.missingRecordCount,
    0,
  );
  const rangeViolationCount = analyses.reduce(
    (total, item) => total + item.analysis.rangeViolations.length,
    0,
  );
  const rangeViolationSummary = Object.fromEntries(
    analyses
      .map((item) => [item.metric, item.analysis.rangeViolations.length] as const)
      .filter(([, count]) => count > 0),
  ) satisfies Prisma.InputJsonObject;
  const rangeViolationLogs = analyses.flatMap((item) =>
    item.analysis.rangeViolations.map((violation) => {
      const row = item.records.find((record) => record.timestamp === violation.timestamp);
      return {
        type: "rangeViolation" as const,
        eventDate: summaryDate,
        rowContents: {
          metric: item.metric,
          ...(row ?? { timestamp: violation.timestamp, value: violation.value }),
        } satisfies Prisma.InputJsonObject,
      };
    }),
  );
  const missingLogs = analyses
    .filter((item) => item.analysis.missingPeriods.length > 0)
    .map((item) => ({
      type: "missing" as const,
      eventDate: summaryDate,
      rowContents: {
        metric: item.metric,
        missingCount: item.analysis.summary.missingRecordCount,
        periods: item.analysis.missingPeriods.map((period) => ({
          start: period.start,
          end: period.end,
          missingCount: period.missingCount,
        })),
      } satisfies Prisma.InputJsonObject,
    }));

  return {
    summary: {
      stationId: investigation.station.id,
      stationName: investigation.station.name,
      summaryDate,
      missingCount,
      rangeViolationCount,
      rangeViolationSummary,
    },
    auditLogs: [
      ...rangeViolationLogs,
      ...missingLogs,
      ...(missingCount > 0 && missingLogs.length === 0
        ? [{ type: "missing" as const, eventDate: summaryDate }]
        : []),
    ],
  };
}

async function saveReport({ summary: summaryData, auditLogs: allAuditLogs }: ReportData, replaceExisting: boolean) {
  const prisma = getPrisma();
  const { stationId, summaryDate } = summaryData;
  // The nightly retention job deletes logs outside the current month, so rebuilding
  // older dates keeps only the summary instead of writing logs that are about to be deleted.
  const auditLogs = isAuditLogRetained(summaryDate) ? allAuditLogs : [];

  try {
    if (replaceExisting) {
      await prisma.$transaction(
        async (transaction) => {
          await transaction.dailyStationSummary.deleteMany({
            where: { stationId, summaryDate },
          });

          const summary = await transaction.dailyStationSummary.create({
            data: summaryData,
          });

          if (auditLogs.length > 0) {
            await transaction.stationAuditLog.createMany({
              data: auditLogs.map((log) => ({
                ...log,
                summaryId: summary.id,
              })),
            });
          }
        },
        {
          maxWait: REPORT_TRANSACTION_MAX_WAIT_MS,
          timeout: REPORT_TRANSACTION_TIMEOUT_MS,
        },
      );

      invalidateAuditReportDate(summaryDate.toISOString().slice(0, 10));

      return loadStoredReport(stationId, summaryDate);
    }

    const report = await prisma.dailyStationSummary.create({
      data: {
        ...summaryData,
        auditLogs: { create: auditLogs },
      },
      include: { auditLogs: true },
    });

    invalidateAuditReportDate(summaryDate.toISOString().slice(0, 10));

    return serializeReport(report);
  } catch (error) {
    if (!replaceExisting && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return loadStoredReport(stationId, summaryDate);
    }
    throw error;
  }
}

async function loadStoredReport(stationId: string, summaryDate: Date) {
  const prisma = getPrisma();
  const report = await prisma.dailyStationSummary.findUnique({
    where: { stationId_summaryDate: { stationId, summaryDate } },
    include: { auditLogs: true },
  });
  return report ? serializeReport(report) : null;
}

function serializeReport(report: DailyStationSummary & {
  auditLogs?: Array<{ id: bigint; summaryId: bigint }>;
}) {
  return {
    ...report,
    id: report.id.toString(),
    auditLogs: report.auditLogs?.map((log) => ({
      ...log,
      id: log.id.toString(),
      summaryId: log.summaryId.toString(),
    })),
  };
}

function buildInternalRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const internalAccessToken = process.env.INTERNAL_ACCESS_TOKEN?.trim();
  const vercelAutomationBypassSecret =
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

  if (internalAccessToken) {
    headers["x-internal-access-token"] = internalAccessToken;
  }
  if (vercelAutomationBypassSecret) {
    headers["x-vercel-protection-bypass"] = vercelAutomationBypassSecret;
  }

  return headers;
}

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const contentType = response.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("application/json")) {
    throw new Error(
      `${label} returned ${contentType || "an unknown content type"} (${response.status}) instead of JSON.`,
    );
  }

  try {
    return await response.json() as T;
  } catch {
    throw new Error(`${label} returned invalid JSON (${response.status}).`);
  }
}

async function readErrorPayload(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    return await response.json() as { code?: string; message?: string };
  } catch {
    return {};
  }
}

function toPhilippineDateKey(time: number) {
  return new Date(time + PHT_OFFSET_MS).toISOString().slice(0, 10);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
