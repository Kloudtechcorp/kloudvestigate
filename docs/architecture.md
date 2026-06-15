# Internal Telemetry AI Copilot Architecture

The canonical compact project map now lives in `docs/project-architecture.json`.
Use that JSON when a future model needs the current setup without rereading the
whole repository. The `/architecture` route imports that file and renders the
server-side and client-side flows as Mermaid diagrams in a focused client
component.

## Processing Flow

1. Operator selects station, metric, time range, and aggregation interval.
2. The dashboard calls `POST /api/investigations`.
3. The server fetches history from KloudTrack API using `x-kloudtrack-key`.
4. Responses are normalized into `{ station, records[] }`.
5. `lib/telemetry-analysis.ts` deterministically computes summaries, gaps, duplicates, spikes, flatlines, thresholds, and interval buckets.
6. `lib/ai-context.ts` builds a compressed JSON payload and prompt.
7. The AI layer explains computed findings only.

## Endpoint Strategy

- Weather metrics: `/telemetry/station/{stationId}/history/{variable}`
- Water level: `/water-level/station/{stationId}/history/calculatedWaterLevel`
- Rain gauge: `/rain-gauge/station/{stationId}/history/mm`

The root `monitorConstant.ts` file documents the upstream API contract and is supported by a local `Endpoint` type so it remains compile-safe.

## Token Strategy

Raw minute arrays are omitted from AI prompts. Context contains interval summaries, significant readings, warning crossings, spikes, missing periods, duplicate timestamps, flatlines, and token estimates.
