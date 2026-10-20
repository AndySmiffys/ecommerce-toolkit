import { useEmbeddedAppUrl } from "../modules/navigation/embeddedAppUrl";

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
  return (
    <s-page heading="eCommerce Toolkit" inlineSize="large">
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
