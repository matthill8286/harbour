# Harbour — Vehicle Import Platform

TypeScript modular monolith for a Cyprus vehicle-import desk.

The **Import Job** is the operational entity. The **Vehicle** is the physical asset. Customers never see internal costs, suppliers, or private notes.

## Stack

- React + Vite + Tailwind + Zustand + TanStack Query
- NestJS REST API
- PostgreSQL + Prisma (PostGIS-ready)
- Shared domain types in `packages/shared`

## Run locally

```bash
docker compose up -d
cp apps/api/.env.example apps/api/.env
pnpm install
pnpm --filter @vip/shared build
pnpm --filter @vip/api prisma:generate
pnpm --filter @vip/api prisma:push
pnpm --filter @vip/api prisma:seed
pnpm dev
```

You can also start the apps separately so a database issue cannot stop the UI:

```bash
pnpm dev:api
pnpm dev:web
```

## Demo logins

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@demo-imports.local | ChangeMe!Admin1 |
| Staff | staff@demo-imports.local | ChangeMe!Staff1 |
| Customer | customer@example.com | ChangeMe!Customer1 |

Seeded job `CY-2026-00421` is a BMW M5 Competition travelling UK → Bulgaria → Greece → Cyprus.

## Live GPS (Teltonika TAT140 + Flespi)

Demo jobs use a simulated corridor. Real units:

1. Create a Flespi account and a **Teltonika** channel. Point the TAT140-QJIB0 at that host/port ([quick start](https://flespi.com/kb/quick-start-guide-physical-tracker)).
2. Create an HTTP stream to `https://<your-api>/api/integrations/gps/flespi` with header `X-Harbour-Gps-Secret: <secret>` ([stream docs](https://flespi.com/kb/how-to-get-data-in-your-platform-via-flespi-http-stream)).
3. Set `FLESPI_WEBHOOK_SECRET` (required for ingest) and optionally `FLESPI_TOKEN` (staff “Pull from Flespi”).
4. In Harbour, create a tracker with `serialNumber` = IMEI and `provider` = `flespi`, then assign it to the import job.

The customer portal never receives the IMEI. Unassigned pings only update last-seen/battery; job trails start after assign.
