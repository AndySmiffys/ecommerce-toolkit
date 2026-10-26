import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import { loadShippingSnapshot, ShippingAccessError } from "../modules/shipping/delivery/shippingReader.server";
import { reviewShipping } from "../modules/shipping/delivery/shippingReview";
import { ShippingReviewPage } from "../modules/shipping/ShippingReviewPage";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  try {
    const snapshot = await loadShippingSnapshot(admin);
    return { ok: true as const, snapshot, findings: reviewShipping(snapshot), checkedAt: new Date().toISOString() };
  } catch (error) {
    const access = error instanceof ShippingAccessError;
    console.error("The shipping review could not be loaded:", error instanceof Error ? error.message : error);
    return { ok: false as const, access, error: access ? error.message : "Shipping settings could not be loaded. Refresh the page and try again." };
  }
}

export default function Shipping() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  // The review is read from Shopify each time the page opens. Looking again after a change in Shopify is one click.
  return <ShippingReviewPage data={data} checking={revalidator.state !== "idle"} onCheck={() => revalidator.revalidate()} />;
}
