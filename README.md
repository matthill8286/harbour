# Harbour — Vehicle Import Platform

Multi-tenant SaaS for vehicle import, registration and transportation desks.

The first business is a **tenant** of the platform, not the owner of the software. See [ADR-003](docs/adr/ADR-003-multi-tenant-saas.md).

The **Import Job** is the operational entity. The **Vehicle** is the physical asset. Customers never see internal costs, suppliers, or private notes.

## Stack

- React + Vite + Tailwind + Zustand + TanStack Query
- NestJS REST API
- PostgreSQL + Prisma (PostGIS-ready), shared schema with `organisationId` isolation
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

If Prisma cannot add required columns to tables that already have rows:

```bash
pnpm --filter @vip/api prisma:reset
```

That drops the local database, reapplies the schema, and reseeds. Do not pass `--accept-data-loss` to `prisma:seed`.

You can also start the apps separately so a database issue cannot stop the UI:

```bash
pnpm dev:api
pnpm dev:web
```

## Demo logins

Founding tenant: **Demo Imports Ltd**

| Role | Email | Password |
| --- | --- | --- |
| Owner | admin@demo-imports.local | ChangeMe!Admin1 |
| Staff | staff@demo-imports.local | ChangeMe!Staff1 |
| Viewer | viewer@demo-imports.local | ChangeMe!Viewer1 |
| Customer | customer@example.com | ChangeMe!Customer1 |

A second tenant (`cyprus-auto-logistics`) is seeded with `owner@cyprus-auto.local` / `ChangeMe!Admin1` so organisation isolation can be exercised.

Owners and admins see **Workspace** in the nav: brand name, timezone, currency, and the internal team. Viewers can read jobs and GPS but cannot create or move them. The customer portal shows the importer’s brand, not Harbour’s.

Seeded job `CY-2026-00421` is a BMW M5 Competition travelling UK → Bulgaria → Greece → Cyprus.

## Live GPS (Teltonika TAT140 + Flespi)

Demo jobs use a simulated corridor. Real units:

1. Create a Flespi account and a **Teltonika** channel. Point the TAT140-QJIB0 at that host/port ([quick start](https://flespi.com/kb/quick-start-guide-physical-tracker)).
2. Create an HTTP stream to `https://<your-api>/api/integrations/gps/flespi` with header `X-Harbour-Gps-Secret: <secret>` ([stream docs](https://flespi.com/kb/how-to-get-data-in-your-platform-via-flespi-http-stream)).
3. Set `FLESPI_WEBHOOK_SECRET` (required for ingest) and optionally `FLESPI_TOKEN` (staff “Pull from Flespi”).
4. In Harbour, open **Trackers**, register the IMEI with provider Teltonika / Flespi, then **Assign** or **Replace** it on the import job. Do not leave demo tracker `TRK-001` on a job that should use a live TAT140.

The customer portal never receives the IMEI. Unassigned pings only update last-seen/battery; job trails start after assign.

## Customer email

Status changes, customer-visible notes/files, and portal invites go through `NotificationsService`.

- Default: `EMAIL_PROVIDER=log` — writes to the API console (no outbound mail).
- Production: `EMAIL_PROVIDER=resend`, set `RESEND_API_KEY`, and a verified `EMAIL_FROM` address.

Staff still get a copyable invite link after inviting a customer.
