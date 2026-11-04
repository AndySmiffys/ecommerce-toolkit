import type {
  PromotionProducts,
  PromotionShipping,
} from "../../../models/shopify";
import {
  getDiscountAppliesTo,
  type ShopifyDiscountNode,
} from "../../../types/discount";

type DiscountItems = NonNullable<
  NonNullable<ShopifyDiscountNode["discount"]["customerGets"]>["items"]
>;

export function mapEmptyProducts(
  appliesTo = "Not applicable",
): PromotionProducts {
  return {
    appliesTo,
    allProducts: false,
    products: [],
    variants: [],
    collections: [],
  };
}

export function getItemsAppliesTo(items: DiscountItems): string {
  if (items.__typename === "AllDiscountItems") {
    return "All products";
  }

  if (items.__typename === "DiscountCollections") {
    const count = items.collections?.nodes.length ?? 0;
    return `${count} selected ${count === 1 ? "collection" : "collections"}`;
  }

  if (items.__typename === "DiscountProducts") {
    const productCount = items.products?.nodes.length ?? 0;
    const variantCount = items.productVariants?.nodes.length ?? 0;

    if (variantCount > 0) {
      return `${productCount} products and ${variantCount} variants`;
    }

    return `${productCount} selected ${productCount === 1 ? "product" : "products"}`;
  }

  return "Unknown";
}

export function mapProductsFromItems(
  items: DiscountItems | null | undefined,
  emptyLabel = "Not yet supported",
): PromotionProducts {
  if (!items) {
    return mapEmptyProducts(emptyLabel);
  }

  return {
    appliesTo: getItemsAppliesTo(items),
    allProducts:
      items.__typename === "AllDiscountItems" &&
      items.allItems === true,
    products:
      items.products?.nodes.map((product) => ({
        id: product.id,
        title: product.title,
      })) ?? [],
    variants:
      items.productVariants?.nodes.map((variant) => ({
        id: variant.id,
        title: variant.title,
        productId: variant.product?.id ?? null,
        productTitle: variant.product?.title ?? null,
      })) ?? [],
    collections:
      items.collections?.nodes.map((collection) => ({
        id: collection.id,
        title: collection.title,
        productCount: collection.productsCount?.count ?? null,
      })) ?? [],
  };
}

export function mapDiscountProducts(
  node: ShopifyDiscountNode,
): PromotionProducts {
  const items = node.discount.customerGets?.items;

  if (!items) {
    return mapEmptyProducts(getDiscountAppliesTo(node));
  }

  return mapProductsFromItems(items, getDiscountAppliesTo(node));
}

export function mapShipping(
  node: ShopifyDiscountNode,
): PromotionShipping {
  const destination = node.discount.destinationSelection;

  return {
    appliesTo: getDiscountAppliesTo(node),
    allCountries: destination?.allCountries === true,
    countries: destination?.countries ?? [],
    maximumShippingPrice:
      node.discount.maximumShippingPrice ?? null,
    appliesOnOneTimePurchase:
      node.discount.appliesOnOneTimePurchase ?? false,
    appliesOnSubscription:
      node.discount.appliesOnSubscription ?? false,
  };
}