import type { MetricAnalysisProfile, MetricKey, WarningLevel } from "./telemetry-types";

export type MetricRangeOverrides = Partial<Record<MetricKey, {
  minimum: number;
  maximum: number;
}>>;

export const allMetricKeys: MetricKey[] = [
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

const normalWarningLevels: WarningLevel[] = [
  { name: "Normal", severity: 0, minValue: Number.NEGATIVE_INFINITY },
];

const heatStressWarningLevels: WarningLevel[] = [
  { name: "Normal", severity: 0, minValue: Number.NEGATIVE_INFINITY },
  { name: "Advisory", severity: 1, minValue: 33 },
  { name: "Watch", severity: 2, minValue: 37 },
  { name: "Warning", severity: 3, minValue: 41 },
  { name: "Critical", severity: 4, minValue: 54 },
];

const rainfallWarningLevels: WarningLevel[] = [
  { name: "Normal", severity: 0, minValue: Number.NEGATIVE_INFINITY },
  { name: "Advisory", severity: 1, minValue: 3 },
  { name: "Watch", severity: 2, minValue: 4 },
  { name: "Warning", severity: 3, minValue: 5 },
  { name: "Critical", severity: 4, minValue: 6 },
];

const uvWarningLevels: WarningLevel[] = [
  { name: "Normal", severity: 0, minValue: Number.NEGATIVE_INFINITY },
  { name: "Advisory", severity: 1, minValue: 3 },
  { name: "Watch", severity: 2, minValue: 6 },
  { name: "Warning", severity: 3, minValue: 8 },
  { name: "Critical", severity: 4, minValue: 11 },
];

const windSpeedWarningLevels: WarningLevel[] = [
  { name: "Normal", severity: 0, minValue: Number.NEGATIVE_INFINITY },
  { name: "Advisory", severity: 1, minValue: 10 },
  { name: "Watch", severity: 2, minValue: 15 },
  { name: "Warning", severity: 3, minValue: 22 },
  { name: "Critical", severity: 4, minValue: 30 },
];

export const metricAnalysisProfiles: Record<MetricKey, MetricAnalysisProfile> = {
  temperature: {
    metric: "temperature",
    label: "Temperature",
    unit: "C",
    acceptableRange: { minimum: 15, maximum: 55 },
    spikeDelta: 3,
    warningLevels: heatStressWarningLevels,
    flatlineMinutes: 45,
  },
  humidity: {
    metric: "humidity",
    label: "Humidity",
    unit: "%",
    acceptableRange: { minimum: 0, maximum: 100 },
    spikeDelta: 12,
    thresholdDetection: false,
    warningLevels: normalWarningLevels,
    flatlineMinutes: 60,
  },
  pressure: {
    metric: "pressure",
    label: "Pressure",
    unit: "hPa",
    acceptableRange: { minimum: 850, maximum: 1100 },
    spikeDelta: 5,
    thresholdDetection: false,
    warningLevels: normalWarningLevels,
    flatlineMinutes: 60,
  },
  heatIndex: {
    metric: "heatIndex",
    label: "Heat index",
    unit: "C",
    acceptableRange: { minimum: 15, maximum: 65 },
    spikeDelta: 3,
    warningLevels: heatStressWarningLevels,
    flatlineMinutes: 45,
  },
  windDirection: {
    metric: "windDirection",
    label: "Wind direction",
    unit: "deg",
    acceptableRange: { minimum: 0, maximum: 360 },
    spikeDelta: 90,
    spikeDetection: false,
    thresholdDetection: false,
    warningLevels: normalWarningLevels,
    flatlineMinutes: 120,
  },
  windSpeed: {
    metric: "windSpeed",
    label: "Wind speed",
    unit: "m/s",
    acceptableRange: { minimum: 0, maximum: 80 },
    spikeDelta: 10,
    warningLevels: windSpeedWarningLevels,
    flatlineMinutes: 45,
  },
  precipitation: {
    metric: "precipitation",
    label: "Precipitation",
    unit: "mm",
    acceptableRange: { minimum: 0, maximum: 100 },
    spikeDelta: 20,
    warningLevels: rainfallWarningLevels,
    flatlineMinutes: 180,
  },
  uvIndex: {
    metric: "uvIndex",
    label: "UV index",
    unit: "index",
    acceptableRange: { minimum: 0, maximum: 11 },
    spikeDelta: 10,
    spikeDetection: false,
    warningLevels: uvWarningLevels,
    flatlineMinutes: 60,
  },
  lightIntensity: {
    metric: "lightIntensity",
    label: "Light intensity",
    unit: "lux",
    acceptableRange: { minimum: 0, maximum: 54612.5 },
    spikeDelta: 30000,
    thresholdDetection: false,
    warningLevels: normalWarningLevels,
    flatlineMinutes: 90,
  },
};

export function getMetricAnalysisProfile(
  metric: MetricKey,
  overrides?: MetricRangeOverrides,
): MetricAnalysisProfile {
  const profile = metricAnalysisProfiles[metric];
  const rangeOverride = overrides?.[metric];

  return rangeOverride
    ? { ...profile, acceptableRange: { ...rangeOverride } }
    : profile;
}

export function getMetricWarningLevels(metric: MetricKey): WarningLevel[] {
  return metricAnalysisProfiles[metric].warningLevels ?? normalWarningLevels;
}
