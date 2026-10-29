// Rebuilds saved audit reports through the running app's /api/audit-reports/run endpoint,
// one day at a time. Existing reports for each rebuilt date are replaced unless --skip-existing is set.
//
//   npx tsx scripts/rebuild-audit.ts --month 2026-09
//   npx tsx scripts/rebuild-audit.ts --from 2025-10-01 --to 2026-10-28 --skip-existing
//   npx tsx scripts/rebuild-audit.ts --date 2026-10-24 --station nDbyYbR1
//
// Options:
//   --skip-existing  Keep stations that already have a report and only fill the gaps.
//   --station <id>   Rebuild only one station.
//   --pause <sec>    Wait between days so KloudTrack is not rate-limited (default 15).
//   --url <url>      App to call (default http://localhost:3000). Uses INTERNAL_ACCESS_TOKEN from .env.
//   --dry-run        List the dates without rebuilding anything.
import "dotenv/config";
import { parseArgs } from "node:util";

const PHT_OFFSET_MS = 8 * 60 * 60_000;

type Failure = { date: string; station: string; message: string };

const { values: options } = parseArgs({
  options: {
    month: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    date: { type: "string" },
    station: { type: "string" },
    pause: { type: "string", default: "15" },
    url: { type: "string", default: "http://localhost:3000" },
    "skip-existing": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const dates = resolveDates();
  const pauseMs = Math.max(Number(options.pause) || 0, 0) * 1000;
  const baseUrl = options.url!.replace(/\/$/, "");
  const scope = options.station ? `station ${options.station}` : "all stations";

  console.log(`Rebuilding ${dates.length} day${dates.length === 1 ? "" : "s"} for ${scope} via ${baseUrl}`);
  console.log(`  ${dates[0]} to ${dates.at(-1)}${options["skip-existing"] ? ", keeping reports that already exist" : ""}`);
  if (options["dry-run"]) return;

  const failures: Failure[] = [];
  for (const [index, date] of dates.entries()) {
    const started = Date.now();
    try {
      const result = await rebuildDate(baseUrl, date, options.station, !options["skip-existing"]);
      failures.push(...result.failures);
      const parts = [
        `${result.counts.saved} saved${result.counts.noData ? ` (${result.counts.noData} with no data)` : ""}`,
        result.counts.kept ? `${result.counts.kept} already saved` : "",
        result.counts.notCreated ? `${result.counts.notCreated} not created yet` : "",
        result.failures.length ? `${result.failures.length} failed` : "",
      ].filter(Boolean);
      console.log(`${date}: ${parts.join(", ")} of ${result.total} (${Math.round((Date.now() - started) / 1000)}s)`);
      for (const failure of result.failures) console.log(`  FAILED ${failure.station}: ${failure.message}`);
      if (result.rateLimited) return stopForRateLimit(date, dates.at(-1)!);
    } catch (error) {
      if (error instanceof RateLimitedError) return stopForRateLimit(date, dates.at(-1)!);
      const message = error instanceof Error ? describeFetchError(error) : String(error);
      failures.push({ date, station: "(whole day)", message });
      console.log(`${date}: ERROR ${message}`);
    }

    if (index < dates.length - 1 && pauseMs) await wait(pauseMs);
  }

  if (!failures.length) {
    console.log("Done with no failures.");
    return;
  }

  console.log(`\nDone with ${failures.length} failure${failures.length === 1 ? "" : "s"}. Retry one with:`);
  const first = failures[0];
  console.log(`  npx tsx scripts/rebuild-audit.ts --date ${first.date}${first.station.startsWith("(") ? "" : ` --station ${first.station.split(" ")[0]}`}`);
  process.exitCode = 1;
}

async function rebuildDate(baseUrl: string, date: string, stationId: string | undefined, replaceExisting: boolean) {
  const token = process.env.INTERNAL_ACCESS_TOKEN?.trim();
  const response = await fetch(`${baseUrl}/api/audit-reports/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
      ...(token ? { "x-internal-access-token": token } : {}),
    },
    body: JSON.stringify({ date, stationId, replaceExisting }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    if (response.status === 429) throw new RateLimitedError();
    throw new Error(`HTTP ${response.status}: ${readMessage(text)}`);
  }

  const stationNames = new Map<string, string>();
  const failures: Failure[] = [];
  const counts = { saved: 0, noData: 0, kept: 0, notCreated: 0 };
  let total = 0;
  let rateLimited = false;

  function handleLine(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as Record<string, unknown>;
    if (typeof event.stationCount === "number") total = event.stationCount;

    if (event.event === "result") {
      const id = String(event.stationId);
      stationNames.set(id, String(event.stationName));
      if (event.status === "stored") counts.kept += 1;
      else if (event.status === "not_created") counts.notCreated += 1;
      else if (event.status !== "failed") counts.saved += 1;
      if (event.status === "no_data") counts.noData += 1;
      if (process.stdout.isTTY) {
        process.stdout.write(`\r  ${date}: ${event.completedCount}/${total} ${String(event.stationName).slice(0, 40).padEnd(40)}`);
      }
    } else if (event.event === "done") {
      rateLimited = event.rateLimited === true;
      for (const report of event.reports as Array<{ stationId: string; status: string; message?: string }>) {
        if (report.status !== "failed") continue;
        failures.push({
          date,
          station: `${report.stationId} (${stationNames.get(report.stationId) ?? "unknown"})`,
          message: report.message ?? "Unknown error",
        });
      }
    } else if (event.event === "error") {
      if (event.rateLimited === true) throw new RateLimitedError();
      throw new Error(String(event.message));
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
      if (done) break;
    }
    handleLine(buffer);
  } finally {
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  }

  return { counts, total, failures, rateLimited };
}

class RateLimitedError extends Error {}

function stopForRateLimit(date: string, lastDate: string) {
  console.log(`\nKloudTrack is rate-limiting requests, so the rebuild stopped at ${date}.`);
  console.log("Wait about 15 minutes, then continue with:");
  console.log(`  npx tsx scripts/rebuild-audit.ts --from ${date} --to ${lastDate} --skip-existing`);
  process.exitCode = 2;
}

function resolveDates() {
  let start: string;
  let end: string;

  if (options.date) {
    start = end = options.date;
  } else if (options.month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(options.month)) throw new Error("--month must use YYYY-MM format.");
    const [year, month] = options.month.split("-").map(Number);
    start = `${options.month}-01`;
    end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  } else if (options.from) {
    start = options.from;
    end = options.to ?? options.from;
  } else {
    throw new Error("Choose the dates with --month YYYY-MM, --from YYYY-MM-DD [--to YYYY-MM-DD], or --date YYYY-MM-DD.");
  }

  for (const value of [start, end]) {
    if (!isDateKey(value)) throw new Error(`Invalid date ${value}. Use YYYY-MM-DD.`);
  }
  if (start > end) throw new Error("The start date must be on or before the end date.");

  // Today's audit is incomplete until the day ends in Philippine time.
  const yesterday = new Date(Date.now() + PHT_OFFSET_MS - 24 * 60 * 60_000).toISOString().slice(0, 10);
  if (start > yesterday) throw new Error(`Nothing to rebuild: the latest complete day is ${yesterday}.`);
  if (end > yesterday) {
    console.log(`Stopping at ${yesterday}, the latest complete day in Philippine time.`);
    end = yesterday;
  }

  const dates: string[] = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += 24 * 60 * 60_000) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function readMessage(text: string) {
  try {
    const payload = JSON.parse(text) as { message?: string; error?: string };
    return payload.message ?? payload.error ?? text;
  } catch {
    return text.slice(0, 200) || "No response body";
  }
}

function describeFetchError(error: Error) {
  const code = (error.cause as { code?: string } | undefined)?.code;
  return code === "ECONNREFUSED"
    ? "Could not reach the app. Start it with npm run dev, or pass --url."
    : error.message;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
