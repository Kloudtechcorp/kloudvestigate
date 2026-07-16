import { assertInternalAccess } from "@/lib/auth";
import { getPhilippineDayScope, runDailyStationInvestigations } from "@/lib/daily-station-investigations";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as { date?: unknown; stationId?: unknown };
    const date = typeof body.date === "string" ? body.date : "";
    const stationId = typeof body.stationId === "string" && body.stationId.trim()
      ? body.stationId.trim()
      : undefined;
    if (!getPhilippineDayScope(date)) {
      return Response.json({ error: "Invalid date", message: "Date must use YYYY-MM-DD format." }, { status: 400 });
    }

    return Response.json(await runDailyStationInvestigations({
      requestUrl: request.url,
      dateKey: date,
      stationId,
      replaceExisting: true,
    }));
  } catch (error) {
    return Response.json(
      {
        error: "Manual audit rebuild failed",
        message: error instanceof Error ? error.message : "Unknown rebuild error",
      },
      { status: 500 },
    );
  }
}
