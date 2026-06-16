"use client";

import type { InvestigationMetricKey } from "@/lib/telemetry-types";
import type { MetricOption } from "./types";
import { PubmatQuickFetch } from "./PubmatQuickFetch";

export function PubmatWorkspace({
  autoRun,
  initialIntervalMinutes,
  initialMetric,
  metrics,
}: {
  autoRun: boolean;
  initialIntervalMinutes: number;
  initialMetric: InvestigationMetricKey;
  metrics: MetricOption[];
}) {
  return (
    <PubmatQuickFetch
      autoRun={autoRun}
      initialIntervalMinutes={initialIntervalMinutes}
      initialMetric={initialMetric}
      metrics={metrics}
    />
  );
}
