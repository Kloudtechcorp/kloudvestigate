import { assertInternalAccess } from "@/lib/auth";
import { KloudtrackRateLimitError } from "@/lib/kloudtrack-api";
import { getCachedStations } from "@/lib/kloudtrack-cache";
import { resolveKloudtrackConfigFromRequest } from "@/lib/kloudtrack-environment";
import { demoStations } from "@/lib/mock-telemetry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  const kloudtrackConfig = resolveKloudtrackConfigFromRequest(request);

  if (!kloudtrackConfig.apiToken) {
    return Response.json({
      stations: demoStations,
      source: "demo",
      environment: kloudtrackConfig.environment,
      reason: `${kloudtrackConfig.environment === "beta" ? "BETA_" : ""}KLOUDTRACK_API_TOKEN is not configured.`,
    });
  }

  try {
    return Response.json({
      stations: await getCachedStations(kloudtrackConfig),
      source: "kloudtrack",
      environment: kloudtrackConfig.environment,
    });
  } catch (error) {
    const rateLimited = error instanceof KloudtrackRateLimitError;
    return Response.json(
      {
        error: "Station list failed",
        message: error instanceof Error ? error.message : "Unknown dashboard API error",
        ...(rateLimited ? { code: "rate_limited", retryAfterMs: error.retryAfterMs } : {}),
      },
      { status: rateLimited ? 429 : 502 },
    );
  }
}
