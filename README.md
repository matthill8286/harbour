# Harbour — Vehicle Import Platform

Multi-tenant SaaS for vehicle import, registration and transportation desks.

The first business is a **tenant** of the platform, not the owner of the software. See [ADR-003](docs/adr/ADR-003-multi-tenant-saas.md).

The **Import Job** is the operational entity. The **Vehicle** is the physical asset. Customers never see internal notes, suppliers, or private files.

## V1 scope

This `v1` branch is the sellable first product: login, board, jobs (list / new / file), customers, workspace branding, and the branded owner portal.

**In V1**

- Staff: Board, Jobs, Customers, Workspace (name, timezone, currency)
- Job file: status, tasks, journeys, notes, files, activity
- New job: customer + typed UK plate lookup
- Owner portal: vehicle, journey, files, updates

**Not in V1** (APIs and schema stay so these can be wired back as paid features)

- Live GPS / Flespi / fleet map / trackers
- AI drafts / corridor suggest / board GPS alerts
- ANPR plate-photo scan
- Costs, charges, and margin
- Staff invite and role-management UI

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

Owners and admins see **Workspace** in the nav: brand name, timezone, and currency. Viewers can read jobs but cannot create or move them. The customer portal shows the importer’s brand, not Harbour’s.

Seeded job `CY-2026-00421` is a BMW M5 Competition travelling UK → Bulgaria → Greece → Cyprus.

## Customer email

Status changes, customer-visible notes/files, and portal invites go through `NotificationsService`.

- Default: `EMAIL_PROVIDER=log` — writes to the API console (no outbound mail).
- Production: `EMAIL_PROVIDER=resend`, set `RESEND_API_KEY`, and a verified `EMAIL_FROM` address.

Staff still get a copyable invite link after inviting a customer.

## Vehicle lookup

New-job intake looks up a UK plate.

- Default: `VEHICLE_DATA_PROVIDER=mock` (seeded `KN19 XPL` / `LF21 TRK`).
- DVLA Vehicle Enquiry: `VEHICLE_DATA_PROVIDER=dvla` + `DVLA_API_KEY`.
