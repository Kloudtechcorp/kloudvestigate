import type {
  InvestigationSelection,
  InvestigationMetricKey,
  MetricKey,
  PointMatch,
  StationMetadata,
  TelemetryAnalysis,
  TelemetryRecord,
} from "@/lib/telemetry-types";

export type SortKey = "timestamp" | "value" | "id";

export type SortDirection = "asc" | "desc";

export type SourceKind = "demo" | "kloudtrack";

export interface MetricOption {
  label: string;
  value: InvestigationMetricKey;
}

export interface MetricInvestigationAnalysis {
  metric: MetricKey;
  analysis: TelemetryAnalysis;
  records: TelemetryRecord[];
}

export interface StationsResponse {
  stations: StationMetadata[];
  source: SourceKind;
  reason?: string;
  error?: string;
  message?: string;
}

export interface InvestigationResponse {
  selection: InvestigationSelection;
  station: StationMetadata;
  analysis: TelemetryAnalysis;
  pointMatch: PointMatch | null;
  records: TelemetryRecord[];
  metricAnalyses?: MetricInvestigationAnalysis[];
  source: SourceKind;
  cache?: {
    hit: boolean;
    savedAt?: string;
  };
}

export interface InvestigationBatchCacheResponse {
  selection: Omit<InvestigationSelection, "stationId">;
  resultsByStationId: Record<string, InvestigationResponse>;
}

export type PubmatQuickFetchStatus = "ready" | "attention" | "missing" | "failed";

export interface PubmatBucketWindow {
  bucketStart: string;
  bucketEnd: string;
  fetchStart: string;
  fetchEnd: string;
}

export interface PubmatQuickFetchResult {
  station: StationMetadata;
  status: PubmatQuickFetchStatus;
  values: Partial<Record<MetricKey, number>>;
  classifications: string[];
  error?: string;
}

export interface PubmatQuickFetchResponse {
  selection: {
    metric: InvestigationMetricKey;
    intervalMinutes: number;
    requestGapMs: number;
    selectedMetricKeys: MetricKey[];
    timestamp: string;
  };
  window: PubmatBucketWindow;
  source: SourceKind;
  stationCount: number;
  results: PubmatQuickFetchResult[];
}
