import { PubmatWorkspace } from "@/components/telemetry/PubmatWorkspace";
import { PageShell } from "@/components/layout/PageShell";
import { metrics } from "@/components/telemetry/constants";
import { allMetricKeys } from "@/lib/metric-profiles";
import type { InvestigationMetricKey, MetricKey } from "@/lib/telemetry-types";

type PubmatPageProps = {
  searchParams: Promise<{ metric?: string; interval?: string; run?: string }>;
};

export default async function PubmatPage({ searchParams }: PubmatPageProps) {
  const params = await searchParams;
  const initialMetric = parseMetric(params.metric);
  const initialIntervalMinutes = parseInterval(params.interval);
  const autoRun = params.run === "1" || params.run === "true";

  return (
    <PageShell
      eyebrow="Pubmat data prep"
      title="Daily Readings"
      maxWidth="standard"
    >
      <PubmatWorkspace
        autoRun={autoRun}
        initialIntervalMinutes={initialIntervalMinutes}
        initialMetric={initialMetric}
        metrics={metrics}
      />
    </PageShell>
  );
}

function parseMetric(value?: string): InvestigationMetricKey {
  if (value === "all") return "all";
  return allMetricKeys.includes(value as MetricKey)
    ? value as InvestigationMetricKey
    : "temperature";
}

function parseInterval(value?: string) {
  const interval = Number(value);
  return Number.isFinite(interval) && interval > 0 ? interval : 60;
}
