import { getAllTelemetryHistoryFromKloudtrackApi, normalizeStation } from "./kloudtrack-api";
import type { KloudtrackEnvironmentConfig } from "./kloudtrack-environment";
import { createDemoTelemetry, demoStations } from "./mock-telemetry";
import { addUptimeTimestamps, analyzeUptimeCounts, MINUTE_MS, type UptimeReport, type UptimeWindow } from "./station-uptime";
import type { StationMetadata } from "./telemetry-types";

export async function loadStationUptime(
  stationId: string,
  window: UptimeWindow,
  config: KloudtrackEnvironmentConfig,
  signal?: AbortSignal,
): Promise<UptimeReport> {
  const counts = new Uint32Array(window.expectedMinutes);
  const startMs = Date.parse(window.start);
  const endMs = startMs + window.expectedMinutes * MINUTE_MS;
  let station: StationMetadata | undefined;

  if (!config.apiToken) {
    station = demoStations.find((item) => item.id === stationId);
    if (!station) throw new Error("This station is unavailable in demo mode. Reload the station list.");
    // Generate demo data one day at a time, with the same gaps as the investigation feature.
    for (let start = startMs; start < endMs; start += 1440 * MINUTE_MS) {
      signal?.throwIfAborted();
      const demo = createDemoTelemetry(stationId, "temperature", new Date(start).toISOString(),
        new Date(Math.min(start + 1440 * MINUTE_MS, endMs) - 1).toISOString());
      addUptimeTimestamps(counts, window, demo.records.map((record) => record.timestamp));
    }
  } else {
    // Cancel sibling daily requests as soon as one fails, including queued retries.
    const historyController = new AbortController();
    const historySignal = signal ? AbortSignal.any([signal, historyController.signal]) : historyController.signal;
    // Daily requests keep annual histories bounded and retain the one-minute sampling interval.
    const chunks = Array.from({ length: Math.max(1, Math.ceil(window.expectedMinutes / 1440)) }, (_, day) => ({
      start: startMs + day * 1440 * MINUTE_MS,
      end: Math.min(startMs + (day + 1) * 1440 * MINUTE_MS, endMs),
    }));
    let next = 0;
    let failed = false;
    await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
      while (next < chunks.length && !failed) {
        historySignal.throwIfAborted();
        const chunk = chunks[next++];
        try {
          const raw = await getAllTelemetryHistoryFromKloudtrackApi(stationId, {
            skip: "0",
            interval: "1",
            startDate: new Date(chunk.start).toISOString(),
            endDate: new Date(Math.max(chunk.start, chunk.end - 1)).toISOString(),
          }, config, historySignal);
          historySignal.throwIfAborted();
          station ??= normalizeStation(raw.station);
          // Presence measures station availability, independently of a sensor value's range.
          const records = [...(raw.telemetry ?? []), ...(raw.waterLevel ?? []), ...(raw.rainGauge ?? [])];
          addUptimeTimestamps(counts, window, records
            .filter((record) => {
              const time = Date.parse(record.recordedAt);
              return time >= chunk.start && time < chunk.end;
            })
            .map((record) => record.recordedAt));
        } catch (error) {
          failed = true;
          historyController.abort(error);
          throw error;
        }
      }
    }));
  }

  if (!station) throw new Error("Station metadata was not returned by KloudTrack.");
  return {
    station,
    window,
    source: config.apiToken ? "kloudtrack" : "demo",
    environment: config.environment,
    ...analyzeUptimeCounts(window, counts),
  };
}
