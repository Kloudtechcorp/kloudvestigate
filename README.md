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
- `/uptime` - daily, monthly, and yearly station reliability with station/health filters and minute logs
- `/api/investigations` - protected investigation API facade

## Internal API Mapping

The upstream API contract is documented in `monitorConstant.ts`.

- Weather variables use `/telemetry/station/{stationId}/history/{variable}`.
- Water level uses `/water-level/station/{stationId}/history/calculatedWaterLevel`.
- Metric history uses `/telemetry/station/{stationId}/history/{metric}`.

Server-side requests use `KLOUDTRACK_API_BASE_URL` and `KLOUDTRACK_API_TOKEN`; the token is never exposed to the browser.

## Environment

```bash
KLOUDTRACK_API_BASE_URL=https://api.kloudtechsea.com/api/v1
KLOUDTRACK_API_TOKEN=your-kloudtrack-token
KLOUDTRACK_REQUEST_TIMEOUT_MS=120000
KLOUDTRACK_REQUEST_GAP_MS=350
INTERNAL_ACCESS_TOKEN=internal-access-token
```

## Development

Run these commands from the `kloudvestigate` application directory:

```bash
npm install
npm run dev
```

The parent `Demo_kloudvestigate` workspace also supports `npm install` and `npm run dev`; installation installs this application's dependencies, and the dev command starts this application. In PowerShell environments that block `npm.ps1`, use `npm.cmd` in place of `npm`.

The app uses demo telemetry when `KLOUDTRACK_API_TOKEN` is not set.

### Audit database

Audit reports, rebuilds, and audit cron jobs require PostgreSQL, including when telemetry uses demo data. Set `DATABASE_URL` in `kloudvestigate/.env` to your database connection string:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
# Optional direct connection for migrations when DATABASE_URL uses a pooler:
DIRECT_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
```

From the application directory, generate the client and apply the existing migrations:

```bash
npm run prisma:generate
npx prisma migrate deploy
```

Restart the development server after changing `.env`. The app uses `DATABASE_URL` at runtime; migration commands prefer `DIRECT_URL` and fall back to `DATABASE_URL`. Without `DATABASE_URL`, audit requests return a configuration error, while telemetry investigation and uptime can run independently.

KloudTrack requests in the same server process share a queue per API origin and token, with a minimum 350 ms gap after each request. Set `KLOUDTRACK_REQUEST_GAP_MS` higher if your upstream quota requires slower requests. HTTP 429 responses pause that queue using `Retry-After` (seconds or an HTTP date), with up to four retries. Without a usable header, retries wait 5, 10, 20, then 40 seconds. Stopping an uptime computation cancels its queued and active history requests. **Retry failed stations** keeps successful reports and requests only failed stations. Separate server instances do not share this in-memory queue.

## Verification

The Uptime tab measures **unique minutes with telemetry / expected elapsed minutes × 100** at a fixed one-minute cadence. A completed Philippine day has 1,440 rows; months use their actual calendar length, and years have 525,600 rows (527,040 in a leap year). Duplicate readings in a minute count once. Current and future minutes in an ongoing period are pending and excluded from the score. Dates and exported minute logs use `Asia/Manila`.

Health bands: **Healthy ≥ 98%**, **Good ≥ 90% and < 98%**, **Fair ≥ 80% and < 90%**, **Poor < 80%**. Empty completed histories are 0% uptime; failed API requests are shown as errors and excluded from scores. Demo scores are explicitly labeled when the selected Live/Beta environment has no API token. Minute logs are paginated, and **Export full CSV** includes every minute in the selected station's period, regardless of the minute-status filter.

```bash
npm run test:uptime
npm run lint
npm run build
```

## Deployment

```bash
docker compose up --build
```

