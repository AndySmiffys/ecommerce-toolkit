import type {
  PromotionCapabilities,
  PromotionProducts,
} from "../../../models/shopify";
import {
  getDiscountType,
  type ShopifyDiscountNode,
} from "../../../types/discount";
import type { PromotionTypeData } from "../types";
import { PromotionProvider } from "./PromotionProvider";

/**
 * Owns product-promotion mapping and capabilities.
 * Does not own Shopify queries, UI rendering, or common promotion mapping.
 */
export class ProductProvider extends PromotionProvider {
  readonly type = "Product" as const;

  readonly capabilities: PromotionCapabilities = {
    supportsProducts: true,
    supportsShipping: false,
    supportsCustomers: true,
    supportsConditions: true,
    supportsCombinations: true,
    supportsWebsiteBadge: true,
    supportsCountdown: true,
    supportsLandingPage: true,
    supportsAnalytics: true,
    supportsHealthChecks: true,
  };

  supports(node: ShopifyDiscountNode): boolean {
    return getDiscountType(node) === this.type;
  }

  map(node: ShopifyDiscountNode): PromotionTypeData {
    return {
      products: this.mapProducts(node),
      bxgy: null,
      shipping: null,
    };
  }

  private getAppliesTo(node: ShopifyDiscountNode): string {
    const items = node.discount.customerGets?.items;

    if (!items) {
      return "Not yet supported";
    }

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

  private mapProducts(node: ShopifyDiscountNode): PromotionProducts {
    const items = node.discount.customerGets?.items;

    if (!items) {
      return {
        appliesTo: this.getAppliesTo(node),
        allProducts: false,
        products: [],
        variants: [],
        collections: [],
      };
    }

    return {
      appliesTo: this.getAppliesTo(node),
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
}

export const productProvider = new ProductProvider();
