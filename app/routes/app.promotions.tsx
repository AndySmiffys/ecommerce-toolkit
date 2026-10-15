import { syncStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";
import { useEmbeddedAppUrl } from "../modules/navigation/embeddedAppUrl";
import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getStatusTone } from "../modules/promotions/design/statusTone";
import { getDiscounts } from "../modules/promotions/services/discounts.server";
import { mapDiscountsToPromotions } from "../modules/promotions/mappers/promotionMapper";
import { attachPromotionSettings } from "../modules/promotions/services/promotionSettings.server";
import type { PromotionRecord } from "../modules/promotions/models/promotion";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const discountNodes = await getDiscounts(admin);
  const mappedPromotions = mapDiscountsToPromotions(discountNodes);
  const promotions = await attachPromotionSettings(
    session.shop,
    mappedPromotions,
  );

  let syncError: string | null = null;
  try { await syncStorefrontSnapshot(admin, session.shop); } catch (error) { syncError = `Promotions loaded, but storefront sync failed: ${error instanceof Error ? error.message : "Please retry."}`; }
  return { promotions, syncError };
}

function getPromotionValue(promotion: PromotionRecord): string {
  const bxgy = promotion.shopify.bxgy;

  if (!bxgy) {
    return promotion.shopify.general.value;
  }

  const quantity = bxgy.get.quantity ?? 1;

  if (bxgy.get.rewardType === "FREE") {
    return `${quantity} free`;
  }

  if (bxgy.get.rewardType === "PERCENTAGE") {
    return bxgy.get.rewardValue !== null
      ? `${bxgy.get.rewardValue}%`
      : "Percentage reward";
  }

  if (bxgy.get.rewardType === "FIXED_AMOUNT") {
    const value = bxgy.get.rewardValue;
    const currency = bxgy.get.rewardCurrencyCode;

    if (value !== null && currency) {
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
      }).format(value);
    }

    return "Fixed amount reward";
  }

  return "Buy X Get Y";
}

function getEligibility(promotion: PromotionRecord): string {
  const customers = promotion.shopify.customers;

  if (customers.appliesToAllCustomers) {
    return "All customers";
  }

  if (customers.segments.length > 0) {
    return customers.segments.length === 1
      ? customers.segments[0].name
      : `${customers.segments.length} customer segments`;
  }

  if (customers.customers.length > 0) {
    return `${customers.customers.length} selected ${customers.customers.length === 1 ? "customer" : "customers"}`;
  }

  return "Targeted customers";
}

function getSummaryLines(summary: string): string[] {
  return summary
    .split(/\s*•\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "No end date";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

type DiscountIconType = "tag" | "order" | "truck";

function DiscountTypeIcon({
  type,
  size = 22,
}: {
  type: DiscountIconType;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        width: `${size + 10}px`,
        height: `${size + 10}px`,
        borderRadius: "10px",
        background: "#f6f6f7",
        color: "#303030",
      }}
    >
      {type === "tag" && (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.6 13.6 13.7 20.5a2 2 0 0 1-2.8 0L3.5 13.1a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h6.7a2 2 0 0 1 1.4.6l7.6 7.2a2 2 0 0 1 0 2.8Z" />
          <circle cx="8" cy="8" r="1.25" />
        </svg>
      )}
      {type === "order" && (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 3h14a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2Z" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      )}
      {type === "truck" && (
        <svg width={size + 2} height={size} viewBox="0 0 26 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h14v13H2z" />
          <path d="M16 8h4l4 4v4h-8z" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="20" cy="18" r="2" />
          <path d="M9 18h9M20 8v4h4" />
        </svg>
      )}
    </span>
  );
}

function getPromotionIconType(promotion: PromotionRecord): DiscountIconType {
  if (promotion.shopify.bxgy) {
    return "tag";
  }

  switch (promotion.shopify.general.type) {
    case "Order":
      return "order";
    case "Shipping":
      return "truck";
    default:
      return "tag";
  }
}

const discountTypes: { type: string; title: string; description: string; icon: DiscountIconType }[] = [
  { type: "product", title: "Amount off products", description: "Discount specific products or collections of products", icon: "tag" },
  { type: "bxgy", title: "Buy X get Y", description: "Reward customers who buy specific items", icon: "tag" },
  { type: "order", title: "Amount off order", description: "Discount the total order amount", icon: "order" },
  { type: "shipping", title: "Free shipping", description: "Offer free shipping on an order", icon: "truck" },
];

export default function PromotionsPage() {
  const appUrl = useEmbeddedAppUrl();
  const { promotions, syncError } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const filteredPromotions = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();

    return promotions.filter((promotion) => {
      const general = promotion.shopify.general;
      const matchesQuery =
        normalisedQuery.length === 0 ||
        general.title.toLowerCase().includes(normalisedQuery) ||
        general.summary.toLowerCase().includes(normalisedQuery) ||
        general.type.toLowerCase().includes(normalisedQuery) ||
        general.method.toLowerCase().includes(normalisedQuery);

      const matchesStatus =
        statusFilter === "ALL" || general.status === statusFilter;

      return matchesQuery && matchesStatus;
    });
  }, [promotions, query, statusFilter]);

  return (
    <s-page heading="Promotions" inlineSize="large">
      <s-button slot="primary-action" variant="primary" commandFor="create-discount-modal" command="--show">
        Create discount
      </s-button>
      <s-button slot="secondary-actions" href="shopify:admin/discounts" target="_blank">
        Open Shopify discounts
      </s-button>
      <div style={{ width: "100%" }}>
        <s-stack direction="block" gap="large">
          {syncError && <s-banner tone="warning">{syncError}</s-banner>}
          <s-text color="subdued">
            Review Shopify discounts and manage their Promotion Engine settings. {promotions.length} promotion{promotions.length === 1 ? "" : "s"}
          </s-text>

          <style>{`
            .promotion-filters {
              display: grid;
              grid-template-columns: minmax(0, 1fr) 180px;
              gap: 12px;
              padding: 12px;
              border-bottom: 1px solid #ebebeb;
              background: #fafafa;
            }

            .promotion-list-header,
            .promotion-list-row {
              display: grid;
              grid-template-columns:
                minmax(220px, 2.4fr)
                minmax(84px, 0.75fr)
                minmax(70px, 0.65fr)
                minmax(110px, 1fr)
                minmax(92px, 0.9fr)
                minmax(92px, 0.85fr)
                minmax(72px, 0.7fr)
                minmax(96px, 0.85fr)
                minmax(96px, 0.85fr)
                64px;
              column-gap: 12px;
              align-items: center;
            }

            .promotion-list-header {
              padding: 11px 14px;
              border-bottom: 1px solid #ebebeb;
              background: #fafafa;
              color: #616161;
              font-size: 12px;
              font-weight: 650;
            }

            .promotion-list-row {
              padding: 14px;
              border-bottom: 1px solid #eeeeee;
            }

            .promotion-list-row:last-child {
              border-bottom: 0;
            }

            .promotion-list-cell {
              min-width: 0;
              overflow-wrap: anywhere;
              font-size: 13px;
            }

            .promotion-mobile-label {
              display: none;
              margin-bottom: 4px;
              color: #616161;
              font-size: 11px;
              font-weight: 650;
            }

            .promotion-summary-lines {
              display: grid;
              gap: 2px;
              margin-top: 4px;
              color: #616161;
              font-size: 12px;
              line-height: 1.4;
            }

            .promotion-summary-line {
              display: block;
            }

            @media (max-width: 980px) {
              .promotion-list-header,
              .promotion-list-row {
                grid-template-columns:
                  minmax(200px, 2fr)
                  minmax(78px, 0.7fr)
                  minmax(72px, 0.65fr)
                  minmax(110px, 1fr)
                  minmax(90px, 0.85fr)
                  minmax(86px, 0.8fr)
                  minmax(68px, 0.65fr)
                  minmax(88px, 0.8fr)
                  minmax(88px, 0.8fr)
                  58px;
                column-gap: 8px;
              }

              .promotion-list-row {
                padding: 12px;
              }

              .promotion-list-header {
                padding: 10px 12px;
              }
            }

            @media (max-width: 760px) {
              .promotion-filters {
                grid-template-columns: 1fr;
              }

              .promotion-list-header {
                display: none;
              }

              .promotion-list-row {
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 14px 18px;
                align-items: start;
                padding: 16px;
              }

              .promotion-list-title {
                grid-column: 1 / -1;
              }

              .promotion-list-action {
                grid-column: 1 / -1;
                text-align: left !important;
              }

              .promotion-mobile-label {
                display: block;
              }
            }

            @media (max-width: 480px) {
              .promotion-list-row {
                grid-template-columns: 1fr;
              }

              .promotion-list-title,
              .promotion-list-action {
                grid-column: 1;
              }
            }
          `}</style>

          <s-section padding="none">
            <div className="promotion-filters">
              <s-text-field
                label="Search promotions"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search promotions"
                value={query}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />

              <s-select
                label="Status"
                labelAccessibilityVisibility="exclusive"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.currentTarget.value)}
              >
                <s-option value="ALL">All statuses</s-option>
                <s-option value="ACTIVE">Active</s-option>
                <s-option value="SCHEDULED">Scheduled</s-option>
                <s-option value="EXPIRED">Expired</s-option>
                <s-option value="UNKNOWN">Unknown</s-option>
              </s-select>
            </div>

            {filteredPromotions.length === 0 ? (
              <div
                style={{
                  padding: "40px 24px",
                  textAlign: "center",
                }}
              >
                <s-text type="strong">No promotions found</s-text>
                <div
                  style={{
                    marginTop: "6px",
                    color: "#616161",
                    fontSize: "13px",
                  }}
                >
                  Try changing the search or status filter.
                </div>
              </div>
            ) : (
              <div>
                <div className="promotion-list-header" aria-hidden="true">
                  <div>Title</div>
                  <div>Status</div>
                  <div>Method</div>
                  <div>Eligibility</div>
                  <div>Type</div>
                  <div>Website</div>
                  <div>Value</div>
                  <div>Starts</div>
                  <div>Ends</div>
                  <div />
                </div>

                {filteredPromotions.map((promotion) => {
                  const general = promotion.shopify.general;
                  const summaryLines = getSummaryLines(general.summary);

                  return (
                    <div
                      key={promotion.id}
                      className="promotion-list-row"
                    >
                      <div className="promotion-list-cell promotion-list-title">
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "10px",
                          }}
                        >
                          <DiscountTypeIcon
                            type={getPromotionIconType(promotion)}
                            size={20}
                          />

                          <div style={{ minWidth: 0 }}>
                            <s-link href={appUrl(`/app/promotions/${promotion.routeId}`)}>
                              <span
                                style={{
                                  color: "#202223",
                                  fontSize: "14px",
                                  fontWeight: 650,
                                }}
                              >
                                {general.title}
                              </span>
                            </s-link>

                            {summaryLines.length > 0 && (
                              <div className="promotion-summary-lines">
                                {summaryLines.map((line, index) => (
                                  <span
                                    key={`${promotion.id}-summary-${index}`}
                                    className="promotion-summary-line"
                                  >
                                    {line}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="promotion-list-cell">
                        <span className="promotion-mobile-label">Status</span>
                        <s-badge tone={getStatusTone(general.status)}>
                          {general.status}
                        </s-badge>
                      </div>

                      <div className="promotion-list-cell">
                        <span className="promotion-mobile-label">Method</span>
                        {general.method}
                      </div>

                      <div className="promotion-list-cell">
                        <span className="promotion-mobile-label">Eligibility</span>
                        {getEligibility(promotion)}
                      </div>

                      <div className="promotion-list-cell">
                        <span className="promotion-mobile-label">Type</span>
                        {general.type}
                      </div>

                      <div className="promotion-list-cell">
                        <span className="promotion-mobile-label">Website</span>
                        <s-badge
                          tone={promotion.settings.included ? "success" : "neutral"}
                        >
                          {promotion.settings.included ? "Included" : "Excluded"}
                        </s-badge>
                      </div>

                      <div className="promotion-list-cell">
                        <span className="promotion-mobile-label">Value</span>
                        {getPromotionValue(promotion)}
                      </div>

                      <div className="promotion-list-cell">
                        <span className="promotion-mobile-label">Starts</span>
                        {formatDate(promotion.shopify.schedule.startsAt)}
                      </div>

                      <div className="promotion-list-cell">
                        <span className="promotion-mobile-label">Ends</span>
                        {formatDate(promotion.shopify.schedule.endsAt)}
                      </div>

                      <div
                        className="promotion-list-cell promotion-list-action"
                        style={{ textAlign: "right" }}
                      >
                        <s-button
                          href={appUrl(`/app/promotions/${promotion.routeId}`)}
                          variant="secondary"
                        >
                          View
                        </s-button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </s-section>
        </s-stack>
      </div>

      <s-modal id="create-discount-modal" heading="Select discount type">
        <s-stack direction="block" gap="small">
          {discountTypes.map((discountType) => (
            <s-clickable
              key={discountType.type}
              href={appUrl(`/app/promotions/new?type=${discountType.type}`)}
              accessibilityLabel={discountType.title}
              border="base"
              borderRadius="base"
              padding="base"
            >
              <s-stack direction="inline" gap="base" alignItems="center">
                <DiscountTypeIcon type={discountType.icon} size={20} />
                <s-stack direction="block" gap="small-300">
                  <s-text type="strong">{discountType.title}</s-text>
                  <s-text color="subdued">{discountType.description}</s-text>
                </s-stack>
              </s-stack>
            </s-clickable>
          ))}
        </s-stack>
        <s-button slot="secondary-actions" commandFor="create-discount-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
