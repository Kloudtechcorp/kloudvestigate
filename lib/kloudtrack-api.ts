import type {
  MetricKey,
  StationMetadata,
  StationRaw,
  TelemetryHistoryMetricRaw,
  TelemetryRecord,
} from "./telemetry-types";
import { allMetricKeys } from "./metric-profiles";
import {
  KloudtrackRequestQueue,
  RequestBudgetExceededError,
  type RequestBudget,
} from "./kloudtrack-request-queue";
import {
  resolveKloudtrackEnvironmentConfig,
  type KloudtrackEnvironment,
  type KloudtrackEnvironmentConfig,
} from "./kloudtrack-environment";

const KLOUDTRACK_REQUEST_TIMEOUT_MS = readPositiveNumber(
  process.env.KLOUDTRACK_REQUEST_TIMEOUT_MS,
  120_000,
);
const KLOUDTRACK_REQUEST_GAP_MS = readPositiveNumber(process.env.KLOUDTRACK_REQUEST_GAP_MS, 350);
const MAX_RATE_LIMIT_RETRIES = 4;
const DAY_MS = 24 * 60 * 60_000;
const RATE_LIMIT_RETRY_BASE_MS = 5_000;
// KloudTrack's per-API-key limits (rateLimit.apiKey.middleware.ts), using the stricter 100 / 15 min key check.
const DEFAULT_RATE_LIMITS = "3/1s,20/1m,100/15m,1000/1h,10000/1d";
// Headroom for other users of the same key and for server instances that keep their own count.
const DEFAULT_RATE_LIMIT_SHARE = 0.8;
const MAX_BUDGET_WAIT_MS = 30_000;
const DURATION_UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: DAY_MS };

const globalForKloudtrack = globalThis as unknown as {
  kloudtrackRequestQueues?: Map<string, KloudtrackRequestQueue>;
};
const requestQueues = globalForKloudtrack.kloudtrackRequestQueues ??= new Map<string, KloudtrackRequestQueue>();

export class KloudtrackRateLimitError extends Error {
  constructor(
    readonly retryAfterMs: number,
    message = `KloudTrack is still limiting requests after ${MAX_RATE_LIMIT_RETRIES} retries. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
  ) {
    super(message);
    this.name = "KloudtrackRateLimitError";
  }
}

interface KloudtrackApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface DashboardEntryRaw {
  station: StationRaw;
  telemetry: unknown | null;
}

type DashboardRaw = DashboardEntryRaw[] | { stations: DashboardEntryRaw[] };

class KloudtrackApiClient {
  constructor(
    private readonly baseURL: string,
    private readonly apiToken?: string,
  ) {}

  async get<T>(endpoint: string, signal?: AbortSignal): Promise<T> {
    if (typeof window !== "undefined") {
      throw new Error("Kloudtrack API requests must run on the server");
    }

    const key = JSON.stringify([new URL(this.baseURL).origin, this.apiToken ?? ""]);
    let queue = requestQueues.get(key);
    if (!queue) {
      queue = new KloudtrackRequestQueue(KLOUDTRACK_REQUEST_GAP_MS, readRequestBudget(), MAX_BUDGET_WAIT_MS);
      requestQueues.set(key, queue);
    }
    const requestQueue = queue;

    for (let attempt = 0; ; attempt += 1) {
      let result: { kind: "success"; data: T } | { kind: "rate-limit"; retryAfterMs: number };
      try {
        result = await requestQueue.run(() =>
          this.getAttempt<T>(endpoint, signal, (retryAfter) => {
            const delayMs = parseRetryAfter(retryAfter) ?? RATE_LIMIT_RETRY_BASE_MS * 2 ** attempt;
            requestQueue.defer(delayMs);
            return delayMs;
          }), signal);
      } catch (error) {
        if (error instanceof RequestBudgetExceededError) {
          throw new KloudtrackRateLimitError(
            error.retryAfterMs,
            `Kloudvestigate has used its KloudTrack request allowance for now. Try again in ${formatWait(error.retryAfterMs)}.`,
          );
        }
        throw error;
      }

      if (result.kind === "success") return result.data;
      if (attempt >= MAX_RATE_LIMIT_RETRIES) throw new KloudtrackRateLimitError(result.retryAfterMs);
    }
  }

  private async getAttempt<T>(
    endpoint: string,
    signal: AbortSignal | undefined,
    onRateLimit: (retryAfter: string | null) => number,
  ): Promise<{ kind: "success"; data: T } | { kind: "rate-limit"; retryAfterMs: number }> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, KLOUDTRACK_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiToken ? { "x-kloudtrack-key": this.apiToken } : {}),
        },
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.status === 429) {
        const retryAfterMs = onRateLimit(response.headers.get("Retry-After"));
        await response.body?.cancel();
        return { kind: "rate-limit", retryAfterMs };
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Kloudtrack API Error: ${response.status} ${response.statusText}`);
      }

      const apiResponse = (await response.json()) as KloudtrackApiResponse<T>;
      if (!apiResponse.success) {
        throw new Error(apiResponse.message || "Kloudtrack API request failed");
      }
      return { kind: "success", data: apiResponse.data };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (timedOut) {
        throw new Error(
          `KloudTrack API request timed out after ${formatTimeoutSeconds(KLOUDTRACK_REQUEST_TIMEOUT_MS)}.`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

export async function getTelemetryMetricHistoryFromKloudtrackApi(
  stationId: string,
  parameter: MetricKey,
  params: Record<string, string>,
  config: KloudtrackEnvironment | KloudtrackEnvironmentConfig = "live",
): Promise<TelemetryHistoryMetricRaw> {
  const queryString = new URLSearchParams(params).toString();
  const raw = await getKloudtrackApi(config).get<TelemetryHistoryMetricRaw>(
    `/telemetry/station/${stationId}/history/${parameter}?${queryString}`,
  );
  return {
    ...raw,
    telemetry: raw.telemetry ?? [],
  };
}

export async function getAllTelemetryHistoryFromKloudtrackApi(
  stationId: string,
  params: Record<string, string>,
  config: KloudtrackEnvironment | KloudtrackEnvironmentConfig = "live",
  signal?: AbortSignal,
): Promise<TelemetryHistoryMetricRaw> {
  const queryString = new URLSearchParams(params).toString();
  return getKloudtrackApi(config).get<TelemetryHistoryMetricRaw>(`/telemetry/station/${stationId}/history?${queryString}`, signal);
}

/** One station's readings for [start, start + 1 day); endDate stops 1 ms early to leave out the next day's first reading. */
export function getTelemetryDayFromKloudtrackApi(
  stationId: string,
  startMs: number,
  intervalMinutes: number,
  config: KloudtrackEnvironment | KloudtrackEnvironmentConfig = "live",
  signal?: AbortSignal,
): Promise<TelemetryHistoryMetricRaw> {
  return getAllTelemetryHistoryFromKloudtrackApi(stationId, {
    skip: "0",
    interval: String(intervalMinutes),
    startDate: new Date(startMs).toISOString(),
    endDate: new Date(startMs + DAY_MS - 1).toISOString(),
  }, config, signal);
}

export async function getDashboardDataFromKloudtrackApi(
  config: KloudtrackEnvironment | KloudtrackEnvironmentConfig = "live",
): Promise<DashboardRaw> {
  return getKloudtrackApi(config).get<DashboardRaw>("/telemetry/dashboard");
}

export function normalizeStation(station: StationRaw): StationMetadata {
  const location = Array.isArray(station.location)
    ? station.location
    : station.location
      ? [station.location.lat, station.location.lng] as [number, number]
      : null;

  return {
    id: station.id,
    name: station.stationName,
    type: station.stationType,
    location,
    city: station.city,
    state: station.state,
    organizationName: station.organization?.organizationName ?? null,
    isActive: station.isActive,
    activatedAt: station.activatedAt,
  };
}

export function normalizeTelemetry(raw: TelemetryHistoryMetricRaw): {
  station: StationMetadata;
  records: TelemetryRecord[];
} {
  const telemetry = raw.telemetry ?? raw.waterLevel ?? raw.rainGauge ?? [];
  return {
    station: normalizeStation(raw.station),
    records: telemetry.map((record) => ({
      id: record.id,
      timestamp: new Date(record.recordedAt).toISOString(),
      value: Number(record.value),
    })).filter((record) => Number.isFinite(record.value)),
  };
}

export function normalizeAllTelemetry(raw: TelemetryHistoryMetricRaw): {
  station: StationMetadata;
  series: Array<{ metric: MetricKey; records: TelemetryRecord[] }>;
} {
  const telemetry = raw.telemetry ?? [];
  return {
    station: normalizeStation(raw.station),
    series: allMetricKeys
      .map((metric) => ({
        metric,
        records: telemetry
          .map((record) => {
            const value = readMetricValue(record, metric);
            return {
              id: record.id,
              timestamp: new Date(record.recordedAt).toISOString(),
              value: Number(value),
            };
          })
          .filter((record) => Number.isFinite(record.value)),
      }))
      .filter((item) => item.records.length > 0),
  };
}

export function normalizeDashboardStations(raw: DashboardRaw): StationMetadata[] {
  const entries = Array.isArray(raw) ? raw : raw.stations;
  const stationsById = new Map<string, StationMetadata>();

  for (const entry of entries) {
    const station = normalizeStation(entry.station);
    if (!stationsById.has(station.id)) {
      stationsById.set(station.id, station);
    }
  }

  return [...stationsById.values()];
}

function readMetricValue(
  record: NonNullable<TelemetryHistoryMetricRaw["telemetry"]>[number],
  metric: MetricKey,
): number | undefined {
  if (metric === "windDirection") return record.wind?.direction ?? record.windDirection;
  if (metric === "windSpeed") return record.wind?.speed ?? record.windSpeed;
  return record[metric];
}

/** Reads limits such as "20/1m,100/15m" (or "off") at queue creation, so tests can change them per origin. */
function readRequestBudget(): RequestBudget {
  const spec = process.env.KLOUDTRACK_RATE_LIMITS?.trim() || DEFAULT_RATE_LIMITS;
  if (spec === "off") return [];

  const share = Number(process.env.KLOUDTRACK_RATE_LIMIT_SHARE);
  const usableShare = Number.isFinite(share) && share > 0 && share <= 1 ? share : DEFAULT_RATE_LIMIT_SHARE;
  return spec.split(",").flatMap((part) => {
    const match = /^\s*(\d+)\s*\/\s*(\d+)\s*([smhd])\s*$/.exec(part);
    if (!match) {
      console.warn(`Ignoring invalid KLOUDTRACK_RATE_LIMITS entry "${part}".`);
      return [];
    }
    return [{
      max: Math.max(1, Math.floor(Number(match[1]) * usableShare)),
      windowMs: Number(match[2]) * DURATION_UNIT_MS[match[3]],
    }];
  });
}

function formatWait(ms: number) {
  const minutes = Math.ceil(ms / 60_000);
  return ms < 60_000 ? `${Math.ceil(ms / 1000)} seconds` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function readPositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    const delayMs = seconds * 1000;
    return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function formatTimeoutSeconds(timeoutMs: number) {
  const seconds = timeoutMs / 1000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

function getKloudtrackApi(config: KloudtrackEnvironment | KloudtrackEnvironmentConfig) {
  const resolvedConfig = typeof config === "string"
    ? resolveKloudtrackEnvironmentConfig(config)
    : config;

  return new KloudtrackApiClient(resolvedConfig.baseURL, resolvedConfig.apiToken);
}
