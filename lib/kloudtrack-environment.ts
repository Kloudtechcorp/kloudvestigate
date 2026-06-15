export type KloudtrackEnvironment = "live" | "beta";

export const KLOUDTRACK_ENVIRONMENT_COOKIE = "kloudvestigate.kloudtrack-environment";

const DEFAULT_LIVE_API_BASE_URL = "https://api.kloudtechsea.com/api/v1";
const DEFAULT_BETA_API_BASE_URL = "https://beta-api.kloudtechsea.com/api/v1";

export type KloudtrackEnvironmentConfig = {
  environment: KloudtrackEnvironment;
  baseURL: string;
  apiToken?: string;
};

export function parseKloudtrackEnvironment(value: string | null | undefined): KloudtrackEnvironment {
  return value === "beta" ? "beta" : "live";
}

export function resolveKloudtrackEnvironmentConfig(
  environment: KloudtrackEnvironment,
): KloudtrackEnvironmentConfig {
  if (environment === "beta") {
    return {
      environment,
      baseURL: process.env.BETA_KLOUDTRACK_API_BASE_URL || DEFAULT_BETA_API_BASE_URL,
      apiToken: process.env.BETA_KLOUDTRACK_API_TOKEN,
    };
  }

  return {
    environment,
    baseURL: process.env.KLOUDTRACK_API_BASE_URL || DEFAULT_LIVE_API_BASE_URL,
    apiToken: process.env.KLOUDTRACK_API_TOKEN,
  };
}

export function resolveKloudtrackEnvironmentFromRequest(request: Request): KloudtrackEnvironment {
  return parseKloudtrackEnvironment(extractKloudtrackEnvironmentCookie(request));
}

export function resolveKloudtrackConfigFromRequest(request: Request): KloudtrackEnvironmentConfig {
  return resolveKloudtrackEnvironmentConfig(resolveKloudtrackEnvironmentFromRequest(request));
}

function extractKloudtrackEnvironmentCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    /(?:^|;\s*)kloudvestigate\.kloudtrack-environment=([^;]+)/,
  );

  return match ? decodeURIComponent(match[1]) : null;
}
