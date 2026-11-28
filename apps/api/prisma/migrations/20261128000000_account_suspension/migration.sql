-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "readOnlyFrom" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkspaceSuspension" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "suspendedById" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoreReason" TEXT,
    "restoredById" TEXT,
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "WorkspaceSuspension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "operatorId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceSuspension_organisationId_restoredAt_idx" ON "WorkspaceSuspension"("organisationId", "restoredAt");

-- CreateIndex
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "WorkspaceSuspension" ADD CONSTRAINT "WorkspaceSuspension_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

