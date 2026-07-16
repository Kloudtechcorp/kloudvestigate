import { Prisma } from "@/app/generated/prisma/client";
import type { InvestigationResponse, StationsResponse } from "@/components/telemetry/types";
import { prisma } from "@/lib/prisma";

const PHT_OFFSET_MS = 8 * 60 * 60_000;
const REQUEST_GAP_MS = 600;

type RunDailyStationInvestigationsOptions = {
  requestUrl: string;
  dateKey: string;
  stationId?: string;
  replaceExisting: boolean;
};

export async function runDailyStationInvestigations({
  requestUrl,
  dateKey,
  stationId,
  replaceExisting,
}: RunDailyStationInvestigationsOptions) {
  const scope = getPhilippineDayScope(dateKey);
  if (!scope) throw new Error("Date must use YYYY-MM-DD format.");

  const requestHeaders = buildInternalRequestHeaders();
  const stationsResponse = await fetch(new URL("/api/stations", requestUrl), {
    headers: requestHeaders,
    cache: "no-store",
  });
  if (!stationsResponse.ok) throw new Error(`Station lookup failed (${stationsResponse.status}).`);

  const stationPayload = (await stationsResponse.json()) as StationsResponse;
  const stations = stationId
    ? stationPayload.stations.filter((station) => station.id === stationId)
    : stationPayload.stations;
  if (stationId && stations.length === 0) throw new Error(`Station ${stationId} was not found.`);

  const reports = [];
  for (const [index, station] of stations.entries()) {
    if (!replaceExisting) {
      const existing = await loadStoredReport(station.id, scope.summaryDate);
      if (existing) {
        reports.push({ stationId: station.id, status: "stored", report: existing });
        continue;
      }
    }

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
      reports.push({ stationId: station.id, status: "failed" });
    } else {
      const investigation = (await investigationResponse.json()) as InvestigationResponse;
      const report = await storeReport(investigation, scope.summaryDate, replaceExisting);
      reports.push({ stationId: station.id, status: replaceExisting ? "replaced" : "created", report });
    }

    if (index < stations.length - 1) await wait(REQUEST_GAP_MS);
  }

  return {
    reportDate: scope.dateKey,
    timezone: "Asia/Manila",
    stationCount: stations.length,
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

async function storeReport(
  investigation: InvestigationResponse,
  summaryDate: Date,
  replaceExisting: boolean,
) {
  const analyses = investigation.metricAnalyses ?? [];
  const missingCount = analyses.reduce(
    (total, item) => total + item.analysis.summary.missingRecordCount,
    0,
  );
  const rangeViolationCount = analyses.reduce(
    (total, item) => total + item.analysis.rangeViolations.length,
    0,
  );
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

  const createData = {
    stationId: investigation.station.id,
    stationName: investigation.station.name,
    summaryDate,
    missingCount,
    rangeViolationCount,
    auditLogs: {
      create: [
        ...rangeViolationLogs,
        ...(missingCount > 0 ? [{ type: "missing" as const, eventDate: summaryDate }] : []),
      ],
    },
  };

  try {
    const report = replaceExisting
      ? await prisma.$transaction(async (transaction) => {
          await transaction.dailyStationSummary.deleteMany({
            where: { stationId: investigation.station.id, summaryDate },
          });
          return transaction.dailyStationSummary.create({
            data: createData,
            include: { auditLogs: true },
          });
        })
      : await prisma.dailyStationSummary.create({
          data: createData,
          include: { auditLogs: true },
        });

    return serializeReport(report);
  } catch (error) {
    if (!replaceExisting && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return loadStoredReport(investigation.station.id, summaryDate);
    }
    throw error;
  }
}

async function loadStoredReport(stationId: string, summaryDate: Date) {
  const report = await prisma.dailyStationSummary.findUnique({
    where: { stationId_summaryDate: { stationId, summaryDate } },
    include: { auditLogs: true },
  });
  return report ? serializeReport(report) : null;
}

function serializeReport(report: NonNullable<Awaited<ReturnType<typeof prisma.dailyStationSummary.findUnique>>> & {
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
  const token = process.env.INTERNAL_ACCESS_TOKEN?.trim();
  return token ? { "x-internal-access-token": token } : {};
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
