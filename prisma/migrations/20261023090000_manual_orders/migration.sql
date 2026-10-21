-- CreateTable
CREATE TABLE "ReportManualOrder" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "reasons" TEXT NOT NULL,
    "valueCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReportManualOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportManualOrder_shop_orderId_key" ON "ReportManualOrder"("shop", "orderId");

-- CreateIndex
CREATE INDEX "ReportManualOrder_shop_day_idx" ON "ReportManualOrder"("shop", "day");

-- Manual discounts used to be counted with promotions. The last 60 days of orders are read again so the figures are
-- split correctly, and the next visit to the Reports starts that.
DELETE FROM "ReportOrderDay";
UPDATE "ReportOrderSync" SET "syncedThrough" = NULL, "syncedAt" = NULL, "operationId" = NULL;
