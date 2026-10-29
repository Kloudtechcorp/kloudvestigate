import { authorizeCron } from "@/lib/cron-auth";
import { getPrisma } from "@/lib/prisma";
import { invalidateAllAuditReports } from "@/lib/audit-report-cache";
import { getCurrentPhilippineMonthScope } from "@/lib/audit-retention";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const month = getCurrentPhilippineMonthScope();

  try {
    const prisma = getPrisma();
    const deleted = await prisma.stationAuditLog.deleteMany({
      where: {
        OR: [
          { eventDate: { lt: month.start } },
          { eventDate: { gte: month.end } },
        ],
      },
    });

    if (deleted.count > 0) invalidateAllAuditReports();

    return Response.json({
      month: month.key,
      timezone: "Asia/Manila",
      retainedFrom: month.start.toISOString().slice(0, 10),
      retainedBefore: month.end.toISOString().slice(0, 10),
      deletedAuditLogs: deleted.count,
    });
  } catch (error) {
    return Response.json(
      {
        error: "Audit log retention failed",
        message: error instanceof Error ? error.message : "Unknown retention error",
      },
      { status: 500 },
    );
  }
}
