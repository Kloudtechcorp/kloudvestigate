import { assertInternalAccess } from "@/lib/auth";
import { getCachedDailyAudit, getCachedMonthlyAuditSummaries } from "@/lib/audit-report-cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const stationId = params.get("stationId")?.trim() || undefined;
  const month = params.get("month");
  const date = params.get("date");
  const includeDetails = params.get("includeDetails") === "true";

  try {
    if (month) {
      if (!parseMonth(month)) {
        return Response.json({ error: "Invalid month", message: "Month must use YYYY-MM format." }, { status: 400 });
      }
      return Response.json(await getCachedMonthlyAuditSummaries(month, stationId));
    }
    if (date) {
      if (!parseDate(date)) {
        return Response.json({ error: "Invalid date", message: "Date must use YYYY-MM-DD format." }, { status: 400 });
      }
      return Response.json(await getCachedDailyAudit(date, stationId, includeDetails));
    }

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
