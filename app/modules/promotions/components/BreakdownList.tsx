import type {
  PromotionCoverageSummaryItem,
} from "../coverage/coverage";

type BreakdownListProps = {
  items: PromotionCoverageSummaryItem[];
  emptyMessage: string;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

export function BreakdownList({
  items,
  emptyMessage,
}: BreakdownListProps) {
  if (items.length === 0) {
    return (
      <s-paragraph>
        {emptyMessage}
      </s-paragraph>
    );
  }

  return (
    <div>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <div
            key={item.name}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
              padding: "12px 0",
              borderBottom: isLast
                ? "none"
                : "1px solid #e3e3e3",
            }}
          >
            <div
              style={{
                minWidth: 0,
                fontWeight: 500,
                overflowWrap: "anywhere",
              }}
            >
              {item.name}
            </div>

            <s-badge>
              {formatNumber(item.productCount)}{" "}
              {item.productCount === 1
                ? "product"
                : "products"}
            </s-badge>
          </div>
        );
      })}
    </div>
  );
}
