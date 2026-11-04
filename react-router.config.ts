import type { Config } from "@react-router/dev/config";

// React Router rejects action requests whose Origin header differs from the
// URL the server sees. Behind the Shopify dev tunnel the browser's origin is
// the tunnel domain while the server sees localhost, so allow the app URL.
const appUrl = process.env.SHOPIFY_APP_URL || process.env.HOST;
const allowedActionOrigins: string[] = [];
if (appUrl) {
  try {
    allowedActionOrigins.push(new URL(appUrl).host);
  } catch {
    // Ignore a malformed app URL; same-origin requests still work.
  }
}

export default { allowedActionOrigins } satisfies Config;
