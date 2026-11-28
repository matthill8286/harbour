-- CreateTable
CREATE TABLE "WorkspaceClosure" (
    "organisationId" TEXT NOT NULL,
    "contractEndsAt" TIMESTAMP(3) NOT NULL,
    "deleteAfter" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "scheduledById" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceClosure_pkey" PRIMARY KEY ("organisationId")
);

-- AddForeignKey
ALTER TABLE "WorkspaceClosure" ADD CONSTRAINT "WorkspaceClosure_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
