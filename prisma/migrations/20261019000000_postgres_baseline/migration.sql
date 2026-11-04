-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionSettings" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyDiscountId" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "websiteEnabled" BOOLEAN NOT NULL DEFAULT false,
    "showProductPage" BOOLEAN NOT NULL DEFAULT false,
    "showCollectionPage" BOOLEAN NOT NULL DEFAULT false,
    "showProductBadge" BOOLEAN NOT NULL DEFAULT false,
    "showCountdown" BOOLEAN NOT NULL DEFAULT false,
    "showHeaderBanner" BOOLEAN NOT NULL DEFAULT false,
    "headline" TEXT,
    "body" TEXT,
    "badgeText" TEXT,
    "countdownText" TEXT,
    "buttonText" TEXT,
    "buttonUrl" TEXT,
    "backgroundColour" TEXT,
    "textColour" TEXT,
    "badgeColour" TEXT,
    "designJson" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionCodeBatch" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "configurationJson" TEXT NOT NULL,
    "codesJson" TEXT NOT NULL,
    "confirmedJson" TEXT NOT NULL DEFAULT '[]',
    "pendingJson" TEXT NOT NULL DEFAULT '[]',
    "activeJobId" TEXT,
    "reconciliationCursor" TEXT,
    "reconciliationJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "error" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionCodeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromotionSettings_shop_idx" ON "PromotionSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionSettings_shop_shopifyDiscountId_key" ON "PromotionSettings"("shop", "shopifyDiscountId");

-- CreateIndex
CREATE INDEX "PromotionCodeBatch_shop_shopifyDiscountId_idx" ON "PromotionCodeBatch"("shop", "shopifyDiscountId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionCodeBatch_shop_requestKey_key" ON "PromotionCodeBatch"("shop", "requestKey");

