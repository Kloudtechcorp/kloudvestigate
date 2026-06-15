import { assertInternalAccess } from "@/lib/auth";
import {
  getDashboardDataFromKloudtrackApi,
  normalizeDashboardStations,
} from "@/lib/kloudtrack-api";
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
    const dashboard = await getDashboardDataFromKloudtrackApi(kloudtrackConfig);
    return Response.json({
      stations: normalizeDashboardStations(dashboard),
      source: "kloudtrack",
      environment: kloudtrackConfig.environment,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Station list failed",
        message: error instanceof Error ? error.message : "Unknown dashboard API error",
      },
      { status: 502 },
    );
  }
}
