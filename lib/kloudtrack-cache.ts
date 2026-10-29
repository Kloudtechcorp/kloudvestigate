import { revalidateTag, unstable_cache } from "next/cache";

import {
  getAllTelemetryHistoryFromKloudtrackApi,
  getDashboardDataFromKloudtrackApi,
  getTelemetryDayFromKloudtrackApi,
  normalizeDashboardStations,
} from "@/lib/kloudtrack-api";
import type { KloudtrackEnvironmentConfig } from "@/lib/kloudtrack-environment";
import type { StationMetadata, TelemetryHistoryMetricRaw } from "@/lib/telemetry-types";

const DAY_MS = 24 * 60 * 60_000;
const PHT_OFFSET_MS = 8 * 60 * 60_000;
const STATION_LIST_REVALIDATE_SECONDS = 10 * 60;
const FIRST_READING_REVALIDATE_SECONDS = 24 * 60 * 60;
// 2024-01-01 00:00 PHT, before the first KloudTrack station reported.
const FIRST_READING_SEARCH_START = "2023-12-31T16:00:00.000Z";
const TELEMETRY_DAY_REVALIDATE_SECONDS = 7 * 24 * 60 * 60;
// Stations can upload buffered readings late, so a day is cached only once it ended a full day ago.
const TELEMETRY_SETTLE_MS = DAY_MS;

/** The station list changes rarely, so every audit day, report and page load shares one copy for 10 minutes. */
export function getCachedStations(config: KloudtrackEnvironmentConfig): Promise<StationMetadata[]> {
  return unstable_cache(
    async () => normalizeDashboardStations(await getDashboardDataFromKloudtrackApi(config)),
    ["kloudtrack-stations-v1", config.environment, config.baseURL],
    { revalidate: STATION_LIST_REVALIDATE_SECONDS, tags: ["kloudtrack-stations"] },
  )();
}

/**
 * The first Philippine date with any reading, or null when the station never reported.
 * One request of daily totals covers the whole history; days before it need no download.
 * A daily bucket is labelled no later than its first reading, so earlier dates truly have none.
 */
export function getStationFirstReadingDate(stationId: string, config: KloudtrackEnvironmentConfig): Promise<string | null> {
  return unstable_cache(
    async () => {
      const raw = await getAllTelemetryHistoryFromKloudtrackApi(stationId, {
        skip: "0",
        interval: String(24 * 60),
        startDate: FIRST_READING_SEARCH_START,
        endDate: new Date().toISOString(),
      }, config);
      const times = [...(raw.telemetry ?? []), ...(raw.waterLevel ?? []), ...(raw.rainGauge ?? [])]
        .map((record) => Date.parse(record.recordedAt))
        .filter((time) => !Number.isNaN(time));
      return times.length ? new Date(Math.min(...times) + PHT_OFFSET_MS).toISOString().slice(0, 10) : null;
    },
    ["kloudtrack-first-reading-v1", config.environment, config.baseURL, stationId],
    { revalidate: FIRST_READING_REVALIDATE_SECONDS, tags: ["kloudtrack-first-reading"] },
  )();
}

/**
 * One station's readings for a day. Completed days do not change, so the audit, uptime and readings
 * popup share one cached copy for 7 days instead of each downloading it again from KloudTrack.
 * `fresh` always downloads and drops the cached copy, for rebuilds that must see KloudTrack corrections.
 */
export async function getStationTelemetryDay(
  stationId: string,
  startMs: number,
  intervalMinutes: number,
  config: KloudtrackEnvironmentConfig,
  options: { signal?: AbortSignal; fresh?: boolean } = {},
): Promise<TelemetryHistoryMetricRaw> {
  const download = () => getTelemetryDayFromKloudtrackApi(stationId, startMs, intervalMinutes, config, options.signal);
  if (startMs + DAY_MS > Date.now() - TELEMETRY_SETTLE_MS) return download();

  const dayKey = new Date(startMs).toISOString();
  const dayTag = `kloudtrack-day:${config.environment}:${stationId}:${dayKey}`;
  if (options.fresh) {
    const raw = await download();
    revalidateTag(dayTag, { expire: 0 });
    return raw;
  }

  return unstable_cache(
    download,
    ["kloudtrack-day-v1", config.environment, config.baseURL, stationId, dayKey, String(intervalMinutes)],
    { revalidate: TELEMETRY_DAY_REVALIDATE_SECONDS, tags: ["kloudtrack-telemetry", dayTag] },
  )();
}
