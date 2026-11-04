import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { isDestinationType, searchLinkDestinations } from "../modules/promotions/services/linkDestinations.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  if (!isDestinationType(type)) return Response.json({ items: [], error: "Choose a destination type." }, { status: 400 });
  try {
    return Response.json(await searchLinkDestinations(admin, type, url.searchParams.get("q") ?? ""), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ items: [], error: error instanceof Error ? error.message : "Destinations could not be loaded." }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
