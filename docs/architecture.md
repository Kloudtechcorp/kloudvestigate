# Kloudvestigate Architecture

The canonical compact project map now lives in `docs/project-architecture.json`.
Use that JSON when a future model needs the current setup without rereading the
whole repository. The `/architecture` route imports that file and renders the
server-side and client-side flows as Mermaid diagrams in a focused client
component.

## Daily Audit Flow

1. The audit calendar requests one month from `GET /api/audit-reports`.
2. The response includes calendar totals and the underlying per-station summaries, allowing date navigation without another summary request.
3. Detailed `StationAuditLog` rows are requested separately only when an operator opens detailed audits.
4. Manual rebuilds use `POST /api/audit-reports/run`; the daily cron calls the same `runDailyStationInvestigations` service.
5. Each station investigation stores a `DailyStationSummary` and related `StationAuditLog` records transactionally through Prisma.
6. Successful writes immediately expire the affected date and month cache tags. Audit-log retention expires the global audit cache when it deletes rows.

Audit report cache keys distinguish month or date, optional station scope, and summary-only or detail-bearing responses. Entries have a five-minute fallback revalidation interval in addition to write-driven invalidation.

## Processing Flow

1. Operator selects station, metric, time range, and aggregation interval.
2. The dashboard calls `POST /api/investigations`.
3. The server fetches history from KloudTrack API using `x-kloudtrack-key`.
4. Responses are normalized into `{ station, records[] }`.
5. `lib/telemetry-analysis.ts` deterministically computes summaries, gaps, duplicates, spikes, flatlines, thresholds, and interval buckets.
6. The route returns computed summaries, event lists, interval buckets, and fetched records to the dashboard.

## Endpoint Strategy

- Weather metrics: `/telemetry/station/{stationId}/history/{variable}`
- Water level: `/water-level/station/{stationId}/history/calculatedWaterLevel`
- Rain gauge: `/rain-gauge/station/{stationId}/history/mm`

The root `monitorConstant.ts` file documents the upstream API contract and is supported by a local `Endpoint` type so it remains compile-safe.

## Response Strategy

The API returns deterministic telemetry findings and the records needed by the dashboard. External provider calls are not part of the investigation flow.
