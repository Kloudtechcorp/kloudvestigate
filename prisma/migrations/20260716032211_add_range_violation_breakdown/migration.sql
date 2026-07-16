-- AlterTable
ALTER TABLE "DailyStationSummary" ADD COLUMN     "rangeViolationSummary" JSONB NOT NULL DEFAULT '{}';
