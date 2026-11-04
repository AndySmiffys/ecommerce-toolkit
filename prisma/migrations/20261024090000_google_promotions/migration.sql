-- CreateTable
CREATE TABLE "GooglePromotion" (
    "shop" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "issues" TEXT NOT NULL DEFAULT '[]',
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GooglePromotion_pkey" PRIMARY KEY ("shop","discountId")
);

-- CreateTable
CREATE TABLE "GoogleFeed" (
    "shop" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "feedText" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,
    "builtAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleFeed_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleFeed_token_key" ON "GoogleFeed"("token");
