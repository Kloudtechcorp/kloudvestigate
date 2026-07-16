import { authorizeCron } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PHT_OFFSET_MS = 8 * 60 * 60_000;

export async function GET(request: Request) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  const month = getCurrentPhilippineMonthScope();

  try {
    const deleted = await prisma.stationAuditLog.deleteMany({
      where: {
        OR: [
          { eventDate: { lt: month.start } },
          { eventDate: { gte: month.end } },
        ],
      },
    });

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

function getCurrentPhilippineMonthScope(now = new Date()) {
  const phtNow = new Date(now.getTime() + PHT_OFFSET_MS);
  const year = phtNow.getUTCFullYear();
  const month = phtNow.getUTCMonth();

  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
}
