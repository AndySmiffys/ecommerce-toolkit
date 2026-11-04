import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { syncFreeDelivery } from "../modules/shipping/delivery/freeDeliverySync.server";

// A shipping profile was created, changed or deleted in Shopify. Read shipping again and republish where free delivery is offered, so the
// product page never promises something checkout will not honour. A failure answers with an error so Shopify sends the notice again.
export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.webhook(request);
  if (admin) await syncFreeDelivery(admin);
  return new Response(null, { status: 200 });
}
