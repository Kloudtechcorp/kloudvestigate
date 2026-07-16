import { createHmac, timingSafeEqual } from "crypto";
import {
  getPreviousPhilippineDateKey,
  runDailyStationInvestigations,
} from "@/lib/daily-station-investigations";

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

function authorizeCron(request: Request): Response | null {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return Response.json(
      { error: "Cron is not configured", message: "Set CRON_SECRET before enabling the schedule." },
      { status: 503 },
    );
  }

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!matchesSecret(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

function matchesSecret(value: string | undefined, expected: string) {
  if (!value) return false;
  const valueDigest = createHmac("sha256", expected).update(value).digest();
  const expectedDigest = createHmac("sha256", expected).update(expected).digest();
  return timingSafeEqual(valueDigest, expectedDigest);
}
