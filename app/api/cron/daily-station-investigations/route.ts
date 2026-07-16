import {
  getPreviousPhilippineDateKey,
  runDailyStationInvestigations,
} from "@/lib/daily-station-investigations";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    return Response.json(await runDailyStationInvestigations({
      requestUrl: request.url,
      dateKey: getPreviousPhilippineDateKey(),
      replaceExisting: false,
    }));
  } catch (error) {
    return Response.json(
      {
        error: "Daily station investigation failed",
        message: error instanceof Error ? error.message : "Unknown cron error",
      },
      { status: 500 },
    );
  }
}

