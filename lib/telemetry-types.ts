export type MetricKey =
  | "temperature"
  | "humidity"
  | "pressure"
  | "heatIndex"
  | "windDirection"
  | "windSpeed"
  | "precipitation"
  | "uvIndex"
  | "lightIntensity";

export type InvestigationMetricKey = MetricKey | "all";

export type WarningName = "Normal" | "Advisory" | "Watch" | "Warning" | "Critical";

export interface StationRaw {
  stationName: string;
  stationType: string;
  location: [number, number] | { lat: number; lng: number };
  address: string;
  city: string;
  state: string;
  country: string;
  elevation: number;
  isActive: boolean;
  activatedAt: string | null;
  organizationId: number | null;
  organization: { id: number; organizationName: string } | null;
  id: string;
}

export interface TelemetryMetricRaw {
  id: number;
  recordedAt: string;
  createdAt?: string;
  value?: number;
  temperature?: number;
  humidity?: number;
  pressure?: number;
  heatIndex?: number;
  wind?: {
    direction?: number;
    speed?: number;
  };
  windDirection?: number;
  windSpeed?: number;
  precipitation?: number;
  uvIndex?: number;
  distance?: number;
  calculatedWaterLevel?: number;
  lightIntensity?: number;
}

export interface TelemetryHistoryMetricRaw {
  station: StationRaw;
  telemetry?: TelemetryMetricRaw[];
  waterLevel?: TelemetryMetricRaw[];
  rainGauge?: TelemetryMetricRaw[];
}

export interface StationMetadata {
  id: string;
  name: string;
  type: string;
  location: [number, number] | null;
  city: string;
  state: string;
  organizationName: string | null;
  isActive: boolean;
}

export interface TelemetryRecord {
  id?: number;
  timestamp: string;
  value: number;
}

export interface WarningLevel {
  name: WarningName;
  severity: number;
  minValue: number;
}

export interface InvestigationSelection {
  stationId: string;
  metric: InvestigationMetricKey;
  start: string;
  end: string;
  aggregationMinutes: number;
}

export interface PointMatch {
  requestedTimestamp: string;
  matchedTimestamp: string;
  value: number;
  matchType: "exact" | "nearest";
  deltaMinutes: number;
}

export interface SpikeEvent {
  timestamp: string;
  previousTimestamp: string;
  previousValue: number;
  currentValue: number;
  difference: number;
  limit: number;
}

export interface MetricAnalysisProfile {
  metric: MetricKey;
  label: string;
  unit: string;
  acceptableRange: {
    minimum: number;
    maximum: number;
  };
  spikeDelta: number;
  spikeDetection?: boolean;
  thresholdDetection?: boolean;
  warningLevels?: WarningLevel[];
  flatlineMinutes: number;
}

export interface RangeViolation {
  timestamp: string;
  value: number;
  minimum: number;
  maximum: number;
  direction: "below" | "above";
}

export interface ThresholdCrossing {
  timestamp: string;
  previousLevel: WarningName;
  level: WarningName;
  value: number;
}

export interface MissingPeriod {
  start: string;
  end: string;
  missingCount: number;
}

export interface DuplicateTimestamp {
  timestamp: string;
  count: number;
}

export interface FlatlinePeriod {
  start: string;
  end: string;
  value: number;
  durationMinutes: number;
}

export interface IntervalSummary {
  start: string;
  end: string;
  label: string;
  average: number;
  minimum: number;
  maximum: number;
  firstValue: number;
  lastValue: number;
  recordCount: number;
  missingCount: number;
  trend: "increasing" | "decreasing" | "stable";
  dominantWarningLevel: WarningName;
}

export interface TelemetryAnalysis {
  summary: {
    average: number;
    minimum: number;
    maximum: number;
    firstValue: number;
    lastValue: number;
    latestTimestamp: string | null;
    recordCount: number;
    expectedRecordCount: number;
    missingRecordCount: number;
    trend: "increasing" | "decreasing" | "stable";
    stale: boolean;
  };
  metricProfile: MetricAnalysisProfile;
  intervals: IntervalSummary[];
  spikes: SpikeEvent[];
  rangeViolations: RangeViolation[];
  thresholdCrossings: ThresholdCrossing[];
  missingPeriods: MissingPeriod[];
  duplicateTimestamps: DuplicateTimestamp[];
  flatlinePeriods: FlatlinePeriod[];
  highestReading: TelemetryRecord | null;
  latestReading: TelemetryRecord | null;
}

