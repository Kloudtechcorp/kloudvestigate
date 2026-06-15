# Kloudvestigate

Internal telemetry investigation dashboard for KloudTrack monitoring data.

## What It Does

- Fetches telemetry history from internal KloudTrack API endpoints.
- Runs deterministic analysis for min, max, averages, trends, spikes, threshold crossings, missing records, duplicates, flatlines, and interval summaries.
- Provides an operational dashboard, publication-material table workflow, architecture documentation page, and metric configuration tools.

## Key Routes

- `/` - telemetry investigation dashboard
- `/pubmat` - station aggregate table workflow
- `/architecture` - internal architecture and system design view
- `/api/investigations` - protected investigation API facade

## Internal API Mapping

The upstream API contract is documented in `monitorConstant.ts`.

- Weather variables use `/telemetry/station/{stationId}/history/{variable}`.
- Water level uses `/water-level/station/{stationId}/history/calculatedWaterLevel`.
- Rainfall uses `/rain-gauge/station/{stationId}/history/mm`.

Server-side requests use `KLOUDTRACK_API_BASE_URL` and `KLOUDTRACK_API_TOKEN`; the token is never exposed to the browser.

## Environment

```bash
KLOUDTRACK_API_BASE_URL=https://api.kloudtechsea.com/api/v1
KLOUDTRACK_API_TOKEN=your-kloudtrack-token
KLOUDTRACK_REQUEST_TIMEOUT_MS=120000
INTERNAL_ACCESS_TOKEN=internal-access-token
```

## Development

```bash
npm install
npm run dev
```

The app uses demo telemetry when `KLOUDTRACK_API_TOKEN` is not set.

## Verification

```bash
npm run lint
npm run build
```

## Deployment

```bash
docker compose up --build
```

