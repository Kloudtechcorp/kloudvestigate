import type { KloudtrackEnvironment } from "./kloudtrack-environment";
import type { StationMetadata } from "./telemetry-types";

export const MINUTE_MS = 60_000;
export const PHT_OFFSET_MS = 8 * 60 * MINUTE_MS;
export const UPTIME_TIMEZONE = "Asia/Manila";

export type UptimePeriod = "daily" | "monthly" | "yearly";
export type UptimeHealth = "Healthy" | "Good" | "Fair" | "Poor";
export type MinuteStatus = "received" | "missing" | "pending";

export type UptimeWindow = {
  period: UptimePeriod;
  value: string;
  start: string;
  end: string;
  asOf: string;
  totalMinutes: number;
  expectedMinutes: number;
  pendingMinutes: number;
};

// Runs preserve every minute's reading count without sending half a million rows per year.
export type UptimeRun = {
  startMinute: number;
  endMinute: number;
  recordCount: number;
};

export type UptimeBucket = {
  label: string;
  expectedMinutes: number;
  receivedMinutes: number;
  uptimePercent: number | null;
};

export type UptimeAnalysis = {
  receivedMinutes: number;
  missingMinutes: number;
  duplicateRecords: number;
  totalRecords: number;
  uptimePercent: number | null;
  health: UptimeHealth | null;
  runs: UptimeRun[];
  buckets: UptimeBucket[];
};

export type UptimeReport = UptimeAnalysis & {
  station: StationMetadata;
  window: UptimeWindow;
  source: "demo" | "kloudtrack";
  environment: KloudtrackEnvironment;
};

export class UptimeInputError extends Error {}

export function getPhtDateKey(now = new Date()) {
  return new Date(now.getTime() + PHT_OFFSET_MS).toISOString().slice(0, 10);
}

export function getUptimeHealth(percent: number | null): UptimeHealth | null {
  if (percent === null) return null;
  if (percent >= 98) return "Healthy";
  if (percent >= 90) return "Good";
  if (percent >= 80) return "Fair";
  return "Poor";
}

export function createUptimeWindow(period: unknown, value: unknown, now = new Date()): UptimeWindow {
  if (period !== "daily" && period !== "monthly" && period !== "yearly") {
    throw new UptimeInputError("Choose a daily, monthly, or yearly period.");
  }
  const pattern = period === "daily" ? /^\d{4}-\d{2}-\d{2}$/
    : period === "monthly" ? /^\d{4}-\d{2}$/ : /^\d{4}$/;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new UptimeInputError("Enter a valid date, month, or year for the selected period.");
  }

  const [year, month = 1, day = 1] = value.split("-").map(Number);
  const localStart = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || year > 9998 || localStart.getUTCFullYear() !== year
    || localStart.getUTCMonth() !== month - 1 || localStart.getUTCDate() !== day) {
    throw new UptimeInputError("The selected calendar date is invalid.");
  }
  const startMs = localStart.getTime() - PHT_OFFSET_MS;
  const endMs = (period === "daily" ? Date.UTC(year, month - 1, day + 1)
    : period === "monthly" ? Date.UTC(year, month, 1) : Date.UTC(year + 1, 0, 1)) - PHT_OFFSET_MS;
  if (startMs > now.getTime()) {
    throw new UptimeInputError("Choose a period that has already started.");
  }

  const totalMinutes = (endMs - startMs) / MINUTE_MS;
  // The current, unfinished minute is pending, alongside the rest of the future period.
  const expectedMinutes = Math.max(0, Math.floor((Math.min(now.getTime(), endMs) - startMs) / MINUTE_MS));
  return {
    period,
    value,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    asOf: now.toISOString(),
    totalMinutes,
    expectedMinutes,
    pendingMinutes: totalMinutes - expectedMinutes,
  };
}

export function addUptimeTimestamps(
  counts: Uint32Array,
  window: UptimeWindow,
  timestamps: Iterable<string>,
) {
  const startMs = Date.parse(window.start);
  for (const timestamp of timestamps) {
    const time = Date.parse(timestamp);
    const minute = Math.floor((time - startMs) / MINUTE_MS);
    if (Number.isFinite(time) && minute >= 0 && minute < window.expectedMinutes) {
      counts[minute] += 1;
    }
  }
}

export function analyzeUptimeCounts(window: UptimeWindow, counts: Uint32Array): UptimeAnalysis {
  if (counts.length !== window.expectedMinutes) throw new Error("Minute counts do not match the report window.");
  let receivedMinutes = 0;
  let totalRecords = 0;
  const runs: UptimeRun[] = [];
  const buckets: UptimeBucket[] = [];
  const startMs = Date.parse(window.start);
  let previousBucketKey = "";

  for (let minute = 0; minute < window.totalMinutes; minute += 1) {
    const pht = new Date(startMs + minute * MINUTE_MS + PHT_OFFSET_MS).toISOString();
    const bucketKey = window.period === "daily" ? pht.slice(11, 13)
      : window.period === "monthly" ? pht.slice(0, 10) : pht.slice(0, 7);
    if (bucketKey !== previousBucketKey) {
      buckets.push({
        label: window.period === "daily" ? `${bucketKey}:00` : bucketKey,
        expectedMinutes: 0,
        receivedMinutes: 0,
        uptimePercent: null,
      });
      previousBucketKey = bucketKey;
    }
    if (minute >= window.expectedMinutes) continue;

    const count = counts[minute];
    const bucket = buckets[buckets.length - 1];
    bucket.expectedMinutes += 1;
    if (count > 0) {
      receivedMinutes += 1;
      bucket.receivedMinutes += 1;
    }
    totalRecords += count;
    const last = runs[runs.length - 1];
    if (last && last.recordCount === count) last.endMinute = minute + 1;
    else runs.push({ startMinute: minute, endMinute: minute + 1, recordCount: count });
  }

  const uptimePercent = window.expectedMinutes > 0 ? receivedMinutes / window.expectedMinutes * 100 : null;
  return {
    receivedMinutes,
    missingMinutes: window.expectedMinutes - receivedMinutes,
    duplicateRecords: totalRecords - receivedMinutes,
    totalRecords,
    uptimePercent,
    health: getUptimeHealth(uptimePercent),
    runs,
    buckets: buckets.map((bucket) => ({
      ...bucket,
      uptimePercent: bucket.expectedMinutes > 0 ? bucket.receivedMinutes / bucket.expectedMinutes * 100 : null,
    })),
  };
}

export function getMinuteRecordCount(runs: UptimeRun[], minute: number) {
  let low = 0;
  let high = runs.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const run = runs[middle];
    if (minute < run.startMinute) high = middle - 1;
    else if (minute >= run.endMinute) low = middle + 1;
    else return run.recordCount;
  }
  return 0;
}

export function getMinuteStatus(report: UptimeReport, minute: number): MinuteStatus {
  if (minute >= report.window.expectedMinutes) return "pending";
  return getMinuteRecordCount(report.runs, minute) > 0 ? "received" : "missing";
}

export function formatUptimeMinute(start: string, minute: number) {
  return new Date(Date.parse(start) + minute * MINUTE_MS + PHT_OFFSET_MS)
    .toISOString().slice(0, 16).replace("T", " ");
}

export function getMinutePage(report: UptimeReport, status: MinuteStatus | "all", page: number, pageSize: number) {
  const ranges = status === "all" ? [{ startMinute: 0, endMinute: report.window.totalMinutes }]
    : status === "pending" ? [{ startMinute: report.window.expectedMinutes, endMinute: report.window.totalMinutes }]
      : report.runs.filter((run) => status === "received" ? run.recordCount > 0 : run.recordCount === 0);
  const total = ranges.reduce((sum, range) => sum + range.endMinute - range.startMinute, 0);
  let skip = (page - 1) * pageSize;
  const minutes: number[] = [];
  for (const range of ranges) {
    const length = range.endMinute - range.startMinute;
    if (skip >= length) { skip -= length; continue; }
    for (let minute = range.startMinute + skip; minute < range.endMinute && minutes.length < pageSize; minute += 1) {
      minutes.push(minute);
    }
    skip = 0;
    if (minutes.length >= pageSize) break;
  }
  return { total, minutes };
}
