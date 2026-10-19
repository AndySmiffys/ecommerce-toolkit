import { syncStorefrontSnapshot } from "./storefrontSnapshot.server";
import { validateShippingCountries } from "./shippingCountries.server";
import db from "../../../db.server";
import { createPromotionCodeBatch } from "./promotionCodeBatches.server";
import { authenticate } from "../../../shopify.server";
import { createShopifyPromotion, type CreateDiscountDraft } from "./createPromotion.server";
import { getDiscount } from "./discount.server";
import { withImageRatios } from "./promotionAssets.server";
import { priorityForSave, updatePromotionWebsiteSettings } from "./promotionSettings.server";
import { readWebsite, websiteStorage, validateWebsite } from "../design/design";
import type { PromotionActionData } from "../design/editorTypes";
export async function promotionEditorAction({ request }: { request: Request }): Promise<PromotionActionData> {
const { admin, session } = await authenticate.admin(request);
const formData = await request.formData();
const intent = formData.get("intent");
if (intent === "createPromotion") {
let savedId: string | undefined;
let requestKey: string | undefined;
let codeListLocked = false;
try {
const payload = JSON.parse(String(formData.get("payload") ?? "{}"));
const website = await withImageRatios(admin, readWebsite(payload.website));
const errors = validateWebsite(website, payload.discount?.endsAt);
if (errors.length) throw new Error(errors.join(" "));
await validateShippingCountries(admin, payload.discount);
if (payload.discount?.codeMode === "bulk") {
requestKey = payload.requestKey;
const batch = await createPromotionCodeBatch(admin, session.shop, requestKey!, payload.discount as CreateDiscountDraft, website);
savedId = batch.shopifyDiscountId!;
await updatePromotionWebsiteSettings(session.shop, savedId, { ...websiteStorage({ ...website, websiteEnabled: false }), priority: await priorityForSave(session.shop, savedId, false) });
return { success: true, savedId, redirectId: savedId.split("/").pop() };
}
if (payload.savedId) {
if (!/^gid:\/\/shopify\/DiscountNode\/\d+$/.test(payload.savedId) || !(await getDiscount(admin, payload.savedId))) throw new Error("The saved discount could not be found.");
savedId = payload.savedId;
} else {
savedId = await createShopifyPromotion(admin, payload.discount as CreateDiscountDraft);
}
const rankEntry = payload.rankEntry === true;
await updatePromotionWebsiteSettings(session.shop, savedId!, { ...websiteStorage(website), priority: await priorityForSave(session.shop, savedId!, rankEntry) });
await syncStorefrontSnapshot(admin, session.shop);
return { success: true, savedId, redirectId: savedId!.split("/").pop(), rankEntry };
} catch (error) {
if (requestKey) { const batch = await db.promotionCodeBatch.findUnique({ where: { shop_requestKey: { shop: session.shop, requestKey } } }); savedId = batch?.shopifyDiscountId ?? undefined; codeListLocked = Boolean(batch); }
return { success: false, savedId, codeListLocked, error: (savedId ? "The Shopify discount was created, but website saving or storefront sync did not finish. Retry saving to finish. " : "") + (error instanceof Error ? error.message : "The promotion could not be saved.") };
}
}


if (intent === "searchEligibility") {
const eligibilityType = formData.get("eligibilityType");
const query = formData.get("query");

if (
(eligibilityType !== "segments" && eligibilityType !== "customers") ||
typeof query !== "string"
) {
return {
success: false,
error: "The eligibility search request is invalid.",
};
}

const searchQuery = query.trim();

const response = await admin.graphql(
eligibilityType === "segments"
? `
#graphql
query SearchPromotionSegments($query: String) {
segments(first: 50, query: $query) {
nodes {
id
name
}
}
}
`
: `
#graphql
query SearchPromotionCustomers($query: String) {
customers(first: 50, query: $query) {
nodes {
id
displayName
email
}
}
}
`,
{
variables: {
query: searchQuery.length > 0 ? searchQuery : null,
},
},
);

const result = (await response.json()) as {
data?: {
segments?: {
nodes: Array<{
id: string;
name: string;
}>;
};
customers?: {
nodes: Array<{
id: string;
displayName: string;
email: string | null;
}>;
};
};
errors?: Array<{ message: string }>;
};

if (result.errors?.length) {
return {
success: false,
error: result.errors.map((error) => error.message).join(", "),
};
}

return {
success: true,
eligibilityResources:
eligibilityType === "segments"
? (result.data?.segments?.nodes ?? []).map((segment) => ({
id: segment.id,
name: segment.name,
}))
: (result.data?.customers?.nodes ?? []).map((customer) => ({
id: customer.id,
name: customer.displayName,
secondary: customer.email,
})),
};
}

if (intent === "searchResources") {
const resourceType = formData.get("resourceType");
const query = formData.get("query");

if (
(resourceType !== "product" && resourceType !== "collection") ||
typeof query !== "string"
) {
return {
success: false,
error: "The resource search request is invalid.",
};
}

const searchQuery = query.trim();
if (searchQuery.length < 2) {
return {
success: true,
resources: [],
};
}

const response = await admin.graphql(
resourceType === "product"
? `
#graphql
query SearchPromotionProducts($query: String!) {
products(first: 20, query: $query, sortKey: TITLE) {
nodes {
id
title
handle
featuredImage {
url
}
variants(first: 100) {
nodes {
id
title
}
}
}
}
}
`
: `
#graphql
query SearchPromotionCollections($query: String!) {
collections(first: 20, query: $query, sortKey: TITLE) {
nodes {
id
title
handle
}
}
}
`,
{
variables: {
query: `title:*${searchQuery.replace(/"/g, "")}*`,
},
},
);

const result = (await response.json()) as {
data?: {
products?: {
nodes: Array<{
id: string;
title: string;
handle: string;
featuredImage?: { url: string } | null;
variants?: {
nodes: Array<{
id: string;
title: string;
}>;
};
}>;
};
collections?: {
nodes: Array<{
id: string;
title: string;
handle: string;
}>;
};
};
errors?: Array<{ message: string }>;
};

if (result.errors?.length) {
return {
success: false,
error: result.errors.map((error) => error.message).join(", "),
};
}

const nodes: Array<{ id: string; title: string; handle: string; featuredImage?: { url: string } | null; variants?: { nodes: Array<{ id: string; title: string }> } }> =
resourceType === "product"
? result.data?.products?.nodes ?? []
: result.data?.collections?.nodes ?? [];

return {
success: true,
resources: nodes.map((item) => ({
id: item.id,
title: item.title,
handle: item.handle,
imageUrl:
item.featuredImage?.url ?? null,
variants:
item.variants?.nodes,
selectedVariantIds:
item.variants?.nodes.map((variant) => variant.id),
})),
};
}

if (intent !== "resolveFile") {
return {
success: false,
error: "Unsupported action.",
};
}

const fileId = formData.get("fileId");

if (
typeof fileId !== "string" ||
!fileId.startsWith("gid://shopify/MediaImage/")
) {
return {
success: false,
error: "The selected Shopify file is invalid.",
};
}

const response = await admin.graphql(
`
#graphql
query PromotionBannerFile($id: ID!) {
node(id: $id) {
... on MediaImage {
id
alt
image {
url
}
}
}
}
`,
{
variables: {
id: fileId,
},
},
);

const result = (await response.json()) as {
data?: {
node?: {
id: string;
alt: string | null;
image?: {
url: string;
} | null;
} | null;
};
errors?: Array<{ message: string }>;
};

if (result.errors?.length) {
return {
success: false,
error: result.errors.map((error) => error.message).join(", "),
};
}

const image = result.data?.node;

if (!image?.image?.url) {
return {
success: false,
error: "The selected image could not be loaded.",
};
}

return {
success: true,
image: {
id: image.id,
url: image.image.url,
alt: image.alt,
},
};
}

