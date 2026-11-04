-- AlterTable
ALTER TABLE "DiscountIndex" ADD COLUMN     "ruleName" TEXT;

-- CreateTable
CREATE TABLE "DiscountSourceRule" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "matchOn" TEXT NOT NULL DEFAULT 'either',
    "matchType" TEXT NOT NULL DEFAULT 'starts_with',
    "pattern" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountSourceRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscountSourceRule_shop_idx" ON "DiscountSourceRule"("shop");

