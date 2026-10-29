// Shopify returns typed IDs even from discountNode/discountNodes. Use one
// internal key for website settings and keep typed aliases for older saves.
export function promotionDiscountId(id: string): string {
  const match = /^gid:\/\/shopify\/(?:DiscountNode|DiscountCodeNode|DiscountAutomaticNode)\/(\d+)$/.exec(id);
  if (!match) throw new Error("Invalid discount ID.");
  return `gid://shopify/DiscountNode/${match[1]}`;
}

/** Whether Shopify's id is for an automatic discount. Their changes reach the storefront's prices whether or not the shop has website settings for them. */
export function isAutomaticDiscountId(id: string): boolean {
  return /^gid:\/\/shopify\/DiscountAutomaticNode\/\d+$/.test(id);
}

export function promotionDiscountAliases(id: string, method?: "code" | "automatic"): string[] {
  const canonical = promotionDiscountId(id);
  const number = canonical.split("/").pop();
  const kinds = method === "code" ? ["DiscountCodeNode"] : method === "automatic" ? ["DiscountAutomaticNode"] : ["DiscountCodeNode", "DiscountAutomaticNode"];
  return [canonical, ...kinds.map(kind => `gid://shopify/${kind}/${number}`)];
}
