import type {
  PromotionBxgy,
  PromotionProducts,
  PromotionVariantReference,
} from "../models/shopify";
import type { PromotionRecord } from "../models/promotion";

import { SummaryCard } from "./SummaryCard";

type PromotionBxgyTabProps = {
  promotion: PromotionRecord;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

function formatMoney(
  value: number,
  currencyCode: string | null,
): string {
  if (!currencyCode) {
    return formatNumber(value);
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
  }).format(value);
}

function getScopeCount(products: PromotionProducts): number {
  return (
    products.collections.length +
    products.products.length +
    products.variants.length
  );
}

function getScopeSummary(products: PromotionProducts): string {
  if (products.allProducts) {
    return "All products";
  }

  if (products.collections.length > 0) {
    return `${products.collections.length} ${
      products.collections.length === 1 ? "collection" : "collections"
    }`;
  }

  const productIds = new Set(products.products.map((product) => product.id));
  for (const variant of products.variants) {
    if (variant.productId) {
      productIds.add(variant.productId);
    }
  }

  if (productIds.size > 0) {
    return `${productIds.size} ${productIds.size === 1 ? "product" : "products"}`;
  }

  return products.appliesTo;
}

function getBuyLabel(bxgy: PromotionBxgy): string {
  if (bxgy.buy.quantity !== null) {
    return `${formatNumber(bxgy.buy.quantity)} ${
      bxgy.buy.quantity === 1 ? "product" : "products"
    }`;
  }

  if (bxgy.buy.purchaseAmount !== null) {
    return `Spend ${bxgy.buy.purchaseAmount}`;
  }

  return "Requirement unavailable";
}

function getRewardLabel(bxgy: PromotionBxgy): string {
  const quantity = bxgy.get.quantity ?? 1;

  switch (bxgy.get.rewardType) {
    case "FREE":
      return `${formatNumber(quantity)} FREE`;
    case "PERCENTAGE":
      return `${formatNumber(quantity)} at ${formatNumber(
        bxgy.get.rewardValue ?? 0,
      )}% off`;
    case "FIXED_AMOUNT":
      return `${formatNumber(quantity)} with ${formatMoney(
        bxgy.get.rewardValue ?? 0,
        bxgy.get.rewardCurrencyCode,
      )} off`;
    default:
      return `${formatNumber(quantity)} reward ${
        quantity === 1 ? "item" : "items"
      }`;
  }
}

function getShopifyNumericId(id: string): string {
  return id.split("/").pop() ?? id;
}

type ProductGroup = {
  id: string;
  title: string;
  variants: PromotionVariantReference[];
  allVariants: boolean;
};

function getProductGroups(products: PromotionProducts): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();

  for (const product of products.products) {
    groups.set(product.id, {
      id: product.id,
      title: product.title,
      variants: [],
      allVariants: true,
    });
  }

  for (const variant of products.variants) {
    const productId = variant.productId ?? `variant-product-${variant.id}`;
    const existing = groups.get(productId);

    if (existing) {
      existing.variants.push(variant);
      continue;
    }

    groups.set(productId, {
      id: productId,
      title: variant.productTitle ?? "Product",
      variants: [variant],
      allVariants: false,
    });
  }

  return Array.from(groups.values());
}

function ProductTargetList({ products }: { products: PromotionProducts }) {
  const productGroups = getProductGroups(products);

  return (
    <details open>
      <summary
        style={{
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "13px 0",
          fontWeight: 650,
          borderBottom: "1px solid #e3e3e3",
        }}
      >
        <span>Products</span>
        <s-badge>{productGroups.length}</s-badge>
      </summary>

      <div>
        {productGroups.map((product, index) => (
          <details
            key={product.id}
            style={{
              padding: "13px 0",
              borderBottom:
                index === productGroups.length - 1
                  ? "none"
                  : "1px solid #e3e3e3",
            }}
          >
            <summary
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                fontWeight: 650,
              }}
            >
              <span>{product.title}</span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                {product.allVariants && (
                  <s-badge tone="success">All variants</s-badge>
                )}
                {!product.allVariants && product.variants.length > 0 && (
                  <s-badge>
                    {product.variants.length} {product.variants.length === 1 ? "variant" : "variants"}
                  </s-badge>
                )}
              </span>
            </summary>

            {!product.allVariants && product.variants.length > 0 && (
              <div
                style={{
                  marginTop: "10px",
                  marginLeft: "18px",
                  borderLeft: "2px solid #e5f6f7",
                  paddingLeft: "14px",
                }}
              >
                {product.variants.map((variant) => (
                  <div
                    key={variant.id}
                    style={{
                      padding: "8px 0",
                      color: "#616161",
                      fontSize: "13px",
                    }}
                  >
                    {variant.title}
                  </div>
                ))}
              </div>
            )}
          </details>
        ))}
      </div>
    </details>
  );
}

function CollectionTargetList({ products }: { products: PromotionProducts }) {
  return (
    <div>
      {products.collections.map((collection, index) => (
        <div
          key={collection.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            padding: "13px 0",
            borderBottom:
              index === products.collections.length - 1
                ? "none"
                : "1px solid #e3e3e3",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 650 }}>{collection.title}</div>
            <div
              style={{
                marginTop: "3px",
                color: "#616161",
                fontSize: "13px",
              }}
            >
              {collection.productCount !== null
                ? `${formatNumber(collection.productCount)} ${
                    collection.productCount === 1 ? "product" : "products"
                  }`
                : "Product count unavailable"}
            </div>
          </div>

          <s-button
            href={`shopify:admin/collections/${getShopifyNumericId(collection.id)}`}
            target="_blank"
            variant="secondary"
          >
            View collection ↗
          </s-button>
        </div>
      ))}
    </div>
  );
}

function ScopePanel({
  heading,
  description,
  products,
}: {
  heading: string;
  description: string;
  products: PromotionProducts;
}) {
  const hasTargets = products.allProducts || getScopeCount(products) > 0;
  const usesCollections = products.collections.length > 0;
  const usesProducts =
    products.products.length > 0 || products.variants.length > 0;

  return (
    <section
      aria-label={heading}
      style={{
        minWidth: 0,
        flex: "1 1 390px",
        border: "1px solid #e3e3e3",
        borderRadius: "16px",
        background: "#ffffff",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
        padding: "20px",
      }}
    >
      <s-stack direction="block" gap="large">
        <s-stack direction="block" gap="small">
          <s-text type="strong">{heading}</s-text>
          <s-text color="subdued">{description}</s-text>
        </s-stack>

        <s-banner tone={hasTargets ? "info" : "warning"}>
          {hasTargets
            ? getScopeSummary(products)
            : "Shopify did not return any targeting information."}
        </s-banner>

        {products.allProducts ? (
          <s-paragraph>Every product in the catalogue is included.</s-paragraph>
        ) : usesCollections ? (
          <CollectionTargetList products={products} />
        ) : usesProducts ? (
          <ProductTargetList products={products} />
        ) : null}
      </s-stack>
    </section>
  );
}

export function PromotionBxgyTab({ promotion }: PromotionBxgyTabProps) {
  const bxgy = promotion.shopify.bxgy;

  if (!bxgy) {
    return (
      <s-banner tone="warning">
        Buy and Get configuration was not returned for this promotion.
      </s-banner>
    );
  }

  const buyHasTargets =
    bxgy.buy.products.allProducts || getScopeCount(bxgy.buy.products) > 0;
  const getHasTargets =
    bxgy.get.products.allProducts || getScopeCount(bxgy.get.products) > 0;
  const hasOfferValues =
    (bxgy.buy.quantity !== null || bxgy.buy.purchaseAmount !== null) &&
    bxgy.get.quantity !== null &&
    bxgy.get.rewardType !== "UNKNOWN";
  const isHealthy = buyHasTargets && getHasTargets && hasOfferValues;

  return (
    <s-stack direction="block" gap="large">
      <section
        aria-label="Offer summary"
        style={{
          border: "1px solid #e3e3e3",
          borderRadius: "16px",
          background: "#ffffff",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
          padding: "20px",
        }}
      >
        <s-stack direction="block" gap="large">
          <s-text type="strong">Offer summary</s-text>

          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <SummaryCard
              label="BUY"
              value={getBuyLabel(bxgy)}
              description={getScopeSummary(bxgy.buy.products)}
              icon="🛒"
              accent="green"
            />

            <div
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: "36px",
                fontSize: "24px",
              }}
            >
              →
            </div>

            <SummaryCard
              label="GET"
              value={getRewardLabel(bxgy)}
              description={getScopeSummary(bxgy.get.products)}
              icon="◇"
              accent="blue"
            />
          </div>
        </s-stack>
      </section>

      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <ScopePanel
          heading="Qualifying products"
          description="Products customers must buy to qualify for the reward."
          products={bxgy.buy.products}
        />

        <ScopePanel
          heading="Reward products"
          description="Products that receive the Buy and Get reward."
          products={bxgy.get.products}
        />
      </div>

      <s-section heading="Offer health">
        <s-stack direction="block" gap="base">
          <s-banner tone={isHealthy ? "success" : "warning"}>
            {isHealthy
              ? "The Buy and Get offer has qualifying products, reward products and complete offer values."
              : "Some Buy and Get configuration is missing or could not be read from Shopify."}
          </s-banner>

          <s-stack direction="inline" gap="base">
            <s-badge tone={buyHasTargets ? "success" : "warning"}>
              {buyHasTargets
                ? "Qualifying scope available"
                : "Qualifying scope missing"}
            </s-badge>
            <s-badge tone={getHasTargets ? "success" : "warning"}>
              {getHasTargets ? "Reward scope available" : "Reward scope missing"}
            </s-badge>
            <s-badge tone={hasOfferValues ? "success" : "warning"}>
              {hasOfferValues
                ? "Offer values available"
                : "Offer values incomplete"}
            </s-badge>
          </s-stack>
        </s-stack>
      </s-section>
    </s-stack>
  );
}
