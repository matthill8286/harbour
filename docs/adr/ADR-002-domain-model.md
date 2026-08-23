# ADR-002: Domain Model & Vehicle Import Workflow

**Status:** Accepted  
**Date:** 23 August 2026  
**Decision owners:** Matthew / Business Owner

The business does not generally purchase and resell vehicles. It manages import, registration and transportation for a customer.

**The Import Job is the primary operational entity.**  
**The Vehicle is the physical asset associated with that job.**

```text
Customer ──< ImportJob >── Vehicle
```

Every business-owned record belongs to an Organisation.

GPS trackers are portable and reusable. Location events are stored independently so journey history survives tracker reassignment.

Internal costs and customer charges are separate. Customers must never see costs, margins, suppliers, or internal notes/documents. This is enforced at the API.

The Cyprus-ready status in the workflow is stored as `READY_FOR_CUSTOMER_COLLECTION` because ADR-002 listed `READY_FOR_COLLECTION` twice (UK collection vs customer collection in Cyprus).
