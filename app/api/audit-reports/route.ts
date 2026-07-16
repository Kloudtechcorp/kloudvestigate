import { assertInternalAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const stationId = params.get("stationId")?.trim() || undefined;
  const month = params.get("month");
  const date = params.get("date");

  try {
    if (month) return getMonthlySummaries(month, stationId);
    if (date) return getDailyAudit(date, stationId);

    return Response.json(
      { error: "Invalid audit query", message: "Provide either month=YYYY-MM or date=YYYY-MM-DD." },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        error: "Audit report lookup failed",
        message: error instanceof Error ? error.message : "Unknown database error",
      },
      { status: 500 },
    );
  }
}

async function getMonthlySummaries(month: string, stationId?: string) {
  const range = parseMonth(month);
  if (!range) {
    return Response.json({ error: "Invalid month", message: "Month must use YYYY-MM format." }, { status: 400 });
  }

  const [rows, stationRows] = await Promise.all([
    prisma.dailyStationSummary.findMany({
      where: {
        summaryDate: { gte: range.start, lt: range.end },
        ...(stationId ? { stationId } : {}),
      },
      select: {
        stationId: true,
        summaryDate: true,
        missingCount: true,
        rangeViolationCount: true,
      },
      orderBy: { summaryDate: "asc" },
    }),
    prisma.dailyStationSummary.findMany({
      select: { stationId: true, stationName: true },
      distinct: ["stationId"],
      orderBy: { stationId: "asc" },
    }),
  ]);

  const totalsByDate = new Map<string, { missingCount: number; rangeViolationCount: number }>();
  for (const row of rows) {
    const date = toDateKey(row.summaryDate);
    const total = totalsByDate.get(date) ?? { missingCount: 0, rangeViolationCount: 0 };
    total.missingCount += row.missingCount;
    total.rangeViolationCount += row.rangeViolationCount;
    totalsByDate.set(date, total);
  }

  return Response.json({
    month,
    summaries: [...totalsByDate].map(([date, totals]) => ({ date, ...totals })),
    stations: stationRows.map((station) => ({
      id: station.stationId,
      name: station.stationName ?? station.stationId,
    })),
  });
}

async function getDailyAudit(date: string, stationId?: string) {
  const summaryDate = parseDate(date);
  if (!summaryDate) {
    return Response.json({ error: "Invalid date", message: "Date must use YYYY-MM-DD format." }, { status: 400 });
  }

  const summaries = await prisma.dailyStationSummary.findMany({
    where: {
      summaryDate,
      ...(stationId ? { stationId } : {}),
    },
    select: {
      stationId: true,
      stationName: true,
      missingCount: true,
      rangeViolationCount: true,
      rangeViolationSummary: true,
      auditLogs: {
        select: {
          id: true,
          type: true,
          eventDate: true,
          rowContents: true,
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { stationId: "asc" },
  });

  return Response.json({
    date,
    summaries: summaries.map((summary) => ({
      stationId: summary.stationId,
      stationName: summary.stationName ?? summary.stationId,
      missingCount: summary.missingCount,
      rangeViolationCount: summary.rangeViolationCount,
      rangeViolationSummary: summary.rangeViolationSummary,
      auditLogs: summary.auditLogs.map((log) => ({
        id: log.id.toString(),
        type: log.type,
        eventDate: toDateKey(log.eventDate),
        rowContents: log.rowContents,
      })),
    })),
  });
}

function parseMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
