import { ensureStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";
import { ensureFreeDelivery } from "../modules/shipping/delivery/freeDeliverySync.server";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

import {
  Link,
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";

import {
  NavMenu,
} from "@shopify/app-bridge-react";

import {
  boundary,
} from "@shopify/shopify-app-react-router/server";

import {
  AppProvider,
} from "@shopify/shopify-app-react-router/react";

import { useEmbeddedAppUrl } from "../modules/navigation/embeddedAppUrl";

import { authenticate, polarisUrl } from "../shopify.server";

export const loader = async ({
  request,
}: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  let storefrontSyncError: string | null = null;
  try { await ensureStorefrontSnapshot(admin, session.shop); } catch (error) { storefrontSyncError = `Initial storefront display could not be synced: ${error instanceof Error ? error.message : "Please reopen the app to retry."}`; }
  // Where free delivery is offered, for the shipping countdown block. Only reads shipping the first time; a failure here must not stop the app opening.
  try { await ensureFreeDelivery(admin); } catch (error) { console.error("Free delivery could not be published:", error instanceof Error ? error.message : error); }

  return {
    shop: session.shop,
    storefrontSyncError,
    polarisUrl,
    host: new URL(request.url).searchParams.get("host"),
    apiKey:
      process.env.SHOPIFY_API_KEY || "",
  };
};

export default function App() {
  const appUrl = useEmbeddedAppUrl();
  const { apiKey, polarisUrl, storefrontSyncError } =
    useLoaderData<typeof loader>();

  return (
    <AppProvider
      apiKey={apiKey}
      polarisUrl={polarisUrl}
    >
      <NavMenu>
        <Link
          to={appUrl("/app")}
          rel="home"
        >
          Home
        </Link>

        <Link to={appUrl("/app/promotions")}>
          Promotions
        </Link>

        <Link to={appUrl("/app/storefront-priorities")}>
          Storefront priority
        </Link>

        <Link to={appUrl("/app/shipping")}>
          Shipping
        </Link>

        <Link to={appUrl("/app/shipping-countdown")}>
          Shipping countdown
        </Link>

        <Link to={appUrl("/app/reports")}>
          Reports
        </Link>

        <Link to={appUrl("/app/google")}>
          Google Merchant Center
        </Link>
      </NavMenu>

      {storefrontSyncError && <div style={{ padding: 20 }}><s-banner tone="warning">{storefrontSyncError}</s-banner></div>}
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(
    useRouteError(),
  );
}

export const headers: HeadersFunction = (
  headersArgs,
) => {
  return boundary.headers(headersArgs);
};
