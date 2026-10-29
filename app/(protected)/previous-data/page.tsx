import { connection } from "next/server";
import { PreviousDataWorkspace } from "@/components/audit/PreviousDataWorkspace";
import { PageShell } from "@/components/layout/PageShell";
import { getPhtDateKey } from "@/lib/station-uptime";

// The first KloudTrack station started reporting in October 2025.
const EARLIEST_AUDIT_DATE = "2025-10-01";

export default async function PreviousDataPage() {
  await connection();
  const now = new Date();
  const yesterday = getPhtDateKey(new Date(now.getTime() - 86_400_000));

  return (
    <PageShell
      eyebrow="Audit history"
      title="Add Previous Data"
      description="Fill in past audit reports from KloudTrack readings. It runs one day at a time and stops by itself if KloudTrack starts rate-limiting, so you can resume later."
    >
      <PreviousDataWorkspace earliestDate={EARLIEST_AUDIT_DATE} latestDate={yesterday} />
    </PageShell>
  );
}
