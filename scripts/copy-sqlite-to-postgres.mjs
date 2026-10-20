// One-off: copies the data of the SQLite database that earlier versions of this app used (prisma/dev.sqlite) into
// the PostgreSQL database named by DATABASE_URL. Run it once after `npm run setup` has created the tables:
//
//   npm run db:copy-sqlite              (copies prisma/dev.sqlite)
//   npm run db:copy-sqlite -- path.db   (copies another SQLite file)
//   add --skip-sessions to leave the stored Shopify logins behind (use it when the data goes to a different Shopify app)
//
// It is safe to run again: rows that already exist are left alone. The SQLite file is only read, never changed.
// Needs Node 22.13 or later (it reads SQLite with Node's built-in module).
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error("DATABASE_URL must be a PostgreSQL connection string, for example postgresql://user:password@host:5432/database");
  process.exit(1);
}
const skipSessions = process.argv.includes("--skip-sessions");
const path = process.argv.slice(2).find(argument => !argument.startsWith("--")) ?? "prisma/dev.sqlite";
const source = new DatabaseSync(path, { readOnly: true });
const target = new PrismaClient();

// SQLite kept dates as milliseconds and booleans as 0 or 1.
const date = value => (value === null || value === undefined ? null : new Date(Number(value)));
const bool = value => (value === null || value === undefined ? null : Boolean(value));
const rows = table => source.prepare(`SELECT * FROM "${table}"`).all();
const same = (row, names) => Object.fromEntries(names.map(name => [name, row[name] ?? null]));

try {
  const sessions = (skipSessions ? [] : rows("Session")).map(row => ({
    ...same(row, ["id", "shop", "state", "scope", "accessToken", "firstName", "lastName", "email", "locale", "refreshToken"]),
    isOnline: Boolean(row.isOnline), accountOwner: Boolean(row.accountOwner),
    collaborator: bool(row.collaborator), emailVerified: bool(row.emailVerified),
    userId: row.userId === null || row.userId === undefined ? null : BigInt(row.userId),
    expires: date(row.expires), refreshTokenExpires: date(row.refreshTokenExpires),
  }));
  // Oldest first, so the newer promotions get the higher ids that break ties between equal priorities.
  const settings = rows("PromotionSettings").sort((a, b) => a.id - b.id).map(row => ({
    ...same(row, ["shop", "shopifyDiscountId", "headline", "body", "badgeText", "countdownText", "buttonText", "buttonUrl", "backgroundColour", "textColour", "badgeColour", "designJson", "lastSyncError"]),
    priority: Number(row.priority),
    included: Boolean(row.included), websiteEnabled: Boolean(row.websiteEnabled), showProductPage: Boolean(row.showProductPage), showCollectionPage: Boolean(row.showCollectionPage),
    showProductBadge: Boolean(row.showProductBadge), showCountdown: Boolean(row.showCountdown), showHeaderBanner: Boolean(row.showHeaderBanner),
    lastSyncedAt: date(row.lastSyncedAt), createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  }));
  const batches = rows("PromotionCodeBatch").map(row => ({
    ...same(row, ["id", "shop", "requestKey", "shopifyDiscountId", "configurationJson", "codesJson", "confirmedJson", "pendingJson", "activeJobId", "reconciliationCursor", "reconciliationJson", "status", "error", "leaseToken"]),
    leaseUntil: date(row.leaseUntil), createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  }));
  const copied = {
    sessions: (await target.session.createMany({ data: sessions, skipDuplicates: true })).count,
    promotionSettings: (await target.promotionSettings.createMany({ data: settings, skipDuplicates: true })).count,
    promotionCodeBatches: (await target.promotionCodeBatch.createMany({ data: batches, skipDuplicates: true })).count,
  };
  if (skipSessions) console.log("Stored Shopify logins were left behind (--skip-sessions).");
  console.log(`Read ${sessions.length} sessions, ${settings.length} promotion settings and ${batches.length} code batches from ${path}.`);
  console.log(`Copied ${copied.sessions} sessions, ${copied.promotionSettings} promotion settings and ${copied.promotionCodeBatches} code batches (rows already there were left alone).`);
} finally {
  source.close();
  await target.$disconnect();
}
