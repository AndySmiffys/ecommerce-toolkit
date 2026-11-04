import { getShippingCountries } from "../modules/promotions/services/shippingCountries.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { PromotionEditor } from "../modules/promotions/components/PromotionEditor";
import { promotionEditorAction } from "../modules/promotions/services/promotionEditorAction.server";
import { getPromotionEditorResources } from "../modules/promotions/services/promotionEditorResources.server";
export async function action(args: ActionFunctionArgs) { return promotionEditorAction(args); }
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const [resources, shippingCountries] = await Promise.all([getPromotionEditorResources(admin), new URL(request.url).searchParams.get("type") === "shipping" ? getShippingCountries(admin) : Promise.resolve(null)]);
  return { ...resources, shippingCountries };
}
export default function CreatePromotionPage() {
  const { products, shippingCountries } = useLoaderData<typeof loader>();
  return <PromotionEditor products={products} shippingCountries={shippingCountries} />;
}
