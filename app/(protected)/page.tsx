import { AuditCalendarWorkspace } from "@/components/audit/AuditCalendarWorkspace";
import { PageShell } from "@/components/layout/PageShell";

type HomePageProps = {
  searchParams: Promise<{
    date?: string | string[];
    month?: string | string[];
    stationId?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const requestedDate = readSingleParam(params.date);
  const requestedMonth = readSingleParam(params.month);
  const stationId = readSingleParam(params.stationId) ?? "";
  const date = isDateKey(requestedDate) ? requestedDate : null;
  const month = date?.slice(0, 7) ?? (isMonthKey(requestedMonth) ? requestedMonth : null);
  const initialDate = date ?? (month ? null : getYesterdayPhtDate());
  const initialMonth = month ?? initialDate!.slice(0, 7);

  return (
    <PageShell
      eyebrow="Daily monitoring"
      title="Audit Log"
      description="Start with yesterday's completed station audit, then load detailed logs only when a finding needs a closer look."
    >
      <AuditCalendarWorkspace
        initialDate={initialDate}
        initialMonth={initialMonth}
        initialStationId={stationId}
      />
    </PageShell>
  );
}

function readSingleParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function isDateKey(value?: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isMonthKey(value?: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
}

function getYesterdayPhtDate() {
  const today = getPhtDateKey(new Date());
  const [year, month, day] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(year, month - 1, day - 1));
  return yesterday.toISOString().slice(0, 10);
}

function getPhtDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}
