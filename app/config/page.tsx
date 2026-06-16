import { MetricRangeConfigPanel } from "@/components/metric-config/MetricRangeConfigPanel";
import { PageShell } from "@/components/layout/PageShell";
import { readMetricRangeOverridesFromCookies } from "@/lib/metric-range-config.server";
import { allMetricKeys, getMetricAnalysisProfile } from "@/lib/metric-profiles";

export default async function ConfigPage() {
  const initialOverrides = await readMetricRangeOverridesFromCookies();
  const metrics = allMetricKeys.map((metric) => {
    const profile = getMetricAnalysisProfile(metric);

    return {
      metric,
      label: profile.label,
      unit: profile.unit,
      defaultRange: profile.acceptableRange,
    };
  });

  return (
    <PageShell
      eyebrow="Configuration"
      title="Metric Range Settings"
      maxWidth="narrow"
      description={(
        <>
          Each metric starts from the range defined in <span className="font-mono">lib/metric-profiles.ts</span> and can be overridden here.
          Saved overrides apply to investigation analysis and pubmat classification.
        </>
      )}
    >
      <MetricRangeConfigPanel initialOverrides={initialOverrides} metrics={metrics} />
    </PageShell>
  );
}
