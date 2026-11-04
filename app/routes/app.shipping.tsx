import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import { loadShippingSnapshot, ShippingAccessError } from "../modules/shipping/delivery/shippingReader.server";
import { reviewShipping } from "../modules/shipping/delivery/shippingReview";
import { deliveryServicesTable } from "../modules/shipping/delivery/deliveryServices";
import { publishFreeDelivery } from "../modules/shipping/delivery/freeDeliverySync.server";
import { loadShippingConfig, saveDeliveryServices } from "../modules/shipping/config.server";
import type { ServicesResult } from "../modules/shipping/DeliveryServicesEditor";
import { ShippingReviewPage } from "../modules/shipping/ShippingReviewPage";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  try {
    const snapshot = await loadShippingSnapshot(admin);
    // What was just read is what the product page should say, so publish it now (nothing is written when it has not changed).
    try { await publishFreeDelivery(admin, snapshot); } catch (error) { console.error("Free delivery could not be published:", error instanceof Error ? error.message : error); }
    // The settings the services are saved with. Not being able to read them must not stop the review.
    const settings = await loadShippingConfig(admin).then(result => result.config).catch(() => null);
    return {
      ok: true as const, snapshot, findings: reviewShipping(snapshot), checkedAt: new Date().toISOString(),
      services: deliveryServicesTable(snapshot),
      delivery: settings ? { settings: settings.delivery.services, sort: settings.delivery.sort, enabled: settings.delivery.enabled, cutoffTime: settings.cutoffTime } : null,
    };
  } catch (error) {
    const access = error instanceof ShippingAccessError;
    console.error("The shipping review could not be loaded:", error instanceof Error ? error.message : error);
    return { ok: false as const, access, error: access ? error.message : "Shipping settings could not be loaded. Refresh the page and try again." };
  }
}

export async function action({ request }: ActionFunctionArgs): Promise<ServicesResult> {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "saveServices") return { ok: false, intent, errors: ["That action is not available."] };
  let services: unknown;
  try { services = JSON.parse(String(form.get("services") ?? "")); } catch { return { ok: false, intent, errors: ["The settings could not be read. Reload the page and try again."] }; }
  try {
    const sort = form.get("sort");
    const result = await saveDeliveryServices(admin, services, sort === null ? undefined : String(sort));
    return result.ok ? { ok: true, intent, errors: [], services: result.services, sort: result.sort } : { ok: false, intent, errors: result.errors };
  } catch (error) {
    return { ok: false, intent, errors: [error instanceof Error ? error.message : "That could not be saved."] };
  }
}

export default function Shipping() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<ServicesResult>();
  // The review is read from Shopify each time the page opens. Looking again after a change in Shopify is one click.
  return <ShippingReviewPage data={data} checking={revalidator.state !== "idle"} onCheck={() => revalidator.revalidate()} fetcher={fetcher} />;
}
