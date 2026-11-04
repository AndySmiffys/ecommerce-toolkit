import type { ShopifyAdminClient } from "./discount.server";
import type { LinkResourcesResponse } from "../design/editorTypes";
export async function getPromotionEditorResources(admin: ShopifyAdminClient) {

const response = await admin.graphql(`
#graphql
query PromotionLinkResources {
products(first: 50, sortKey: TITLE) {
nodes {
id
title
handle
featuredImage {
url
altText
}
priceRangeV2 {
minVariantPrice {
amount
currencyCode
}
}
}
}
collections(first: 50, sortKey: TITLE) {
nodes {
id
title
handle
}
}
}
`);

const result = (await response.json()) as LinkResourcesResponse;

if (result.errors?.length) {
throw new Error(
result.errors.map((error) => error.message).join(", "),
);
}

return {
products: result.data?.products?.nodes ?? [],
collections: result.data?.collections?.nodes ?? [],
};
}

