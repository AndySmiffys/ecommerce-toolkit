import type { ReactNode } from "react";
import type { LinkResource } from "../../design/editorTypes";

export type DiscountType = "product" | "bxgy" | "order" | "shipping";

export const typeConfig: Record<
DiscountType,
{
title: string;
typeLabel: string;
description: string;
}
> = {
product: {
title: "Amount off products",
typeLabel: "Product discount",
description: "Discount specific products or collections of products",
},
bxgy: {
title: "Buy X get Y",
typeLabel: "Product discount",
description: "Discount specific products or collections of products",
},
order: {
title: "Amount off order",
typeLabel: "Order discount",
description: "Discount the total order amount",
},
shipping: {
title: "Free shipping",
typeLabel: "Shipping discount",
description: "Offer free shipping on an order",
},
};

export function formatPreviewPrice(product?: LinkResource): string {
const money = product?.priceRangeV2?.minVariantPrice;

if (!money) {
return "Price unavailable";
}

const amount = Number.parseFloat(money.amount);

if (!Number.isFinite(amount)) {
return money.amount;
}

return new Intl.NumberFormat("en-GB", {
style: "currency",
currency: money.currencyCode || "GBP",
}).format(amount);
}

/** The content of one part of a step, optionally with its own heading. */
export function FormSection({
title,
heading = false,
children,
}: {
title: string;
heading?: boolean;
children: ReactNode;
}) {
return <section aria-label={title} style={{ display: "grid", gap: 12, minWidth: 0 }}>{heading && <s-heading>{title}</s-heading>}{children}</section>;
}

export const stepOrder: string[] = ["type", "value", "who", "schedule", "advanced", "website"];
