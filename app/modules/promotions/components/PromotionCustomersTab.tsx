import type { PromotionRecord } from "../models/promotion";

 type PromotionCustomersTabProps = {
  promotion: PromotionRecord;
};

function getShopifyNumericId(id: string): string {
  return id.split("/").pop() ?? id;
}

export function PromotionCustomersTab({
  promotion,
}: PromotionCustomersTabProps) {
  const customers = promotion.shopify.customers;
  const usesSegments = customers.segments.length > 0;
  const usesCustomers = customers.customers.length > 0;

  const eligibilityLabel = customers.appliesToAllCustomers
    ? "All customers"
    : usesSegments
      ? `${customers.segments.length} ${customers.segments.length === 1 ? "customer segment" : "customer segments"}`
      : usesCustomers
        ? `${customers.customers.length} selected ${customers.customers.length === 1 ? "customer" : "customers"}`
        : "Selected customers";

  return (
    <s-stack direction="block" gap="large">
      <section
        aria-label="Customer eligibility"
        style={{
          border: "1px solid #e3e3e3",
          borderRadius: "16px",
          background: "#ffffff",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
          padding: "20px",
        }}
      >
        <s-stack direction="block" gap="large">
          <s-stack direction="block" gap="small">
            <s-text type="strong">Customer eligibility</s-text>
            <s-text color="subdued">
              The customers who are eligible to use this promotion.
            </s-text>
          </s-stack>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "18px",
              padding: "18px",
              border: "1px solid #e2e2e2",
              borderRadius: "14px",
              background: "#fafafa",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: "#616161",
                  fontSize: "12px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Eligibility
              </div>
              <div
                style={{
                  marginTop: "5px",
                  color: "#202223",
                  fontSize: "24px",
                  fontWeight: 700,
                }}
              >
                {eligibilityLabel}
              </div>
            </div>

            <s-badge tone={customers.appliesToAllCustomers ? "success" : "info"}>
              {customers.appliesToAllCustomers ? "Open eligibility" : "Targeted eligibility"}
            </s-badge>
          </div>
        </s-stack>
      </section>

      {customers.appliesToAllCustomers ? (
        <section
          aria-label="All customers"
          style={{
            border: "1px solid #e3e3e3",
            borderRadius: "16px",
            background: "#ffffff",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
            padding: "20px",
          }}
        >
          <s-banner tone="success">
            Every customer is eligible to use this promotion.
          </s-banner>
        </section>
      ) : usesSegments ? (
        <section
          aria-label="Customer segments"
          style={{
            border: "1px solid #e3e3e3",
            borderRadius: "16px",
            background: "#ffffff",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
            padding: "20px",
          }}
        >
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-text type="strong">Customer segments</s-text>
              <s-text color="subdued">
                Customers in these Shopify segments can use the promotion.
              </s-text>
            </s-stack>

            <div>
              {customers.segments.map((segment, index) => (
                <div
                  key={segment.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "16px",
                    padding: "13px 0",
                    borderBottom:
                      index === customers.segments.length - 1
                        ? "none"
                        : "1px solid #e3e3e3",
                  }}
                >
                  <div style={{ minWidth: 0, fontWeight: 650 }}>
                    {segment.name}
                  </div>

                  <s-button
                    href={`shopify:admin/customers/segments/${getShopifyNumericId(segment.id)}`}
                    target="_blank"
                    variant="secondary"
                  >
                    View segment ↗
                  </s-button>
                </div>
              ))}
            </div>
          </s-stack>
        </section>
      ) : usesCustomers ? (
        <section
          aria-label="Selected customers"
          style={{
            border: "1px solid #e3e3e3",
            borderRadius: "16px",
            background: "#ffffff",
            boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
            padding: "20px",
          }}
        >
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-text type="strong">Selected customers</s-text>
              <s-text color="subdued">
                Only these individual Shopify customers can use the promotion.
              </s-text>
            </s-stack>

            <div>
              {customers.customers.map((customer, index) => (
                <div
                  key={customer.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "16px",
                    padding: "13px 0",
                    borderBottom:
                      index === customers.customers.length - 1
                        ? "none"
                        : "1px solid #e3e3e3",
                  }}
                >
                  <div style={{ minWidth: 0, fontWeight: 650 }}>
                    {customer.name}
                  </div>

                  <s-button
                    href={`shopify:admin/customers/${getShopifyNumericId(customer.id)}`}
                    target="_blank"
                    variant="secondary"
                  >
                    View customer ↗
                  </s-button>
                </div>
              ))}
            </div>
          </s-stack>
        </section>
      ) : (
        <s-banner tone="warning">
          Shopify returned targeted customer eligibility but no customer or segment details.
        </s-banner>
      )}
    </s-stack>
  );
}
