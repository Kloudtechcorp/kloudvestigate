import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  getAllTelemetryHistoryFromKloudtrackApi,
  getDashboardDataFromKloudtrackApi,
  KloudtrackRateLimitError,
} from "./kloudtrack-api";
import type { KloudtrackEnvironmentConfig } from "./kloudtrack-environment";

function config(name: string): KloudtrackEnvironmentConfig {
  return { environment: "live", baseURL: `https://${name}.example.test/api`, apiToken: "test-token" };
}

function success() {
  return Response.json({ success: true, data: { station: { id: "station-1" }, telemetry: [] } });
}

// Flush fetch/JSON promises without advancing the mocked request/cooldown timers.
async function advance(context: TestContext, ms = 0) {
  context.mock.timers.tick(ms);
  await new Promise<void>((resolve) => setImmediate(resolve));
}

for (const headerKind of ["seconds", "date"] as const) {
  test(`429 retries honor Retry-After as ${headerKind}`, async (context) => {
    context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
    const retryAfter = headerKind === "seconds" ? "2" : new Date(Date.now() + 2000).toUTCString();
    let calls = 0;
    context.mock.method(globalThis, "fetch", async () => ++calls === 1
      ? new Response("Rate limited", { status: 429, headers: { "Retry-After": retryAfter } })
      : success());

    const pending = getAllTelemetryHistoryFromKloudtrackApi("station-1", {}, config(headerKind));
    await advance(context);
    assert.equal(calls, 1);
    await advance(context, 1999);
    assert.equal(calls, 1);
    await advance(context, 1);
    assert.deepEqual((await pending).telemetry, []);
    assert.equal(calls, 2);
  });
}

test("missing and invalid Retry-After headers use bounded exponential retries", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    const retryAfter = [undefined, "invalid", "-1"][calls % 3];
    return new Response("Rate limited", { status: 429,
      headers: retryAfter ? { "Retry-After": retryAfter } : {} });
  });
  const pending = getAllTelemetryHistoryFromKloudtrackApi("station-1", {}, config("exhaustion"));
  const rejected = assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof KloudtrackRateLimitError);
    assert.equal(error.retryAfterMs, 80_000);
    assert.match(error.message, /after 4 retries/);
    return true;
  });
  await advance(context);
  for (const [index, wait] of [5000, 10000, 20000, 40000].entries()) {
    await advance(context, wait - 1);
    assert.equal(calls, index + 1);
    await advance(context, 1);
    assert.equal(calls, index + 2);
  }
  await rejected;
  await advance(context, 100_000);
  assert.equal(calls, 5);
});

test("independent API clients share request pacing and a 429 cooldown", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? new Response("Rate limited", { status: 429, headers: { "Retry-After": "2" } })
    : success());
  const upstream = config("shared");
  const history = getAllTelemetryHistoryFromKloudtrackApi("station-1", {}, upstream);
  const dashboard = getDashboardDataFromKloudtrackApi(upstream);
  await advance(context);
  assert.equal(calls, 1);
  await advance(context, 1999);
  assert.equal(calls, 1);
  await advance(context, 1);
  assert.equal(calls, 2);
  await dashboard;
  await advance(context, 349);
  assert.equal(calls, 2);
  await advance(context, 1);
  await history;
  assert.equal(calls, 3);
});

test("different origins and credentials do not share a cooldown", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return success();
  });
  const upstream = config("credentials");
  const pending = [
    getAllTelemetryHistoryFromKloudtrackApi("station-1", {}, upstream),
    getAllTelemetryHistoryFromKloudtrackApi("station-1", {}, { ...upstream, apiToken: "another-token" }),
    getAllTelemetryHistoryFromKloudtrackApi("station-1", {}, config("another-origin")),
  ];
  await advance(context);
  assert.equal(calls, 3);
  await Promise.all(pending);
});

test("cancelling a cooldown stops retries promptly without breaking the shared queue", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? new Response("Rate limited", { status: 429, headers: { "Retry-After": "2" } })
    : success());
  const upstream = config("cancel-cooldown");
  const controller = new AbortController();
  const pending = getAllTelemetryHistoryFromKloudtrackApi("station-1", {}, upstream, controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await advance(context);
  controller.abort();
  await rejected;
  const next = getAllTelemetryHistoryFromKloudtrackApi("station-2", {}, upstream);
  await advance(context, 1999);
  assert.equal(calls, 1);
  await advance(context, 1);
  await next;
  assert.equal(calls, 2);
});

test("cancelling an active request and a queued request prevents further fetches", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let calls = 0;
  context.mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
  });
  const upstream = config("cancel-active");
  const controller = new AbortController();
  const active = getAllTelemetryHistoryFromKloudtrackApi("station-1", {}, upstream, controller.signal);
  const queued = getAllTelemetryHistoryFromKloudtrackApi("station-2", {}, upstream, controller.signal);
  const rejected = Promise.all([
    assert.rejects(active, { name: "AbortError" }),
    assert.rejects(queued, { name: "AbortError" }),
  ]);
  await advance(context);
  assert.equal(calls, 1);
  controller.abort();
  await rejected;
  await advance(context, 120_000);
  assert.equal(calls, 1);
});

test("non-429 errors are not retried and do not break later requests", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? new Response("Unauthorized", { status: 401 }) : success());
  const upstream = config("non-retryable");
  await assert.rejects(getAllTelemetryHistoryFromKloudtrackApi("station-1", {}, upstream), /401/);
  const next = getAllTelemetryHistoryFromKloudtrackApi("station-2", {}, upstream);
  await advance(context, 350);
  await next;
  assert.equal(calls, 2);
});

test("the request timeout still aborts a stalled fetch", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  context.mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  }));
  const pending = getAllTelemetryHistoryFromKloudtrackApi("station-1", {}, config("timeout"));
  const rejected = assert.rejects(pending, /timed out after 120s/);
  await advance(context);
  await advance(context, 120_000);
  await rejected;
});
