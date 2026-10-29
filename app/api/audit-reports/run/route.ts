import { assertInternalAccess } from "@/lib/auth";
import {
  AuditRateLimitError,
  getPhilippineDayScope,
  runDailyStationInvestigations,
} from "@/lib/daily-station-investigations";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as { date?: unknown; stationId?: unknown; replaceExisting?: unknown };
    const date = typeof body.date === "string" ? body.date : "";
    const stationId = typeof body.stationId === "string" && body.stationId.trim()
      ? body.stationId.trim()
      : undefined;
    // Backfills pass false to fill only stations without a saved report for the date.
    const replaceExisting = body.replaceExisting !== false;
    if (!getPhilippineDayScope(date)) {
      return Response.json({ error: "Invalid date", message: "Date must use YYYY-MM-DD format." }, { status: 400 });
    }

    if (request.headers.get("accept")?.includes("application/x-ndjson")) {
      return streamRebuild(request, date, stationId, replaceExisting);
    }

    return Response.json(await runDailyStationInvestigations({
      requestUrl: request.url,
      dateKey: date,
      stationId,
      replaceExisting,
    }));
  } catch (error) {
    const rateLimited = error instanceof AuditRateLimitError;
    return Response.json(
      {
        error: "Manual audit rebuild failed",
        message: error instanceof Error ? error.message : "Unknown rebuild error",
        ...(rateLimited ? { code: "rate_limited", retryAfterMs: error.retryAfterMs } : {}),
      },
      { status: rateLimited ? 429 : 500 },
    );
  }
}

function streamRebuild(request: Request, date: string, stationId: string | undefined, replaceExisting: boolean) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify({ event, ...payload })}\n`));
      };

      try {
        const result = await runDailyStationInvestigations({
          requestUrl: request.url,
          dateKey: date,
          stationId,
          replaceExisting,
          onInit: ({ stationCount }) => send("init", { stationCount }),
          onStationStart: (progress) => send("station_start", progress),
          onStationComplete: (progress) => send("result", progress),
        });
        send("done", {
          stationCount: result.stationCount,
          rateLimited: result.rateLimited,
          retryAfterMs: result.retryAfterMs,
          reports: result.reports,
        });
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : "Unknown rebuild error",
          rateLimited: error instanceof AuditRateLimitError,
          retryAfterMs: error instanceof AuditRateLimitError ? error.retryAfterMs : null,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
    },
  });
}
