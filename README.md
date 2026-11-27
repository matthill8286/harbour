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

Positions recorded before that confirmation are not delivered. Running the command for another workspace moves the unit to it and disputes the earlier claim, which then receives nothing. If an upgrade finds the same IMEI registered more than once, all of those claims are disputed until the operator confirms an owner. Raw GPS points are deleted 90 days after their job is completed or cancelled, or 90 days after they were recorded if they are on no job. `GPS_RETENTION_DAYS` changes the period. See [the retention rule](docs/adr/ADR-004-gps-retention.md).

Real units:

1. Create a Flespi account and a **Teltonika** channel. Point the TAT140-QJIB0 at that host/port ([quick start](https://flespi.com/kb/quick-start-guide-physical-tracker)).
2. Create an HTTP stream to `https://<your-api>/api/integrations/gps/flespi` with header `X-Harbour-Gps-Secret: <secret>` ([stream docs](https://flespi.com/kb/how-to-get-data-in-your-platform-via-flespi-http-stream)).
3. Set `FLESPI_WEBHOOK_SECRET` (required for ingest) and optionally `FLESPI_TOKEN` (staff “Pull from Flespi”).
4. In Harbour, open **Trackers**, register the IMEI with provider Teltonika / Flespi, then **Assign** or **Replace** it on the import job. Do not leave demo tracker `TRK-001` on a job that should use a live TAT140.

The customer portal never receives the IMEI. Unassigned pings only update last-seen/battery; job trails start after assign.

## Platform operator, suspending a workspace and plans

The platform operator is not a role anyone can get through the app. No HTTP
route grants it, suspends a workspace or restores one. All of it is done with a
command run in the api container, by someone who can already run commands on the
server:

```sh
node dist/src/platform/operator.js grant <email>
node dist/src/platform/operator.js revoke <email>
node dist/src/platform/operator.js list
node dist/src/platform/operator.js suspend <workspace-slug> --by <operator email> --reason "<why>"
node dist/src/platform/operator.js restore <workspace-slug> --by <operator email> --reason "<why>"
```

- `grant` works only for an account that already exists, has a password and has
  two-factor sign-in on. It creates no account and sets no password. Use an
  account kept for this, not one used for daily work in a workspace.
- `--by` records who acted. It is not a sign-in.
- Suspension blocks sign-in, the API, email sent for the workspace and GPS
  intake. It deletes nothing. GPS positions recorded while a workspace was
  suspended are not saved, even if the gateway sends them later. The usual GPS
  retention period still applies to positions saved earlier. A person's own
  password reset email is still sent, because the account is theirs.
- Every grant, revocation, suspension and restore is kept in
  `PlatformAuditLog`, and each suspension in `WorkspaceSuspension`.

A person who belongs to more than one workspace can switch from the account
menu. A session belongs to one workspace. Switching asks for a fresh two-factor
code, and the new session ends when the old one would have.

Plan rules are in `apps/api/src/tenancy/plan-policy.ts`. **No limit is set.** A
lapsed plan (`PAST_DUE`, `SUSPENDED` or `CANCELLED`) restricts nothing unless
`Subscription.readOnlyFrom`, the end of its notice period, is set and has
passed. The workspace can then be read and exported, but not changed. Nothing
sets that date yet. Feature flags are stored and shown, but not enforced.

## Customer data: export and erasure

An Admin can do both from the customer record. The rules are cautious defaults,
**not legal advice**. They are in `apps/api/src/privacy/erasure-rules.ts`.

- **Export** is a ZIP with `data.json` and the customer's files. Staff are not
  named. Pictures are the copies without metadata.
- **Erase** shows a preview, then asks for the password and a two-factor code.
  It is blocked while the customer has an open job. It cannot be undone.

| What                                                                                 | What erasure does                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Name, contact details, internal notes on the record                                  | Removed. The empty record stays, for its jobs                      |
| Notes, GPS positions, portal access and invites                                      | Deleted                                                            |
| Task text, journey places, status notes, audit details                               | Replaced or cleared                                                |
| The customer's own documents (`CUSTOMER`)                                            | Deleted, with every copy                                           |
| Photos: before collection, collection, arrival, final                                | Deleted, with every copy                                           |
| Documents: purchase invoice, customs, import, registration, transport                | Kept, renamed, hidden from sharing                                 |
| Documents: V5C, inspection, other. Photos: damage, mileage, VIN, registration, other | Kept and flagged for review                                        |
| Jobs, vehicles, VINs, registrations, costs, customer charges                         | Kept. A cost or charge whose text names the customer is flagged    |
| Sign-in account                                                                      | Deleted only if nothing else uses it. Otherwise not changed at all |

Nothing expires by itself. Kept files are not changed inside, so an invoice still
shows what is printed on it.

### After a database restore

A restored dump can bring erased customers back. Each erasure is also written to
`.erasure-journal/journal.jsonl` on the uploads volume. It holds ids and storage
keys only.

1. Before you restore anything, copy the journal somewhere safe. If you also
   restore the uploads, use the **newest** journal you have, not the one from the
   snapshot you are restoring.
2. Restore the database, and keep the api stopped. If the dump is older than the
   running release, apply its schema first.
3. In the api image, with the uploads volume mounted, look and then apply:

   ```sh
   node dist/src/privacy/erasures.js apply --journal <newest journal>
   node dist/src/privacy/erasures.js apply --journal <newest journal> --confirm
   ```

4. Start the api. Leave out `--journal` to use the one on the volume.

If the server is lost, erasures made after the last offsite backup are only known
if the journal was copied elsewhere.

## Customer email

Status changes, customer-visible notes/files, and portal invites go through `NotificationsService`.

- Default: `EMAIL_PROVIDER=log` — writes to the API console (no outbound mail).
- Production: `EMAIL_PROVIDER=brevo` with `BREVO_API_KEY`, or `resend` with `RESEND_API_KEY`, and a verified `EMAIL_FROM` address. Without a provider, production sends nothing and says so, so sign-up and invites do not work.
- Harbour sends at most `EMAIL_DAILY_LIMIT` emails a day (default 200).

Staff and portal invites go to the invitee's email only. The person inviting sees whether the email went. A copyable link appears only in local development with `EMAIL_PROVIDER=log`.

Sign-up is open and creates nothing until the person opens the emailed link and chooses a password. Sign-in, two-factor, sign-up, password reset and invite routes are rate limited (`apps/api/src/rate-limit/policies.ts`). The counts are held in memory, so they assume one API process and start again after a restart.

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
- Staff can delete a wrongly uploaded photo or document. The deletion appears in the job's activity.
- File names are kept in any language.
- The API checks that a file’s first bytes match its declared type. It does not scan for malware.
- Each organisation may store up to `STORAGE_ORG_QUOTA_MB` megabytes of files (default 2048).
- All organisations together may store up to `STORAGE_TOTAL_QUOTA_MB` (default 20480). Uploads also stop before the disk has less than `STORAGE_MIN_FREE_MB` free (default 10240). The API logs a warning when either limit refuses a file.
- [Malware scanning](docs/malware-scanning.md) is a proposal. It is not built.

### Photos and their metadata

- A photo is stored exactly as uploaded. Beside it, the API makes a JPEG for viewing (up to 2560 pixels) and a thumbnail (up to 640 pixels). HEIC photos can therefore be viewed in every browser.
- These copies carry no location, camera, owner or capture time. Colours are converted to standard sRGB where the file's profile allows it. HEIC colour profiles are not read.
- The customer portal only ever sends copies. A JPEG, PNG, WebP, HEIC or single-page TIFF that was uploaded as a document is also sent to customers as a copy without metadata. A TIFF with several pages is not sent to customers; share it as a PDF.
- PDF and Word files are sent unchanged, including any metadata and pictures inside them.
- Photos stored before copies existed get theirs the first time someone views them. Nothing has to be run, and no original is rewritten or deleted.
- Copies count towards the storage limits. Making a missing copy is not held to the organisation's own limit, so a full workspace can still show its photos.
