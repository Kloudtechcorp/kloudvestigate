import { unstable_cache, revalidateTag } from "next/cache";

import { prisma } from "@/lib/prisma";

const AUDIT_REPORTS_TAG = "audit-reports";
const AUDIT_REPORT_REVALIDATE_SECONDS = 5 * 60;

export async function getCachedMonthlyAuditSummaries(month: string, stationId?: string) {
  return unstable_cache(
    () => loadMonthlyAuditSummaries(month, stationId),
    ["monthly-audit-summaries", month, stationId ?? "all"],
    {
      revalidate: AUDIT_REPORT_REVALIDATE_SECONDS,
      tags: [AUDIT_REPORTS_TAG, monthTag(month)],
    },
  )();
}

export async function getCachedDailyAudit(date: string, stationId?: string, includeDetails = false) {
  return unstable_cache(
    () => loadDailyAudit(date, stationId, includeDetails),
    ["daily-audit", date, stationId ?? "all", includeDetails ? "details" : "summary"],
    {
      revalidate: AUDIT_REPORT_REVALIDATE_SECONDS,
      tags: [AUDIT_REPORTS_TAG, dateTag(date)],
    },
  )();
}

export function invalidateAuditReportDate(date: string) {
  // A rebuild changes both the selected day's details and its monthly aggregate.
  revalidateTag(dateTag(date), { expire: 0 });
  revalidateTag(monthTag(date.slice(0, 7)), { expire: 0 });
}

export function invalidateAllAuditReports() {
  revalidateTag(AUDIT_REPORTS_TAG, { expire: 0 });
}

async function loadMonthlyAuditSummaries(month: string, stationId?: string) {
  const range = parseMonth(month);
  if (!range) throw new Error("Month must use YYYY-MM format.");

  const [rows, stationRows] = await Promise.all([
    prisma.dailyStationSummary.findMany({
      where: {
        summaryDate: { gte: range.start, lt: range.end },
        ...(stationId ? { stationId } : {}),
      },
      select: {
        stationId: true,
        stationName: true,
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

  const totalsByDate = new Map<string, {
    missingCount: number;
    rangeViolationCount: number;
    rangeViolationStations: Map<string, string>;
  }>();
  for (const row of rows) {
    const date = toDateKey(row.summaryDate);
    const total = totalsByDate.get(date) ?? {
      missingCount: 0,
      rangeViolationCount: 0,
      rangeViolationStations: new Map<string, string>(),
    };
    total.missingCount += row.missingCount;
    total.rangeViolationCount += row.rangeViolationCount;
    if (row.rangeViolationCount > 0) {
      total.rangeViolationStations.set(row.stationId, row.stationName ?? row.stationId);
    }
    totalsByDate.set(date, total);
  }

  return {
    month,
    summaries: [...totalsByDate].map(([date, totals]) => ({
      date,
      missingCount: totals.missingCount,
      rangeViolationCount: totals.rangeViolationCount,
      rangeViolationStations: [...totals.rangeViolationStations]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
    stations: stationRows.map((station) => ({
      id: station.stationId,
      name: station.stationName ?? station.stationId,
    })),
  };
}

async function loadDailyAudit(date: string, stationId?: string, includeDetails = false) {
  const summaryDate = parseDate(date);
  if (!summaryDate) throw new Error("Date must use YYYY-MM-DD format.");

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
      ...(includeDetails ? {
        auditLogs: {
          select: {
            id: true,
            type: true,
            eventDate: true,
            rowContents: true,
          },
          orderBy: { id: "asc" as const },
        },
      } : {}),
    },
    orderBy: { stationId: "asc" },
  });

  return {
    date,
    summaries: summaries.map((summary) => ({
      stationId: summary.stationId,
      stationName: summary.stationName ?? summary.stationId,
      missingCount: summary.missingCount,
      rangeViolationCount: summary.rangeViolationCount,
      rangeViolationSummary: summary.rangeViolationSummary,
      auditLogs: ("auditLogs" in summary ? summary.auditLogs : []).map((log) => ({
        id: log.id.toString(),
        type: log.type,
        eventDate: toDateKey(log.eventDate),
        rowContents: log.rowContents,
      })),
    })),
  };
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

function dateTag(date: string) {
  return `audit-reports:date:${date}`;
}

function monthTag(month: string) {
  return `audit-reports:month:${month}`;
}
