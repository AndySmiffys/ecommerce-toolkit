-- CreateTable
CREATE TABLE "ReportOrderDay" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "valueCents" INTEGER NOT NULL DEFAULT 0,
    "refundCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReportOrderDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportOrderSync" (
    "shop" TEXT NOT NULL,
    "operationId" TEXT,
    "fromDay" TEXT,
    "startedAt" TIMESTAMP(3),
    "syncedThrough" TEXT,
    "syncedAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportOrderSync_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE INDEX "ReportOrderDay_shop_day_idx" ON "ReportOrderDay"("shop", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ReportOrderDay_shop_day_key_key" ON "ReportOrderDay"("shop", "day", "key");

