import { NextResponse } from "next/server";
import { assertInternalAccess } from "@/lib/auth";
import {
  KLOUDTRACK_ENVIRONMENT_COOKIE,
  parseKloudtrackEnvironment,
  resolveKloudtrackEnvironmentConfig,
  resolveKloudtrackConfigFromRequest,
} from "@/lib/kloudtrack-environment";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  const config = resolveKloudtrackConfigFromRequest(request);

  return NextResponse.json({
    environment: config.environment,
    configured: Boolean(config.apiToken),
  });
}

export async function POST(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as { environment?: unknown };
    const environment = parseKloudtrackEnvironment(
      typeof body.environment === "string" ? body.environment : null,
    );
    const config = resolveKloudtrackEnvironmentConfig(environment);
    const response = NextResponse.json({
      environment,
      configured: Boolean(config.apiToken),
    });

    response.cookies.set({
      name: KLOUDTRACK_ENVIRONMENT_COOKIE,
      value: environment,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: "KloudTrack environment save failed",
        message: error instanceof Error ? error.message : "Unknown environment config error",
      },
      { status: 400 },
    );
  }
}
