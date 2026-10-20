-- CreateTable
CREATE TABLE "DiscountIndex" (
    "shop" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "numericId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "other" BOOLEAN NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountIndex_pkey" PRIMARY KEY ("shop","discountId")
);

-- CreateTable
CREATE TABLE "DiscountIndexState" (
    "shop" TEXT NOT NULL,
    "scanCursor" TEXT,
    "scanDone" BOOLEAN NOT NULL DEFAULT false,
    "scanStarted" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3),
    "count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountIndexState_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE INDEX "DiscountIndex_shop_other_numericId_idx" ON "DiscountIndex"("shop", "other", "numericId");

-- CreateIndex
CREATE INDEX "DiscountIndex_shop_createdBy_idx" ON "DiscountIndex"("shop", "createdBy");

