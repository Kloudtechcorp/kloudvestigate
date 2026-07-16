import { AuditCalendarWorkspace } from "@/components/audit/AuditCalendarWorkspace";
import { PageShell } from "@/components/layout/PageShell";

export default function AuditPage() {
  return (
    <PageShell
      eyebrow="Historical monitoring"
      title="Station Audit Calendar"
      description="Review daily missing-data and acceptable-range findings from scheduled station investigations."
    >
      <AuditCalendarWorkspace />
    </PageShell>
  );
}
