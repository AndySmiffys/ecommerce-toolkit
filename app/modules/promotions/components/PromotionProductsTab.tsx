import type { PromotionCoverage } from "../coverage/coverage";
import type { PromotionRecord } from "../models/promotion";

import { BreakdownList } from "./BreakdownList";
import { CoverageCollectionRow } from "./CoverageCollectionRow";
import { HealthCheck } from "./HealthCheck";
import { ReferenceRow } from "./ReferenceRow";
import { SummaryCard } from "./SummaryCard";

type PromotionProductsTabProps = {
  promotion: PromotionRecord;
  coverage: PromotionCoverage | null;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

function getHealthScore(coverage: PromotionCoverage): number {
  if (coverage.uniqueProducts === 0) {
    return 100;
  }

  const weightedIssues =
    coverage.archivedProducts * 3 +
    coverage.draftProducts * 2 +
    coverage.unlistedProducts +
    coverage.outOfStockProducts;

  const issueRate = weightedIssues / coverage.uniqueProducts;

  return Math.max(0, Math.round(100 - issueRate * 25));
}

function getHealthLabel(score: number): string {
  if (score >= 90) {
    return "Healthy";
  }

  if (score >= 70) {
    return "Review";
  }

  return "Attention";
}

const detailSummaryStyle = {
  cursor: "pointer",
  fontWeight: 600,
  padding: "4px 0",
} as const;

const featurePanelStyle = {
  minWidth: 0,
  padding: "20px",
  border: "1px solid #dedede",
  borderRadius: "14px",
  backgroundColor: "#ffffff",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
} as const;

export function PromotionProductsTab({
  promotion,
  coverage,
}: PromotionProductsTabProps) {
  const products = promotion.shopify.products;
  const promotionType = promotion.shopify.general.type;

  const collectionCount = products.collections.length;
  const productCount = products.products.length;
  const variantCount = products.variants.length;

  const hasSpecificTargets =
    collectionCount > 0 ||
    productCount > 0 ||
    variantCount > 0;

  const appliesToEverything = products.allProducts;
  const isOrderDiscount = promotionType === "Order";

  const hasCollectionCoverage =
    coverage !== null &&
    coverage.selectedCollections > 0;

  const hasHealthIssues =
    hasCollectionCoverage &&
    (coverage.draftProducts > 0 ||
      coverage.archivedProducts > 0 ||
      coverage.unlistedProducts > 0 ||
      coverage.outOfStockProducts > 0);

  const healthScore =
    hasCollectionCoverage ? getHealthScore(coverage) : null;

  const displayedCollectionCount = appliesToEverything
    ? "All"
    : hasCollectionCoverage
      ? formatNumber(coverage.selectedCollections)
      : formatNumber(collectionCount);

  const displayedProductCount = appliesToEverything
    ? "All"
    : hasCollectionCoverage
      ? formatNumber(coverage.uniqueProducts)
      : formatNumber(productCount);

  return (
    <s-stack direction="block" gap="large">
      <s-section heading="Products">
        <s-stack direction="block" gap="base">
          <div>
            <div
              style={{
                fontSize: "22px",
                fontWeight: 650,
                lineHeight: 1.3,
                marginBottom: "6px",
              }}
            >
              {appliesToEverything
                ? "Full catalogue promotion"
                : hasSpecificTargets
                  ? "Selected catalogue promotion"
                  : "Product targeting unavailable"}
            </div>

            <div
              style={{
                color: "#616161",
                fontSize: "14px",
                lineHeight: 1.5,
              }}
            >
              {appliesToEverything
                ? isOrderDiscount
                  ? "This order discount applies across the full catalogue without product restrictions."
                  : "Every product and variant in the catalogue is eligible for this promotion."
                : hasCollectionCoverage
                  ? `This promotion targets ${formatNumber(coverage.selectedCollections)} ${coverage.selectedCollections === 1 ? "collection" : "collections"} containing ${formatNumber(coverage.uniqueProducts)} unique ${coverage.uniqueProducts === 1 ? "product" : "products"}.`
                  : hasSpecificTargets
                    ? `The promotion targets ${products.appliesTo.toLowerCase()}.`
                    : "Shopify has not returned product, collection or variant targeting information for this promotion."}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "12px",
            }}
          >
            <div style={featurePanelStyle}>
              <s-stack direction="block" gap="small">
                <div
                  style={{
                    color: "#616161",
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Promotion scope
                </div>

                <div
                  style={{
                    fontSize: "26px",
                    fontWeight: 700,
                    lineHeight: 1.2,
                  }}
                >
                  {appliesToEverything ? "All products" : "Selected catalogue"}
                </div>

                <div
                  style={{
                    color: "#616161",
                    fontSize: "14px",
                    lineHeight: 1.5,
                  }}
                >
                  {appliesToEverything
                    ? "No collection, product or variant restrictions are configured."
                    : "Only specifically configured catalogue items are eligible."}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    paddingTop: "4px",
                  }}
                >
                  <s-badge>{displayedCollectionCount} collections</s-badge>
                  <s-badge>{displayedProductCount} products</s-badge>
                </div>
              </s-stack>
            </div>

            <div style={featurePanelStyle}>
              <s-stack direction="block" gap="small">
                <div
                  style={{
                    color: "#616161",
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Product health
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "30px",
                      fontWeight: 700,
                      lineHeight: 1.1,
                    }}
                  >
                    {healthScore === null ? "Unavailable" : `${healthScore}%`}
                  </div>

                  {healthScore !== null && (
                    <s-badge tone={hasHealthIssues ? "warning" : "success"}>
                      {getHealthLabel(healthScore)}
                    </s-badge>
                  )}
                </div>

                <div
                  style={{
                    color: "#616161",
                    fontSize: "14px",
                    lineHeight: 1.5,
                  }}
                >
                  {hasCollectionCoverage
                    ? hasHealthIssues
                      ? "Some covered products may need attention."
                      : "No product status or inventory issues were found."
                    : "Health is available when detailed collection coverage has been loaded."}
                </div>

                {hasCollectionCoverage && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      paddingTop: "4px",
                    }}
                  >
                    <s-badge tone="success">
                      {formatNumber(coverage.activeProducts)} active
                    </s-badge>
                    {coverage.outOfStockProducts > 0 && (
                      <s-badge tone="warning">
                        {formatNumber(coverage.outOfStockProducts)} out of stock
                      </s-badge>
                    )}
                  </div>
                )}
              </s-stack>
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
              label="Collections"
              value={displayedCollectionCount}
              description="Collections currently included in the promotion."
            />

            <SummaryCard
              label="Covered products"
              value={displayedProductCount}
              description="Unique products currently covered by the promotion."
            />
          </div>
        </s-stack>
      </s-section>

      {hasCollectionCoverage && (
        <s-section heading="Promotion health">
          <s-stack direction="block" gap="base">
            <s-banner tone={hasHealthIssues ? "warning" : "success"}>
              {hasHealthIssues
                ? `${healthScore === null ? "Attention needed" : getHealthLabel(healthScore)}: some covered products may require attention.`
                : "Healthy: no product status or inventory issues were found."}
            </s-banner>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "12px",
              }}
            >
              <HealthCheck
                tone="success"
                title={`${formatNumber(coverage.activeProducts)} active ${coverage.activeProducts === 1 ? "product" : "products"}`}
                description="These products are active in Shopify."
                isLast
              />

              {coverage.draftProducts > 0 && (
                <HealthCheck
                  tone="warning"
                  title={`${formatNumber(coverage.draftProducts)} draft ${coverage.draftProducts === 1 ? "product" : "products"}`}
                  description="Draft products are not normally available for customers to purchase."
                  isLast
                />
              )}

              {coverage.archivedProducts > 0 && (
                <HealthCheck
                  tone="critical"
                  title={`${formatNumber(coverage.archivedProducts)} archived ${coverage.archivedProducts === 1 ? "product" : "products"}`}
                  description="Archived products should be reviewed and may need removing from the promotion."
                  isLast
                />
              )}

              {coverage.unlistedProducts > 0 && (
                <HealthCheck
                  tone="warning"
                  title={`${formatNumber(coverage.unlistedProducts)} unlisted ${coverage.unlistedProducts === 1 ? "product" : "products"}`}
                  description="Unlisted products have restricted catalogue visibility."
                  isLast
                />
              )}

              <HealthCheck
                tone={
                  coverage.outOfStockProducts > 0
                    ? "warning"
                    : "success"
                }
                title={
                  coverage.outOfStockProducts > 0
                    ? `${formatNumber(coverage.outOfStockProducts)} out-of-stock ${coverage.outOfStockProducts === 1 ? "product" : "products"}`
                    : "All covered products have inventory"
                }
                description={
                  coverage.outOfStockProducts > 0
                    ? "These products currently have total inventory of zero or less."
                    : "No out-of-stock products were found in the selected collections."
                }
                isLast
              />
            </div>
          </s-stack>
        </s-section>
      )}

      {hasCollectionCoverage && (
        <s-section heading="Catalogue coverage">
          <s-stack direction="block" gap="base">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: "12px",
              }}
            >
              <SummaryCard
                label="Total inventory"
                value={formatNumber(coverage.totalInventory)}
                description="Combined inventory across covered products."
              />

              <SummaryCard
                label="Vendors"
                value={formatNumber(coverage.vendorSummary.length)}
                description="Distinct vendors represented."
              />

              <SummaryCard
                label="Product types"
                value={formatNumber(coverage.productTypeSummary.length)}
                description="Distinct product types represented."
              />
            </div>

            <div>
              {coverage.collections.map((collection, index) => (
                <CoverageCollectionRow
                  key={collection.id}
                  title={collection.title}
                  productCount={collection.productCount}
                  activeProducts={collection.activeProducts}
                  draftProducts={collection.draftProducts}
                  archivedProducts={collection.archivedProducts}
                  unlistedProducts={collection.unlistedProducts}
                  outOfStockProducts={collection.outOfStockProducts}
                  totalInventory={collection.totalInventory}
                  isLast={index === coverage.collections.length - 1}
                />
              ))}
            </div>
          </s-stack>
        </s-section>
      )}

      {hasCollectionCoverage && (
        <s-section heading="Catalogue breakdowns">
          <s-stack direction="block" gap="base">
            <details>
              <summary style={detailSummaryStyle}>
                Vendors ({coverage.vendorSummary.length})
              </summary>
              <div style={{ paddingTop: "12px" }}>
                <BreakdownList
                  items={coverage.vendorSummary}
                  emptyMessage="No vendor information was found for the covered products."
                />
              </div>
            </details>

            <details>
              <summary style={detailSummaryStyle}>
                Product types ({coverage.productTypeSummary.length})
              </summary>
              <div style={{ paddingTop: "12px" }}>
                <BreakdownList
                  items={coverage.productTypeSummary}
                  emptyMessage="No product type information was found for the covered products."
                />
              </div>
            </details>
          </s-stack>
        </s-section>
      )}

      {!hasCollectionCoverage && collectionCount > 0 && (
        <s-section heading={`Collections (${collectionCount})`}>
          <div>
            {products.collections.map((collection, index) => (
              <ReferenceRow
                key={collection.id}
                title={collection.title}
                typeLabel="Collection"
                isLast={index === collectionCount - 1}
              />
            ))}
          </div>
        </s-section>
      )}

      {productCount > 0 && (
        <s-section heading={`Products (${productCount})`}>
          <div>
            {products.products.map((product, index) => (
              <ReferenceRow
                key={product.id}
                title={product.title}
                typeLabel="Product"
                isLast={index === productCount - 1}
              />
            ))}
          </div>
        </s-section>
      )}

      {variantCount > 0 && (
        <s-section heading={`Product variants (${variantCount})`}>
          <div>
            {products.variants.map((variant, index) => (
              <ReferenceRow
                key={variant.id}
                title={variant.title}
                typeLabel="Variant"
                isLast={index === variantCount - 1}
              />
            ))}
          </div>
        </s-section>
      )}

      {!appliesToEverything && !hasSpecificTargets && (
        <s-section heading="No product details available">
          <s-banner tone="warning">
            Shopify did not return collections, products or variants for this promotion. The GraphQL query may need extending for this promotion type.
          </s-banner>
        </s-section>
      )}
    </s-stack>
  );
}
