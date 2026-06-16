import type { MetricOption } from "./types";
import { allMetricKeys, getMetricAnalysisProfile } from "@/lib/metric-profiles";

export const metrics: MetricOption[] = [
  { label: "All", value: "all" },
  ...allMetricKeys.map((metric) => ({
    label: getMetricAnalysisProfile(metric).label,
    value: metric,
  })),
];
