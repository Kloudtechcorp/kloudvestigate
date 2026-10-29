import { assertInternalAccess } from "@/lib/auth";
import { resolveKloudtrackConfigFromRequest } from "@/lib/kloudtrack-environment";
import { createUptimeWindow, UptimeInputError } from "@/lib/station-uptime";
import { loadStationUptime, type TelemetryDayLoader } from "@/lib/station-uptime.server";
import { KloudtrackRateLimitError } from "@/lib/kloudtrack-api";
import { getStationTelemetryDay } from "@/lib/kloudtrack-cache";

const loadCachedTelemetryDay: TelemetryDayLoader = (stationId, startMs, config, signal) =>
  getStationTelemetryDay(stationId, startMs, 1, config, { signal });

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new UptimeInputError("The request must contain valid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new UptimeInputError("The request must contain a station and period.");
    }
    const { stationId, period, value } = body as Record<string, unknown>;
    if (typeof stationId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(stationId)) {
      throw new UptimeInputError("Choose a valid station.");
    }
    const window = createUptimeWindow(period, value);
    const report = await loadStationUptime(
      stationId,
      window,
      resolveKloudtrackConfigFromRequest(request),
      request.signal,
      loadCachedTelemetryDay,
    );
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const rateLimited = error instanceof KloudtrackRateLimitError;
    return Response.json({
      error: "Uptime report failed",
      message: error instanceof Error ? error.message : "Unable to fetch station uptime.",
    }, {
      status: error instanceof UptimeInputError ? 400 : rateLimited ? 429 : 502,
      headers: rateLimited ? { "Retry-After": String(Math.ceil(error.retryAfterMs / 1000)) } : undefined,
    });
  }
}
