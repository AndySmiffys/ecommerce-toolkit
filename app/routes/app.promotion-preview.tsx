import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getPreviewProducts } from "../modules/promotions/services/previewProducts.server";
export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const data = await request.formData();
  const key = String(data.get("selection") ?? "{}");
  try {
    const selection = JSON.parse(key);
    const products = await getPreviewProducts(admin, selection.productIds ?? [], selection.collectionIds ?? []);
    return { key, products, error: null };
  } catch { return { key, products: [], error: "The eligible products could not be loaded." }; }
}
