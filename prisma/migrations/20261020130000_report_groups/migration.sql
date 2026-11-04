-- CreateTable
CREATE TABLE "ReportGroup" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "matchOn" TEXT NOT NULL DEFAULT 'either',
    "matchType" TEXT NOT NULL DEFAULT 'starts_with',
    "pattern" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "complete" BOOLEAN NOT NULL DEFAULT true,
    "discountCount" INTEGER NOT NULL DEFAULT 0,
    "rowsJson" TEXT NOT NULL,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportGroup_shop_idx" ON "ReportGroup"("shop");

-- CreateIndex
CREATE INDEX "ReportSnapshot_shop_takenAt_idx" ON "ReportSnapshot"("shop", "takenAt");

