import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

/** The SQL of every migration, in order, as one statement per entry. */
function migrationStatements(): string[] {
  const root = "prisma/migrations";
  return readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().flatMap(name =>
    readFileSync(join(root, name, "migration.sql"), "utf8")
      .split(/;[ \t]*\r?\n/)
      .map(statement => statement.split(/\r?\n/).filter(line => !line.trim().startsWith("--")).join("\n").trim().replace(/;$/, ""))
      .filter(Boolean));
}

/**
 * Runs a test against a real PostgreSQL database that exists only for that test: a schema of its own, built from
 * the project's migrations and dropped afterwards. `npm test` starts a temporary PostgreSQL and sets
 * TEST_DATABASE_URL; set it yourself (any PostgreSQL URL the tests may create schemas in) to use another server.
 */
export async function withDatabase(run: (database: PrismaClient) => Promise<void>): Promise<void> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL is not set. Run the tests with `npm test`, which starts a temporary PostgreSQL, or point it at a PostgreSQL database.");
  const schema = `test_${randomUUID().replace(/-/g, "")}`;
  const admin = new PrismaClient({ datasources: { db: { url: base } } });
  const url = new URL(base);
  url.searchParams.set("schema", schema);
  const database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    for (const statement of migrationStatements()) await database.$executeRawUnsafe(statement);
    await run(database);
  } finally {
    await database.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
