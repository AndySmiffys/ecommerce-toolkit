import { getStatusTone } from "../design/statusTone";
import type { PromotionRecord } from "../models/promotion";

import { PromotionBxgyTab } from "./PromotionBxgyTab";
import { SummaryCard } from "./SummaryCard";

type PromotionGeneralTabProps = {
  promotion: PromotionRecord;
};

function formatDate(value: string | null): string {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function getScopeSummary(promotion: PromotionRecord): string {
  const products = promotion.shopify.products;

  if (products.allProducts) {
    return "All products";
  }

  const scopeParts: string[] = [];

  if (products.collections.length > 0) {
    scopeParts.push(
      `${products.collections.length} ${
        products.collections.length === 1 ? "collection" : "collections"
      }`,
    );
  }

  if (products.products.length > 0) {
    scopeParts.push(
      `${products.products.length} ${
        products.products.length === 1 ? "product" : "products"
      }`,
    );
  }

  if (products.variants.length > 0) {
    scopeParts.push(
      `${products.variants.length} ${
        products.variants.length === 1 ? "variant" : "variants"
      }`,
    );
  }

  return scopeParts.length > 0 ? scopeParts.join(" · ") : products.appliesTo;
}

function getValueBadge(promotion: PromotionRecord): string | null {
  const bxgy = promotion.shopify.bxgy;

  if (bxgy) {
    switch (bxgy.get.rewardType) {
      case "FREE":
        return "Free item";

      case "PERCENTAGE":
        return bxgy.get.rewardValue !== null
          ? `${bxgy.get.rewardValue}%`
          : "Percentage reward";

      case "FIXED_AMOUNT":
        return bxgy.get.rewardValue !== null &&
          bxgy.get.rewardCurrencyCode
          ? `${new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: bxgy.get.rewardCurrencyCode,
          }).format(bxgy.get.rewardValue)} off reward`
          : "Fixed amount reward";

      default:
        return "Buy X Get Y";
    }
  }

  return promotion.shopify.general.value === "Unknown"
    ? null
    : promotion.shopify.general.value;
}

const infoStyles = {
  purple: { background: "#f2eafe", colour: "#7c3aed" },
  blue: { background: "#eaf2ff", colour: "#2563eb" },
  pink: { background: "#fdebf3", colour: "#c0266d" },
  green: { background: "#e7f7ec", colour: "#15803d" },
} as const;

function SummaryItem({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: string;
  accent: keyof typeof infoStyles;
}) {
  const style = infoStyles[accent];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        minWidth: 0,
        gap: "12px",
        padding: "4px 0",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 42px",
          width: "42px",
          height: "42px",
          borderRadius: "12px",
          background: style.background,
          color: style.colour,
          fontSize: "20px",
          fontWeight: 700,
        }}
      >
        {icon}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 650 }}>{label}</div>
        <div
          style={{
            marginTop: "3px",
            color: "#616161",
            fontSize: "14px",
            overflowWrap: "anywhere",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function OrderDiscountOverview({
  promotion,
}: {
  promotion: PromotionRecord;
}) {
  const conditions = promotion.shopify.conditions;

  return (
    <section
      aria-label="Order discount coverage"
      style={{
        border: "1px solid #dedede",
        borderRadius: "16px",
        background: "#ffffff",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
        padding: "22px",
      }}
    >
      <s-stack direction="block" gap="large">
        <div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: 700,
              lineHeight: 1.3,
            }}
          >
            Full catalogue order discount
          </div>
          <div
            style={{
              marginTop: "6px",
              color: "#616161",
              fontSize: "14px",
              lineHeight: 1.5,
            }}
          >
            This discount is applied to the order and does not need separate
            product, collection or variant targeting.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
          }}
        >
          <SummaryCard
            label="Promotion scope"
            value="All products"
            description="The full catalogue contributes to the qualifying order."
            accent="purple"
            icon="◇"
          />
          <SummaryCard
            label="Discount value"
            value={promotion.shopify.general.value}
            description="Applied to the qualifying order at checkout."
            accent="blue"
            icon="%"
          />
          <SummaryCard
            label="Minimum requirement"
            value={conditions.minimumRequirement}
            description="The order must meet this requirement before the discount applies."
            accent="green"
            icon="✓"
          />
        </div>

        <s-banner tone="success">
          No product targeting setup is required for this order discount.
        </s-banner>
      </s-stack>
    </section>
  );
}

export function PromotionGeneralTab({
  promotion,
}: PromotionGeneralTabProps) {
  const general = promotion.shopify.general;
  const schedule = promotion.shopify.schedule;
  const valueBadge = getValueBadge(promotion);
  const editInShopifyUrl = `shopify:admin/discounts/${promotion.routeId}`;
  const isOrderDiscount = general.type === "Order";

  return (
    <s-stack direction="block" gap="large">
      <section
        data-promotion-type={general.type}
        aria-label="Promotion quick summary"
        style={{
          border: "1px solid #dedede",
          borderRadius: "16px",
          background: "#ffffff",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
          padding: "22px",
        }}
      >
        <s-stack direction="block" gap="large">
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "20px",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                minWidth: 0,
                gap: "16px",
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 64px",
                  width: "64px",
                  height: "64px",
                  borderRadius: "18px",
                  background: "#e7f7ec",
                  color: "#15803d",
                  fontSize: "31px",
                  fontWeight: 700,
                }}
              >
                ◇
              </div>

              <s-stack direction="block" gap="small">
                <div
                  style={{
                    color: "#202223",
                    fontSize: "24px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.2,
                  }}
                >
                  {general.title}
                </div>

                <s-text color="subdued">{general.summary}</s-text>

                <s-stack direction="inline" gap="base">
                  <s-badge tone={getStatusTone(general.status)}>
                    {general.status}
                  </s-badge>
                  <s-badge>{general.type}</s-badge>
                  <s-badge>{general.method}</s-badge>
                  {valueBadge && <s-badge tone="info">{valueBadge}</s-badge>}
                  <s-badge>
                    {promotion.settings.websiteEnabled
                      ? "Website enabled"
                      : "Website disabled"}
                  </s-badge>
                </s-stack>
              </s-stack>
            </div>

            <s-button
              href={editInShopifyUrl}
              target="_blank"
              variant="secondary"
            >
              Edit in Shopify ↗
            </s-button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "18px",
              paddingTop: "20px",
              borderTop: "1px solid #ebebeb",
            }}
          >
            <SummaryItem
              label="Scope"
              value={getScopeSummary(promotion)}
              icon="◇"
              accent="purple"
            />
            <SummaryItem
              label="Starts"
              value={formatDate(schedule.startsAt)}
              icon="□"
              accent="blue"
            />
            <SummaryItem
              label="Ends"
              value={formatDate(schedule.endsAt)}
              icon="□"
              accent="pink"
            />
            <SummaryItem
              label="Created by"
              value={general.createdBy}
              icon="○"
              accent="green"
            />
          </div>
        </s-stack>
      </section>

      {isOrderDiscount && <OrderDiscountOverview promotion={promotion} />}

      {promotion.shopify.bxgy && (
        <PromotionBxgyTab promotion={promotion} />
      )}
    </s-stack>
  );
}
