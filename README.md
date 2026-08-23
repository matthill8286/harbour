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
