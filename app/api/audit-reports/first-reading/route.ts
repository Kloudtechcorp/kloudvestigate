import { assertInternalAccess } from "@/lib/auth";
import { KloudtrackRateLimitError } from "@/lib/kloudtrack-api";
import { getStationFirstReadingDate } from "@/lib/kloudtrack-cache";
import { resolveKloudtrackEnvironmentConfig } from "@/lib/kloudtrack-environment";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Looks up when a station first reported, one station per request so the long KloudTrack query
 * fits Vercel's time limit. The Add Previous Data page warms these before rebuilding days.
 */
export async function GET(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  const stationId = new URL(request.url).searchParams.get("stationId")?.trim();
  if (!stationId) {
    return Response.json({ error: "Invalid station", message: "Provide a stationId." }, { status: 400 });
  }

  // The audit always reads live KloudTrack, so its cached lookups must come from live too.
  const kloudtrackConfig = resolveKloudtrackEnvironmentConfig("live");
  if (!kloudtrackConfig.apiToken) return Response.json({ stationId, firstReadingDate: null });

  try {
    return Response.json({ stationId, firstReadingDate: await getStationFirstReadingDate(stationId, kloudtrackConfig) });
  } catch (error) {
    const rateLimited = error instanceof KloudtrackRateLimitError;
    return Response.json(
      {
        error: "First reading lookup failed",
        message: error instanceof Error ? error.message : "Unknown KloudTrack error",
        ...(rateLimited ? { code: "rate_limited", retryAfterMs: error.retryAfterMs } : {}),
      },
      { status: rateLimited ? 429 : 502 },
    );
  }
}
