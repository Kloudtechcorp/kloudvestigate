# Kloud Copilot

Internal AI-assisted telemetry investigation copilot for KloudTrack monitoring data.

## What It Does

- Fetches telemetry history from internal KloudTrack API endpoints.
- Runs deterministic analysis for min, max, averages, trends, spikes, threshold crossings, missing records, duplicates, flatlines, and interval summaries.
- Builds token-aware AI context from computed findings instead of raw minute arrays.
- Provides an operational dashboard, architecture documentation page, and AI request context viewer.

## Key Routes

- `/` - telemetry investigation dashboard
- `/architecture` - internal architecture and system design view
- `/debug/ai-context` - structured AI payload and generated prompt viewer
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
INTERNAL_COPILOT_TOKEN=internal-access-token
```

## Development

```bash
npm install
npm run dev
```

The app uses demo telemetry when `KLOUDTRACK_API_TOKEN` is not set.

## Gemini Flash

Set these values to use Gemini for copilot explanations:

```bash
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
```

The app still computes telemetry findings deterministically first. Gemini receives the compressed investigation context and explains those computed results; if the Gemini request fails, the API falls back to the deterministic local summary.

## Verification

```bash
npm run lint
npm run build
```

## Deployment

```bash
docker compose up --build
```

