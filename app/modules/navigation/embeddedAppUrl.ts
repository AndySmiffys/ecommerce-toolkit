import { useCallback } from "react";
import { useLocation, useRouteLoaderData } from "react-router";

type EmbeddedContext = { shop?: string; host?: string | null };

// Carry embedding context between app pages without replaying authentication
// tokens, HMACs, timestamps or another page's filters.
export function embeddedAppUrl(target: string, search: string, context: EmbeddedContext = {}): string {
  if (!/^\/app(?:\/|\?|#|$)/.test(target)) return target;
  const destination = new URL(target, "https://embedded-app.invalid");
  const current = new URLSearchParams(search);
  const shop = context.shop || current.get("shop") || destination.searchParams.get("shop");
  const host = current.get("host") || context.host || destination.searchParams.get("host");
  if (shop) destination.searchParams.set("shop", shop);
  if (host) destination.searchParams.set("host", host);
  const embedded = current.get("embedded") || destination.searchParams.get("embedded") || (shop || host ? "1" : null);
  if (embedded) destination.searchParams.set("embedded", embedded);
  return destination.pathname + destination.search + destination.hash;
}

export function useEmbeddedAppUrl() {
  const { search } = useLocation();
  const context = useRouteLoaderData("routes/app") as EmbeddedContext | undefined;
  const shop = context?.shop;
  const host = context?.host;
  return useCallback((target: string) => embeddedAppUrl(target, search, { shop, host }), [search, shop, host]);
}
