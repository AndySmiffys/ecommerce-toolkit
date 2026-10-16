export type LinkResource = {
id: string;
title: string;
handle: string;
featuredImage?: {
url: string;
altText: string | null;
} | null;
priceRangeV2?: {
minVariantPrice: {
amount: string;
currencyCode: string;
};
} | null;
};

export type LinkResourcesResponse = {
data?: {
products?: { nodes: LinkResource[] };
collections?: { nodes: LinkResource[] };
};
errors?: Array<{ message: string }>;
};

export type ResourceVariant = {
id: string;
title: string;
};

export type ResourceSearchItem = {
id: string;
title: string;
handle: string;
imageUrl?: string | null;
variants?: ResourceVariant[];
selectedVariantIds?: string[];
};

export type EligibilityResource = {
id: string;
name: string;
secondary?: string | null;
};

export type PromotionActionData = {
success: boolean;
savedId?: string;
codeListLocked?: boolean;
redirectId?: string;
/** The saved promotion has just entered the priority order, so the merchant should place it. */
rankEntry?: boolean;
image?: {
id: string;
url: string;
alt: string | null;
};
resources?: ResourceSearchItem[];
eligibilityResources?: EligibilityResource[];
error?: string;
};

