# ADR-003: Multi-Tenant SaaS Architecture

**Status:** Accepted  
**Date:** 24 August 2026  
**Decision owner:** Provider / Platform Owner

## 1. Context

The platform was initially commissioned by a vehicle import and transportation business to manage customers, vehicles, import jobs, GPS trackers, journeys, documents, photos, tasks, costs, customer charges, and customer-facing tracking.

Although the initial implementation is being developed for one business, the underlying product may subsequently be offered to other vehicle import, transportation and logistics businesses.

The platform must therefore be designed as a **multi-tenant SaaS application from the beginning**.

Each business using the platform will be treated as an independent **Organisation/Tenant**. Tenant data must be strictly isolated.

The platform owner must be able to operate and administer the overall SaaS platform without having unrestricted visibility of ordinary customer business data unless specifically required for support, security or legal purposes.

## 2. Decision

The platform will use a **shared application + shared database + tenant ID isolation** architecture.

Each customer business is represented by an `Organisation`. Most tenant-owned records contain an `organisationId`.

```text
                    SaaS PLATFORM
                         │
              ┌──────────┴──────────┐
              │                     │
        Organisation A        Organisation B
              │                     │
        ┌─────┼─────┐         ┌─────┼─────┐
        │     │     │         │     │     │
     Users  Cars  Jobs      Users  Cars  Jobs
```

Organisation A must never be able to access Organisation B's data.

## 3. Goals

1. Strong tenant data isolation.
2. A single deployable application.
3. Efficient onboarding of new businesses.
4. Centralised platform maintenance.
5. Tenant-specific configuration.
6. Tenant-specific users and permissions.
7. Subscription and billing support.
8. Usage metering.
9. Future white-label support.
10. Scalability to significantly more tenants without architectural redesign.
11. Preferential commercial terms for the original customer without a separate product.
12. The ability to commercialise the platform independently of the original customer.

## 4. Non-Goals

The initial implementation will **not** attempt to provide:

- Separate deployments for every customer.
- Separate databases for every customer.
- Full enterprise-level custom infrastructure.
- Complete accounting functionality.
- Fully independent customer codebases.
- Customer access to source code.

These can be introduced later if required by a particular enterprise customer.

## 5. Tenant / Organisation Model

The primary tenancy entity is `Organisation` (`id`, `name`, `legalName`, `slug`, `logo`, `timezone`, `currency`, `country`, `status`, timestamps).

Each organisation operates independently within the platform.

## 6. Tenant-Owned Data

The following entities are tenant-owned and, where appropriate, contain `organisationId`:

Customer, Vehicle, ImportJob, Journey, Tracker, TrackerAssignment, LocationEvent, Document, Photo, Task, Cost, CustomerCharge, Note, JobStatusHistory.

## 7. Tenant Isolation

Tenant isolation is enforced at multiple layers. Every authenticated request establishes the user's organisation context from server-side identity.

The application must never rely solely on frontend filtering. The backend must enforce tenant boundaries.

## 8. Database Layer

Queries must include tenant restrictions for ordinary tenant-facing requests. Unscoped reads such as `SELECT * FROM import_jobs` are not permitted unless the query is explicitly organisation-scoped.

Repository/service abstractions should make tenant-scoped access the default behaviour.

## 9. Resource Ownership

Resources are owned by an organisation. Changing a URL from `/job/123` to `/job/456` must not leak another tenant's job. The API verifies `resource.id` **and** `resource.organisationId === currentUser.organisationId`.

## 10–11. User Model and Organisation Membership

Users are separate from organisations. A user may belong to one or multiple organisations via `OrganisationMembership` (`organisationId`, `userId`, `role`, `status`).

This is preferable to storing `organisationId` directly on the User because it allows future multi-organisation access.

MVP: one active membership is bound into the session at login. Organisation context is never taken from a client-supplied `organisationId` query parameter.

## 12. Roles

Initial organisation roles:

- **OWNER** — full organisation control, including billing, users, settings, jobs, and integrations.
- **ADMIN** — manage users, vehicles, customers, jobs, documents, trackers, and view financial information.
- **STAFF** — operational work: update jobs, upload files, manage tasks, view appropriate vehicle information.
- **VIEWER** — read-only access; cannot modify operational records.

The customer portal uses a separate permission model (`CUSTOMER` membership) from internal staff accounts.

## 13–15. Platform Administration and Support Access

A `PlatformAdmin` is not automatically a member of every customer organisation. Platform administration is separated from ordinary tenant administration.

Access to tenant business data should be restricted and auditable. Where practical, support uses **temporary support access** rather than permanent unrestricted access, recording who accessed what, when, and why.

## 16. Audit Logging

Important security and administrative actions are logged (`AuditLog`: organisation, actor, action, entity, metadata, createdAt). Audit logs are append-only from the application's perspective.

## 17–19. Billing, Usage, and Plans

Billing is associated with the Organisation via `Subscription` (plan, status, price, cycle, dates).

Usage is recorded independently of billing. The initial billable metric is **Import Jobs** per organisation per month.

Supported plan names: STARTER, BUSINESS, PROFESSIONAL, ENTERPRISE. The MVP does not need to enforce every plan restriction.

## 20–22. Feature Flags, Tenant Configuration, White-Label

Features may be enabled per organisation. Each organisation has settings (timezone, currency, branding, notifications, customer portal). White-labeling (custom domain, colours, email branding) is not part of the initial MVP.

## 23–25. Customer Portal, GPS, and Document Isolation

End customers may only see vehicles/jobs assigned to them. They must never browse other customers, internal costs, margins, suppliers, internal notes, or another customer's GPS data.

Every location event is associated with `organisationId`, and where assigned `importJobId`, `vehicleId`, and `trackerId`. GPS history must never be exposed across organisations.

Documents are stored using tenant-aware paths. Storage access is controlled by the backend.

## 26–27. Database Strategy

Initial: **PostgreSQL, shared database / shared schema**, tenant identifiers. This reduces infrastructure complexity, simplifies migrations, and makes onboarding fast.

A later move to database-per-tenant for selected enterprise customers should not be made unnecessarily difficult, but is not required for MVP.

## 28–31. API, Authentication, Onboarding, Subscription Lifecycle

Authenticated tenant APIs establish organisation context from membership. Authentication is centralised (email/password, sessions/tokens, password reset, email verification, RBAC).

New organisations should eventually self-register. For the initial customer, onboarding may be performed manually by the Provider.

**Amended 28 November 2026.** Self-registration is not open to everyone. On a server that checks licences, an organisation registers itself only from the link of a licence the Provider has issued to it, and works only while that licence allows. The README's Licences section has the rules.

Subscription statuses: TRIAL, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED. Suspension disables access while retaining data for a reasonable recovery period.

## 32–33. Data Export and Deletion

Every organisation should be able to request an export of its data. Organisation deletion is a privileged operation: soft delete → retention period → permanent deletion.

## 34. Security Principles

- Tenant isolation by default.
- Least privilege.
- Backend enforcement.
- Secure storage (documents and photos not publicly accessible by default).
- Auditability.
- Defence in depth.

## 35–37. Performance, Observability, Limits

Tenant isolation must be applied in the database query, not by filtering large result sets in application memory. Indexes should include `organisationId` (alone and with status, createdAt, customerId, vehicleId, importJobId). GPS data needs additional indexing; PostGIS is used where appropriate.

Platform monitoring measures API, database, GPS ingestion, queues, storage, and usage without unnecessarily exposing tenant-sensitive information.

Configurable limits (users, active jobs, trackers, storage, API requests, GPS events) may later be determined by subscription plan.

## 38–39. Commercialisation and Founding Customer

The Provider retains the right to offer the Platform to other businesses. The first Customer does not receive exclusivity, source-code ownership, or geographic/industry exclusivity unless separately agreed in writing.

The original Customer may receive preferential commercial terms as the founding customer. Those benefits do not create ownership or exclusivity. Exact terms belong in the SaaS Agreement.

## 40. Consequences

**Positive:** reusable platform, recurring revenue (subscription + usage + services), centralised development, lower marginal cost of a new organisation, product opportunity, easier scaling.

**Negative:** a tenant-isolation failure is a critical risk; authorisation is more complex; usage billing must be accurate; the Provider operates a multi-business platform and processes personal data for multiple organisations.

These consequences are accepted because the commercial benefits outweigh the additional complexity.

## 41. Final Architecture

```text
                         INTERNET
                            │
                            ▼
                     Frontend (React/TS)
                            │
                     API / Auth (NestJS)
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
     Organisation Context          Platform Admin
              │
        Tenant Services
              │
     ┌────────┴────────┐
     ▼                 ▼
 PostgreSQL/PostGIS   Object Storage
```

## 42. Architectural Principle

> **The software is a platform, not a bespoke application belonging to the first customer.**

The first business is a tenant of the platform. Future businesses become additional tenants. The Provider owns and operates the platform and grants customers a right to use it under subscription terms.
