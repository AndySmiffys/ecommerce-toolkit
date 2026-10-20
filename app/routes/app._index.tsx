import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { useEffect } from "react";
import { authenticate, unauthenticated } from "../shopify.server";
import { useEmbeddedAppUrl } from "../modules/navigation/embeddedAppUrl";
import { emptyFilter, daysAgo, today } from "../modules/promotions/design/orderReport";
import { driveOrderSync, loadOrderReport, orderSyncIsDue } from "../modules/promotions/services/orderReport.server";
import { OrderOverview } from "../modules/promotions/components/ReportOrders";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  // Opening the app keeps the figures fresh: orders are read in the background if they are over six hours old.
  if (await orderSyncIsDue(session.shop, 6)) void driveOrderSync(async () => (await unauthenticated.admin(session.shop)).admin, session.shop);
  return { orders: await loadOrderReport(session.shop, emptyFilter(daysAgo(30), today())) };
}

const tools = [
  {
    title: "Promotions",
    description: "Review discounts, eligibility, conditions, schedules and website promotion settings.",
    path: "/app/promotions",
  },
  {
    title: "Storefront priority",
    description: "Drag promotions into the order they are shown in on the storefront.",
    path: "/app/storefront-priorities",
  },
  {
    title: "Reports",
    description: "See how often discounts are redeemed, including codes made by other apps, grouped by a pattern in the code or title.",
    path: "/app/reports",
  },
];

export default function DashboardPage() {
  const appUrl = useEmbeddedAppUrl();
  const { orders } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!orders.syncing) return;
    const timer = setTimeout(() => revalidator.revalidate(), 6000);
    return () => clearTimeout(timer);
  }, [orders.syncing, orders.syncedAt, revalidator]);
  return (
    <s-page heading="eCommerce Toolkit" inlineSize="large">
      <OrderOverview data={orders} />
      <s-section heading="Tools">
        <s-stack direction="block" gap="base">
          <s-paragraph>Manage Shopify promotions and the website settings that sit alongside them.</s-paragraph>
          {tools.map((tool) => (
            <s-stack key={tool.path} direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="block" gap="small-300">
                <s-text type="strong">{tool.title}</s-text>
                <s-text color="subdued">{tool.description}</s-text>
              </s-stack>
              <s-button href={appUrl(tool.path)} variant="secondary">Open</s-button>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}
