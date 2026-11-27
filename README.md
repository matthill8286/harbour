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

These logins are for local development only. The sign-in page lists them in `pnpm dev`, and a production build leaves them out.

Founding tenant: **Demo Imports Ltd**

| Role     | Email                    | Local password     |
| -------- | ------------------------ | ------------------ |
| Admin    | admin@demo-imports.local | ChangeMe!Admin1    |
| Staff    | staff@demo-imports.local | ChangeMe!Staff1    |
| Customer | customer@example.com     | ChangeMe!Customer1 |

A second tenant (`cyprus-auto-logistics`) is seeded with `owner@cyprus-auto.local` / `ChangeMe!Admin1` so organisation isolation can be exercised.

Admins see **Workspace** in the nav: brand name, timezone, currency, and the internal team. The customer portal shows the importer’s brand, not Harbour’s.

Seeded job `CY-2026-00421` is a BMW M5 Competition travelling UK → Bulgaria → Greece → Cyprus.

### Seeding anywhere else

The passwords above are public. The seed sets them only when `NODE_ENV` is not `production` and `DATABASE_URL` points at `localhost`, `127.0.0.1` or `[::1]`. Anywhere else, including the migrate image on a server, set all three of these variables to private passwords of at least 12 characters:

| Variable                 | Accounts                                              |
| ------------------------ | ----------------------------------------------------- |
| `SEED_ADMIN_PASSWORD`    | `admin@demo-imports.local`, `owner@cyprus-auto.local` |
| `SEED_STAFF_PASSWORD`    | `staff@demo-imports.local`                            |
| `SEED_CUSTOMER_PASSWORD` | `customer@example.com`                                |

If a variable is missing, short or one of the public passwords, the seed stops before it writes anything. When it changes a password, it also ends that account’s open sessions. It does not remove an authenticator that was already set up on an account. It also sets the demo memberships and workspaces back to active.

## Live GPS (Teltonika TAT140 + Flespi)

In the demo workspaces, changing a job's status moves its simulated trail along the corridor. Elsewhere a simulated tracker moves only with **Advance GPS**. Reading a job never changes GPS data.

An IMEI can be registered once on the whole platform. Registering it is only a claim. The unit receives nothing, from the stream or from **Pull from Flespi**, until the platform operator has seen proof that the workspace holds the unit and has confirmed it on the server:

```bash
node dist/src/trackers/confirm-device-owner.js <imei> <workspace-slug>
```

Positions recorded before that confirmation are not delivered. Running the command for another workspace moves the unit to it and disputes the earlier claim, which then receives nothing. If an upgrade finds the same IMEI registered more than once, all of those claims are disputed until the operator confirms an owner. No GPS data is deleted automatically; see [the proposed retention rule](docs/adr/ADR-004-gps-retention.md).

Real units:

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

## Harbour AI

Staff-only helpers via `AiTransport` (`AI_PROVIDER=log|openai`). Never invents GPS, costs, margins, or IMEI; never auto-posts notes; never emails customers.

- Default: `AI_PROVIDER=log` — offline heuristics / templates (no network). Corridor suggest, Board `aiSummary`, and Notes **Draft with AI** still work.
- Optional: `AI_PROVIDER=openai`, set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4o-mini`) for model picks / polished copy. Invalid model ids fall back to heuristics.
- UI: Tracking **Suggest corridor** → review → **Apply**; Board shows enriched ops alerts; Notes → intent → **Draft with AI** fills the body (staff must still **Add note**).

## Planned corridors

Live fleet markers only appear from real GPS pings. Jobs can be assigned one of three curated UK → Bulgaria → Greece corridors (Central / Northern / Southern). Staff switch the corridor on the job’s Tracking tab when traffic or weather changes; the dashed map line follows the assigned template, never a fake vehicle position.

## Vehicle lookup & ANPR

New-job intake can look up a UK plate or scan a photo.

- Default: `VEHICLE_DATA_PROVIDER=mock` and `ANPR_PROVIDER=mock` (seeded `KN19 XPL` / `LF21 TRK`; filename-based plate guess).
- DVLA Vehicle Enquiry: `VEHICLE_DATA_PROVIDER=dvla` + `DVLA_API_KEY`.
- Plate Recognizer OCR: `ANPR_PROVIDER=platerecognizer` + `PLATE_RECOGNIZER_API_KEY` (image bytes are sent; then vehicle data lookup runs on the detected plate).

When `NODE_ENV` is `production`, mock data is shown only in the demo workspaces (`demo-imports` and `cyprus-auto-logistics`). In every other workspace, a lookup without a real provider returns only the typed registration, plate scanning is refused, and the new-job screen says so.

## File uploads

- Job photos, job documents and plate photos are limited to 12 MB, one file per request.
- The API checks that a file’s first bytes match its declared type. It does not scan for malware.
- Each organisation may store up to `STORAGE_ORG_QUOTA_MB` megabytes of files (default 2048).
