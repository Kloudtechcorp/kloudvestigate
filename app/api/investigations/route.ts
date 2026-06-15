import { buildAiPrompt, buildInvestigationContext, explainFindings } from "@/lib/ai-context";
import { assertInternalAccess, writeAuditEvent } from "@/lib/auth";
import { generateGeminiAnswer } from "@/lib/gemini";
import {
  canUseServerInvestigationCache,
  readServerBatchInvestigationCache,
  readServerInvestigationCache,
  writeServerInvestigationCache,
} from "@/lib/server-investigation-cache";
import {
  getAllTelemetryHistoryFromKloudtrackApi,
  getTelemetryMetricHistoryFromKloudtrackApi,
  normalizeAllTelemetry,
  normalizeTelemetry,
} from "@/lib/kloudtrack-api";
import {
  resolveKloudtrackConfigFromRequest,
  type KloudtrackEnvironmentConfig,
} from "@/lib/kloudtrack-environment";
import { readMetricRangeOverridesFromCookies } from "@/lib/metric-range-config.server";
import { allMetricKeys, getMetricAnalysisProfile } from "@/lib/metric-profiles";
import { createDemoTelemetry } from "@/lib/mock-telemetry";
import { analyzeTelemetry, defaultWarningLevels, findPointInTime } from "@/lib/telemetry-analysis";
import type {
  InvestigationMetricKey,
  InvestigationSelection,
  MetricKey,
  StationMetadata,
  TelemetryAnalysis,
  TelemetryRecord,
} from "@/lib/telemetry-types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const validMetrics: InvestigationMetricKey[] = [
  "all",
  "temperature",
  "humidity",
  "pressure",
  "heatIndex",
  "windDirection",
  "windSpeed",
  "precipitation",
  "uvIndex",
  "lightIntensity",
];

export async function GET(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  try {
    const metricRangeOverrides = await readMetricRangeOverridesFromCookies();
    const kloudtrackConfig = resolveKloudtrackConfigFromRequest(request);
    const url = new URL(request.url);
    const stationIds = (url.searchParams.get("stationIds") ?? "")
      .split(",")
      .map((stationId) => stationId.trim())
      .filter(Boolean);
    const requestedMetric = url.searchParams.get("metric");
    const aggregationMinutes = Number(url.searchParams.get("aggregationMinutes") ?? 60);
    const selection = parseSelection({
      stationId: stationIds[0] ?? "station-001",
      metric: requestedMetric ? requestedMetric as InvestigationMetricKey : "all",
      start: url.searchParams.get("start") ?? undefined,
      end: url.searchParams.get("end") ?? undefined,
      aggregationMinutes: Number.isFinite(aggregationMinutes) ? aggregationMinutes : 60,
    });

    const resultsByStationId = await readServerBatchInvestigationCache({
      stationIds,
      selection: {
        metric: selection.metric,
        start: selection.start,
        end: selection.end,
        aggregationMinutes: selection.aggregationMinutes,
      },
      variant: buildInvestigationCacheVariant(metricRangeOverrides, kloudtrackConfig.environment),
    });

    return Response.json({
      selection: {
        metric: selection.metric,
        start: selection.start,
        end: selection.end,
        aggregationMinutes: selection.aggregationMinutes,
      },
      resultsByStationId,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Investigation cache lookup failed",
        message: error instanceof Error ? error.message : "Unknown cache lookup error",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const denied = assertInternalAccess(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as Partial<InvestigationSelection> & {
      question?: string;
      pointTimestamp?: string;
      askCopilot?: boolean;
      useDemoData?: boolean;
    };

    const metricRangeOverrides = await readMetricRangeOverridesFromCookies();
    const kloudtrackConfig = resolveKloudtrackConfigFromRequest(request);
    const cacheVariant = buildInvestigationCacheVariant(metricRangeOverrides, kloudtrackConfig.environment);
    const requestedDemoData = body.useDemoData ?? false;
    const askCopilot = body.askCopilot ?? false;
    const selection = parseSelection(body);
    const canUseCache = canUseServerInvestigationCache({
      askCopilot,
      pointTimestamp: body.pointTimestamp,
    });
    const cached = canUseCache
      ? await readServerInvestigationCache(selection, cacheVariant)
      : null;

    if (cached) {
      writeAuditEvent({
        action: "investigation.cache_hit",
        stationId: selection.stationId,
        metric: selection.metric,
        start: selection.start,
        end: selection.end,
      });

      return Response.json(cached);
    }

    const source = await loadTelemetry(selection, requestedDemoData, kloudtrackConfig);
    const aggregatedSource = {
      station: source.station,
      series: source.series.map((item) => ({
        metric: item.metric,
        records: aggregateTelemetryRecords(item.records, selection.start, selection.aggregationMinutes),
      })),
    };
    const metricAnalyses = analyzeMetricSeries(aggregatedSource.series, selection, metricRangeOverrides);
    const primary = metricAnalyses[0];
    if (!primary) throw new Error("No telemetry records were available for the selected metric.");

    const context = buildInvestigationContext(
      source.station,
      primary.metric,
      selection,
      primary.analysis,
      primary.analysis.metricProfile.thresholdDetection === false
        ? defaultWarningLevels
        : primary.analysis.metricProfile.warningLevels ?? defaultWarningLevels,
      primary.records.length,
    );
    const question = body.question || "Summarize the selected telemetry range.";
    const prompt = askCopilot ? buildAiPrompt(context, question) : null;
    const pointMatch = body.pointTimestamp
      ? findPointInTime(primary.records, body.pointTimestamp)
      : null;
    const deterministicAnswer = askCopilot ? explainFindings(context, question) : null;
    const aiResult = prompt && deterministicAnswer
      ? await generateAnswer(prompt, deterministicAnswer)
      : null;

    const payload = {
      selection,
      station: source.station,
      analysis: primary.analysis,
      context,
      prompt,
      pointMatch,
      answer: aiResult?.answer ?? null,
      aiProvider: aiResult?.provider ?? null,
      aiError: aiResult?.error,
      aiWarning: aiResult?.warning,
      aiFinishReason: aiResult?.finishReason,
      records: primary.records,
      metricAnalyses,
      source: requestedDemoData || !kloudtrackConfig.apiToken ? "demo" : "kloudtrack",
      environment: kloudtrackConfig.environment,
    };

    if (canUseCache) {
      await writeServerInvestigationCache(selection, payload, cacheVariant);
    }

    writeAuditEvent({
      action: "investigation.run",
      askCopilot,
      stationId: selection.stationId,
      metric: selection.metric,
      start: selection.start,
      end: selection.end,
      promptTokensEstimated: context.tokenBudget.estimatedTokens,
      aiProvider: aiResult?.provider ?? null,
    });

    return Response.json(payload);
  } catch (error) {
    return Response.json(
      {
        error: "Investigation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }
}

async function generateAnswer(
  prompt: string,
  fallbackAnswer: string,
): Promise<{
  answer: string;
  provider: "gemini" | "deterministic";
  error?: string;
  warning?: string;
  finishReason?: string;
}> {
  if (!process.env.GEMINI_API_KEY) {
    return { answer: fallbackAnswer, provider: "deterministic" };
  }

  try {
    const result = await generateGeminiAnswer(prompt);
    return {
      answer: result.answer,
      provider: "gemini",
      warning: result.warning,
      finishReason: result.finishReason,
    };
  } catch (error) {
    return {
      answer: fallbackAnswer,
      provider: "deterministic",
      error: error instanceof Error ? error.message : "Gemini request failed.",
    };
  }
}

function parseSelection(
  body: Partial<InvestigationSelection>,
): InvestigationSelection {
  const metric: InvestigationMetricKey = body.metric && validMetrics.includes(body.metric)
    ? body.metric
    : "precipitation";
  const end = body.end ? new Date(body.end) : new Date();
  const start = body.start
    ? new Date(body.start)
    : new Date(end.getTime() - 24 * 60 * 60_000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid start or end timestamp.");
  }
  if (start >= end) {
    throw new Error("Start timestamp must be earlier than end timestamp.");
  }

  return {
    stationId: body.stationId || "station-001",
    metric,
    start: start.toISOString(),
    end: end.toISOString(),
    aggregationMinutes: body.aggregationMinutes ?? 60,
  };
}

async function loadTelemetry(
  selection: InvestigationSelection,
  useDemoData: boolean,
  kloudtrackConfig: KloudtrackEnvironmentConfig,
): Promise<{
  station: StationMetadata;
  series: Array<{ metric: MetricKey; records: TelemetryRecord[] }>;
}> {
  if (selection.metric === "all") {
    return loadAllTelemetry(selection, useDemoData, kloudtrackConfig);
  }

  if (useDemoData || !kloudtrackConfig.apiToken) {
    const demo = createDemoTelemetry(
      selection.stationId,
      selection.metric,
      selection.start,
      selection.end,
    );
    return {
      station: demo.station,
      series: [{ metric: selection.metric, records: demo.records }],
    };
  }

  const raw = await getTelemetryMetricHistoryFromKloudtrackApi(
    selection.stationId,
    selection.metric,
    {
      skip: "0",
      interval: selection.aggregationMinutes.toString(),
      startDate: selection.start,
      endDate: selection.end,
    },
    kloudtrackConfig,
  );

  const normalized = normalizeTelemetry(raw);
  return {
    station: normalized.station,
    series: [{ metric: selection.metric, records: normalized.records }],
  };
}

async function loadAllTelemetry(
  selection: InvestigationSelection,
  useDemoData: boolean,
  kloudtrackConfig: KloudtrackEnvironmentConfig,
) {
  if (useDemoData || !kloudtrackConfig.apiToken) {
    const demoSeries = allMetricKeys.map((metric) => {
      const demo = createDemoTelemetry(selection.stationId, metric, selection.start, selection.end);
      return { metric, records: demo.records, station: demo.station };
    });
    return {
      station: demoSeries[0].station,
      series: demoSeries.map(({ metric, records }) => ({ metric, records })),
    };
  }

  const raw = await getAllTelemetryHistoryFromKloudtrackApi(selection.stationId, {
    skip: "0",
    interval: selection.aggregationMinutes.toString(),
    startDate: selection.start,
    endDate: selection.end,
  }, kloudtrackConfig);
  return normalizeAllTelemetry(raw);
}

function buildInvestigationCacheVariant(
  metricRangeOverrides: Record<string, { minimum: number; maximum: number }>,
  environment: KloudtrackEnvironmentConfig["environment"],
) {
  return JSON.stringify({
    environment,
    metricRangeOverrides,
  });
}

function analyzeMetricSeries(
  series: Array<{ metric: MetricKey; records: TelemetryRecord[] }>,
  selection: InvestigationSelection,
  metricRangeOverrides: Record<string, { minimum: number; maximum: number }>,
): Array<{ metric: MetricKey; analysis: TelemetryAnalysis; records: TelemetryRecord[] }> {
  return series.map((item) => ({
    metric: item.metric,
    records: item.records,
    analysis: analyzeTelemetry(item.records, defaultWarningLevels, {
      start: selection.start,
      end: selection.end,
      aggregationMinutes: selection.aggregationMinutes,
      expectedIntervalMinutes: selection.aggregationMinutes,
      metricProfile: getMetricAnalysisProfile(item.metric, metricRangeOverrides),
    }),
  }));
}

function aggregateTelemetryRecords(
  records: TelemetryRecord[],
  start: string,
  aggregationMinutes: number,
): TelemetryRecord[] {
  const startMs = Date.parse(start);
  const bucketMs = aggregationMinutes * 60_000;
  const buckets = new Map<number, TelemetryRecord[]>();

  for (const record of records) {
    const time = Date.parse(record.timestamp);
    if (Number.isNaN(time)) continue;

    const bucketStart = startMs + Math.floor((time - startMs) / bucketMs) * bucketMs;
    const bucketRecords = buckets.get(bucketStart) ?? [];
    bucketRecords.push(record);
    buckets.set(bucketStart, bucketRecords);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketStart, bucketRecords]) => ({
      id: bucketRecords.at(-1)?.id,
      timestamp: new Date(bucketStart).toISOString(),
      value: Number(
        (
          bucketRecords.reduce((sum, record) => sum + record.value, 0) / bucketRecords.length
        ).toFixed(2),
      ),
    }));
}
