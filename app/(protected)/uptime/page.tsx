import { connection } from "next/server";
import { PageShell } from "@/components/layout/PageShell";
import { UptimeWorkspace } from "@/components/uptime/UptimeWorkspace";
import { getPhtDateKey } from "@/lib/station-uptime";

export default async function UptimePage() {
  await connection();
  const now = new Date();
  const yesterday = getPhtDateKey(new Date(now.getTime() - 86_400_000));
  return (
    <PageShell
      eyebrow="Station reliability"
      title="Uptime"
      description="Measure station reliability by the minute. Compare daily, monthly, and yearly availability and inspect every expected reading."
    >
      <UptimeWorkspace initialDate={yesterday} today={getPhtDateKey(now)} />
    </PageShell>
  );
}
