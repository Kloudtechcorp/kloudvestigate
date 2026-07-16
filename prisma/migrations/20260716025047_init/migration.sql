-- CreateEnum
CREATE TYPE "AuditType" AS ENUM ('rangeViolation', 'missing');

-- CreateTable
CREATE TABLE "DailyStationSummary" (
    "id" BIGSERIAL NOT NULL,
    "stationId" TEXT NOT NULL,
    "stationName" TEXT,
    "summaryDate" DATE NOT NULL,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "rangeViolationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyStationSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationAuditLog" (
    "id" BIGSERIAL NOT NULL,
    "summaryId" BIGINT NOT NULL,
    "type" "AuditType" NOT NULL,
    "eventDate" DATE NOT NULL,
    "rowContents" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyStationSummary_summaryDate_idx" ON "DailyStationSummary"("summaryDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStationSummary_stationId_summaryDate_key" ON "DailyStationSummary"("stationId", "summaryDate");

-- CreateIndex
CREATE INDEX "StationAuditLog_summaryId_type_idx" ON "StationAuditLog"("summaryId", "type");

-- CreateIndex
CREATE INDEX "StationAuditLog_eventDate_idx" ON "StationAuditLog"("eventDate");

-- AddForeignKey
ALTER TABLE "StationAuditLog" ADD CONSTRAINT "StationAuditLog_summaryId_fkey" FOREIGN KEY ("summaryId") REFERENCES "DailyStationSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
