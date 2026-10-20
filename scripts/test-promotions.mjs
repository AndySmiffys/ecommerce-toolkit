import process from "node:process";
import { build } from "esbuild";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const directory = await mkdtemp(join(tmpdir(), "promotion-tests-"));
// The database tests need a real PostgreSQL. Use TEST_DATABASE_URL if it is set (any server the tests may create
// schemas in); otherwise start a temporary one that lives only for this run.
let postgres;
let testDatabaseUrl = process.env.TEST_DATABASE_URL;
try {
  if (!testDatabaseUrl) {
    const port = await freePort();
    postgres = new EmbeddedPostgres({ databaseDir: join(directory, "postgres"), user: "postgres", password: "test", port, persistent: false, onLog: () => {}, onError: () => {} });
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase("tests");
    testDatabaseUrl = `postgresql://postgres:test@127.0.0.1:${port}/tests`;
  }
  await build({ entryPoints: ["tests/promotions.test.tsx", "tests/promotion-codes.test.ts", "tests/promotion-settings.test.ts", "tests/storefront-selection.test.ts", "tests/storefront-snapshot.test.ts", "tests/shared-campaign.test.ts", "tests/link-destinations.test.ts", "tests/promotion-summary.test.ts", "tests/campaign-palette.test.ts", "tests/save-issue-step.test.ts", "tests/step-validation.test.ts", "tests/ranking.test.ts", "tests/order-report.test.ts" ], outdir: directory, outExtension: { ".js": ".cjs" }, bundle: true, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "raw", setup(build) { build.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "raw" })); build.onLoad({ filter: /.*/, namespace: "raw" }, async args => ({ contents: await readFile(args.path, "utf8"), loader: "text" })); } }] });
  const child = spawn(process.execPath, ["--test", join(directory, "promotions.test.cjs"), join(directory, "promotion-codes.test.cjs"), join(directory, "promotion-settings.test.cjs"), join(directory, "storefront-selection.test.cjs"), join(directory, "storefront-snapshot.test.cjs"), join(directory, "shared-campaign.test.cjs"), join(directory, "link-destinations.test.cjs"), join(directory, "promotion-summary.test.cjs"), join(directory, "campaign-palette.test.cjs"), join(directory, "save-issue-step.test.cjs"), join(directory, "step-validation.test.cjs"), join(directory, "ranking.test.cjs"), join(directory, "order-report.test.cjs"), "tests/promotions-runtime.test.cjs", "tests/storefront-placements.test.cjs", "tests/priority-control.test.cjs", "tests/priority-manager.test.cjs", "tests/editor-render.test.cjs", "tests/editor-flows.test.cjs"], { stdio: "inherit", env: { ...process.env, NODE_PATH: join(process.cwd(), "node_modules"), TEST_DATABASE_URL: testDatabaseUrl } });
  process.exitCode = await new Promise(resolve => child.on("exit", resolve));
} finally {
  await postgres?.stop().catch(() => {});
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}
