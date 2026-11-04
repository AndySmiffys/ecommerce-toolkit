import type { ShopifyDiscountNode } from "../../types/discount";
import type { ShopifyPromotionProvider } from "./types";

/**
 * Owns provider registration and selection for Shopify promotions.
 * Does not own promotion mapping or provider-specific behaviour.
 */
export class ProviderManager {
  constructor(
    private readonly providers: readonly ShopifyPromotionProvider[],
    private readonly fallbackProvider: ShopifyPromotionProvider,
  ) {}

  resolve(node: ShopifyDiscountNode): ShopifyPromotionProvider {
    return (
      this.providers.find((provider) => provider.supports(node)) ??
      this.fallbackProvider
    );
  }

  map(node: ShopifyDiscountNode) {
    const provider = this.resolve(node);

    return {
      provider,
      typeData: provider.map(node),
    };
  }

  getProviders(): readonly ShopifyPromotionProvider[] {
    return this.providers;
  }
}
