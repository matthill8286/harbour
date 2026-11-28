-- CreateEnum
CREATE TYPE "ClosureEmailKind" AS ENUM ('SCHEDULED', 'REMINDER', 'CANCELLED');

-- CreateTable
CREATE TABLE "ClosureEmail" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "ClosureEmailKind" NOT NULL,
    "contractEndsAt" TIMESTAMP(3) NOT NULL,
    "deleteAfter" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "sentToUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClosureEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClosureEmail_sentAt_dueAt_idx" ON "ClosureEmail"("sentAt", "dueAt");

-- CreateIndex
CREATE INDEX "ClosureEmail_organisationId_idx" ON "ClosureEmail"("organisationId");

-- AddForeignKey
ALTER TABLE "ClosureEmail" ADD CONSTRAINT "ClosureEmail_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
