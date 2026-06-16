import type { InvestigationSelection } from "@/lib/telemetry-types";

const CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
const CACHE_VERSION = "metric-profile-warning-config-v1";

interface CacheEntry<TPayload> {
  payload: TPayload;
  savedAt: string;
  expiresAtMs: number;
}

class InMemoryCache<TPayload> {
  private entries = new Map<string, CacheEntry<TPayload>>();

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    return {
      ...entry.payload,
      cache: {
        hit: true,
        savedAt: entry.savedAt,
      },
    };
  }

  set(key: string, payload: TPayload) {
    this.entries.set(key, {
      payload,
      savedAt: new Date().toISOString(),
      expiresAtMs: Date.now() + CACHE_TTL_MS,
    });
  }
}

const globalForInvestigationCache = globalThis as unknown as {
  investigationCache?: InMemoryCache<unknown>;
};

const investigationCache =
  globalForInvestigationCache.investigationCache ??
  new InMemoryCache<unknown>();

globalForInvestigationCache.investigationCache = investigationCache;

export async function readServerInvestigationCache<TPayload>(
  selection: InvestigationSelection,
  variant = "",
) {
  return investigationCache.get(getCacheKey(selection, variant)) as
    | (TPayload & { cache: { hit: true; savedAt: string } })
    | null;
}

export async function readServerBatchInvestigationCache<TPayload>({
  stationIds,
  selection,
  variant = "",
}: {
  stationIds: string[];
  selection: Omit<InvestigationSelection, "stationId">;
  variant?: string;
}) {
  const resultsByStationId: Record<string, TPayload & { cache: { hit: true; savedAt: string } }> = {};

  for (const stationId of stationIds) {
    const cached = await readServerInvestigationCache<TPayload>({
      ...selection,
      stationId,
    }, variant);
    if (cached) {
      resultsByStationId[stationId] = cached;
    }
  }

  return resultsByStationId;
}

export async function writeServerInvestigationCache<TPayload>(
  selection: InvestigationSelection,
  payload: TPayload,
  variant = "",
) {
  investigationCache.set(getCacheKey(selection, variant), payload);
}

function getCacheKey(selection: InvestigationSelection, variant = "") {
  return JSON.stringify({
    version: CACHE_VERSION,
    variant,
    stationId: selection.stationId,
    metric: selection.metric,
    start: selection.start,
    end: selection.end,
    aggregationMinutes: selection.aggregationMinutes,
  });
}
