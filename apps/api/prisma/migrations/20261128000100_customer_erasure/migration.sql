-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "erasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CustomerErasure" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reappliedAt" TIMESTAMP(3),
    "summary" JSONB NOT NULL,

    CONSTRAINT "CustomerErasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErasureReviewItem" (
    "id" TEXT NOT NULL,
    "erasureId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "importJobId" TEXT,
    "reason" TEXT NOT NULL,
    "decision" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ErasureReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerErasure_organisationId_customerId_key" ON "CustomerErasure"("organisationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ErasureReviewItem_erasureId_kind_recordId_key" ON "ErasureReviewItem"("erasureId", "kind", "recordId");

-- AddForeignKey
ALTER TABLE "CustomerErasure" ADD CONSTRAINT "CustomerErasure_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErasureReviewItem" ADD CONSTRAINT "ErasureReviewItem_erasureId_fkey" FOREIGN KEY ("erasureId") REFERENCES "CustomerErasure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

