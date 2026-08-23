# ADR-001: Technology Stack for Vehicle Import & Tracking Platform

**Status:** Accepted  
**Date:** 23 August 2026  
**Decision owners:** Matthew / Business Owner

See conversation record. Summary of the accepted stack:

- Language: TypeScript
- Frontend: React, Vite, React Router, Zustand, TanStack Query, Tailwind CSS
- Backend: NestJS REST API, Prisma, application-managed auth
- Database: PostgreSQL + PostGIS
- Storage: S3-compatible object storage (local filesystem in development)
- External services isolated behind adapters: maps, ANPR, vehicle data, GPS, notifications
- Architecture: modular monolith, multi-tenant-ready via Organisation
