import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addUptimeTimestamps,
  analyzeUptimeCounts,
  createUptimeWindow,
  formatUptimeMinute,
  getMinutePage,
  getMinuteRecordCount,
  getMinuteStatus,
  getUptimeHealth,
  MINUTE_MS,
  UptimeInputError,
  type UptimeReport,
} from "./station-uptime";
import { demoStations } from "./mock-telemetry";
import { loadStationUptime } from "./station-uptime.server";

const NOW = new Date("2026-10-19T04:30:45.000Z");

test("a completed Philippine day contains exactly 1,440 minutes and excludes the next midnight", () => {
  const window = createUptimeWindow("daily", "2026-10-18", NOW);
  assert.equal(window.start, "2026-10-17T16:00:00.000Z");
  assert.equal(window.end, "2026-10-18T16:00:00.000Z");
  assert.equal(window.totalMinutes, 1440);
  assert.equal(window.expectedMinutes, 1440);
  assert.equal(window.pendingMinutes, 0);
  assert.equal(formatUptimeMinute(window.start, 0), "2026-10-18 00:00");
  assert.equal(formatUptimeMinute(window.start, 1439), "2026-10-18 23:59");
});

test("monthly expectations use actual month lengths, including leap February", () => {
  const past = new Date("2027-01-01T00:00:00Z");
  assert.equal(createUptimeWindow("monthly", "2026-02", past).expectedMinutes, 28 * 1440);
  assert.equal(createUptimeWindow("monthly", "2024-02", past).expectedMinutes, 29 * 1440);
  assert.equal(createUptimeWindow("monthly", "2026-04", past).expectedMinutes, 30 * 1440);
  assert.equal(createUptimeWindow("monthly", "2026-01", past).expectedMinutes, 31 * 1440);
});

test("yearly expectations include leap days", () => {
  assert.equal(createUptimeWindow("yearly", "2025", NOW).expectedMinutes, 525600);
  assert.equal(createUptimeWindow("yearly", "2024", NOW).expectedMinutes, 527040);
});

test("current periods count only finished minutes and retain all future rows as pending", () => {
  const window = createUptimeWindow("daily", "2026-10-19", NOW);
  assert.equal(window.expectedMinutes, 750);
  assert.equal(window.pendingMinutes, 690);
  const counts = new Uint32Array(window.expectedMinutes).fill(1);
  const analysis = analyzeUptimeCounts(window, counts);
  assert.equal(analysis.uptimePercent, 100);
  assert.equal(analysis.missingMinutes, 0);
  assert.equal(analysis.buckets[12].expectedMinutes, 30);
  assert.equal(analysis.buckets[13].uptimePercent, null);
});

test("at midnight, zero elapsed minutes produce a pending score rather than 0% or NaN", () => {
  const window = createUptimeWindow("daily", "2026-10-19", new Date("2026-10-18T16:00:00Z"));
  const analysis = analyzeUptimeCounts(window, new Uint32Array(0));
  assert.equal(window.expectedMinutes, 0);
  assert.equal(analysis.uptimePercent, null);
  assert.equal(analysis.health, null);
  assert.equal(analysis.missingMinutes, 0);
});

test("calendar validation rejects malformed, nonexistent, and future periods", () => {
  for (const [period, value] of [
    ["weekly", "2026-10-18"], ["daily", "2026-02-29"], ["daily", "2026-04-31"],
    ["daily", "2026-1-01"], ["monthly", "2026-13"], ["monthly", "2026-00"],
    ["yearly", "0000"], ["yearly", "2027"], ["daily", "2026-10-20"], ["monthly", "2026-11"],
  ]) assert.throws(() => createUptimeWindow(period, value, NOW), UptimeInputError, `${period}: ${value}`);
  assert.throws(() => createUptimeWindow("daily", null, NOW), UptimeInputError);
});

test("health bands classify exact boundaries without rounding a lower band upward", () => {
  for (const [percent, expected] of [
    [100, "Healthy"], [98, "Healthy"], [97.99999, "Good"], [90, "Good"],
    [89.99999, "Fair"], [80, "Fair"], [79.99999, "Poor"], [0, "Poor"], [null, null],
  ] as const) assert.equal(getUptimeHealth(percent), expected);
});

test("duplicates and seconds within a minute count once, invalid and out-of-window records are ignored", () => {
  const window = createUptimeWindow("daily", "2026-10-18", NOW);
  const counts = new Uint32Array(window.expectedMinutes);
  addUptimeTimestamps(counts, window, [
    window.start, "2026-10-17T16:00:59Z", "2026-10-17T16:01:12Z",
    "2026-10-17T15:59:59Z", window.end, "not a timestamp",
  ]);
  const analysis = analyzeUptimeCounts(window, counts);
  assert.equal(analysis.receivedMinutes, 2);
  assert.equal(analysis.missingMinutes, 1438);
  assert.equal(analysis.totalRecords, 3);
  assert.equal(analysis.duplicateRecords, 1);
  assert.equal(analysis.uptimePercent, 2 / 1440 * 100);
  assert.equal(getMinuteRecordCount(analysis.runs, 0), 2);
  assert.equal(getMinuteRecordCount(analysis.runs, 1), 1);
  assert.equal(getMinuteRecordCount(analysis.runs, 1439), 0);
});

test("empty history reports 0% Poor and a missing row for every expected minute", () => {
  const window = createUptimeWindow("daily", "2026-10-18", NOW);
  const analysis = analyzeUptimeCounts(window, new Uint32Array(window.expectedMinutes));
  assert.equal(analysis.uptimePercent, 0);
  assert.equal(analysis.health, "Poor");
  assert.equal(analysis.missingMinutes, 1440);
  assert.deepEqual(analysis.runs, [{ startMinute: 0, endMinute: 1440, recordCount: 0 }]);
});

test("all and status-filtered minute pages preserve row numbers across gaps and pending minutes", () => {
  const window = createUptimeWindow("daily", "2026-10-19", NOW);
  const counts = new Uint32Array(window.expectedMinutes);
  counts[0] = 1; counts[3] = 2;
  const report: UptimeReport = {
    window, station: demoStations[0], source: "demo", environment: "live", ...analyzeUptimeCounts(window, counts),
  };
  assert.deepEqual(getMinutePage(report, "received", 1, 100), { total: 2, minutes: [0, 3] });
  assert.deepEqual(getMinutePage(report, "missing", 1, 3), { total: 748, minutes: [1, 2, 4] });
  assert.deepEqual(getMinutePage(report, "missing", 2, 3), { total: 748, minutes: [5, 6, 7] });
  assert.equal(getMinutePage(report, "all", 15, 100).minutes.length, 40);
  assert.equal(getMinutePage(report, "all", 15, 100).minutes.at(-1), 1439);
  assert.equal(getMinutePage(report, "pending", 1, 100).minutes[0], 750);
  assert.equal(getMinuteStatus(report, 0), "received");
  assert.equal(getMinuteStatus(report, 1), "missing");
  assert.equal(getMinuteStatus(report, 750), "pending");
});

test("annual reports retain all 527,040 rows and correct bucket totals without expanding runs", () => {
  const window = createUptimeWindow("yearly", "2024", NOW);
  const counts = new Uint32Array(window.expectedMinutes).fill(1);
  const analysis = analyzeUptimeCounts(window, counts);
  assert.equal(analysis.receivedMinutes, 527040);
  assert.equal(analysis.buckets.length, 12);
  assert.equal(analysis.buckets[1].expectedMinutes, 29 * 1440);
  assert.equal(analysis.runs.length, 1);
  const report: UptimeReport = { window, station: demoStations[0], source: "demo", environment: "live", ...analysis };
  const lastPage = getMinutePage(report, "all", 5271, 100);
  assert.equal(lastPage.minutes.length, 40);
  assert.equal(formatUptimeMinute(window.start, lastPage.minutes.at(-1)!), "2024-12-31 23:59");
});

test("demo history follows investigation gaps, with duplicate records excluded from uptime", async () => {
  const window = createUptimeWindow("daily", "2026-10-18", NOW);
  const report = await loadStationUptime("station-001", window, { environment: "beta", baseURL: "unused" });
  assert.equal(report.receivedMinutes, 1432);
  assert.equal(report.missingMinutes, 8);
  assert.equal(report.duplicateRecords, 1);
  assert.equal(report.health, "Healthy");
  assert.equal(report.environment, "beta");
  assert.equal(report.source, "demo");
});

test("live loading requests one-minute histories, counts telemetry without depending on sensor values, and rejects failed fetches", async (context) => {
  const window = createUptimeWindow("daily", "2026-10-18", NOW);
  const calls: URL[] = [];
  const fetchMock = context.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(new URL(url));
    return Response.json({ success: true, data: {
      station: { id: "live-001", stationName: "Live station", stationType: "weather", location: [14, 121], city: "Manila", state: "NCR", isActive: true },
      telemetry: [{ id: 1, recordedAt: window.start, temperature: null }, { id: 2, recordedAt: window.end }],
      waterLevel: [{ recordedAt: new Date(Date.parse(window.start) + MINUTE_MS).toISOString() }],
      rainGauge: [{ recordedAt: new Date(Date.parse(window.start) + 2 * MINUTE_MS).toISOString() }],
    } });
  });
  const config = { environment: "live" as const, baseURL: "https://example.test/api", apiToken: "test-token" };
  const report = await loadStationUptime("live-001", window, config);
  assert.equal(report.receivedMinutes, 3);
  assert.equal(report.source, "kloudtrack");
  assert.equal(calls[0].searchParams.get("interval"), "1");
  assert.equal(calls[0].searchParams.get("startDate"), window.start);
  assert.equal(calls[0].searchParams.get("endDate"), new Date(Date.parse(window.end) - 1).toISOString());
  fetchMock.mock.mockImplementation(async () => new Response("Unavailable", { status: 503 }));
  await assert.rejects(() => loadStationUptime("live-001", window, config), /503/);
});

test("monthly fetches use disjoint daily windows with bounded concurrency", async (context) => {
  const window = createUptimeWindow("monthly", "2024-02", NOW);
  let active = 0;
  let maxActive = 0;
  const starts = new Set<string>();
  context.mock.method(globalThis, "fetch", async (url: string) => {
    const params = new URL(url).searchParams;
    active += 1;
    maxActive = Math.max(maxActive, active);
    const start = params.get("startDate")!;
    starts.add(start);
    assert.equal(Date.parse(params.get("endDate")!) - Date.parse(start), 1440 * MINUTE_MS - 1);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return Response.json({ success: true, data: {
      station: { id: "live-001", stationName: "Live station", location: null },
      telemetry: [{ recordedAt: start }],
    } });
  });
  const report = await loadStationUptime("live-001", window, { environment: "live", baseURL: "https://example.test", apiToken: "test-token" });
  assert.equal(starts.size, 29);
  assert.equal(report.receivedMinutes, 29);
  assert.equal(report.window.expectedMinutes, 41760);
  assert.ok(maxActive <= 4);
});

test("a 24-station batch recovers from an upstream rate limit without losing station reports", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const window = createUptimeWindow("daily", "2026-10-18", NOW);
  let calls = 0;
  context.mock.method(globalThis, "fetch", async (url: string) => {
    calls += 1;
    if (calls === 7) {
      return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "2" } });
    }
    const id = new URL(url).pathname.split("/").at(-2)!;
    return Response.json({ success: true, data: {
      station: { id, stationName: id, location: null },
      telemetry: [{ recordedAt: window.start }],
    } });
  });
  const pending = Promise.all(Array.from({ length: 24 }, (_, index) => loadStationUptime(`station-${index}`, window, {
    environment: "live", baseURL: "https://batch.example.test/api", apiToken: "test-token",
  })));
  for (let step = 0; step < 26; step += 1) {
    context.mock.timers.tick(2000);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const reports = await pending;
  assert.equal(calls, 25);
  assert.equal(new Set(reports.map((report) => report.station.id)).size, 24);
  assert.ok(reports.every((report) => report.receivedMinutes === 1 && report.missingMinutes === 1439));
});

test("a failed daily history cancels the remaining queued chunks of a monthly report", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("Unavailable", { status: 503 });
  });
  await assert.rejects(loadStationUptime("station-1", createUptimeWindow("monthly", "2024-02", NOW), {
    environment: "live", baseURL: "https://failed-chunk.example.test", apiToken: "test-token",
  }), /503/);
  context.mock.timers.tick(120_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});
