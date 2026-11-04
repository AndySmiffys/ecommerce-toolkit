import { ProviderManager } from "./ProviderManager";
import { bxgyProvider } from "./providers/bxgyProvider";
import { orderProvider } from "./providers/orderProvider";
import { productProvider } from "./providers/productProvider";
import { shippingProvider } from "./providers/shippingProvider";
import { unknownProvider } from "./providers/unknownProvider";

export const shopifyProviderManager = new ProviderManager(
  [
    productProvider,
    orderProvider,
    shippingProvider,
    bxgyProvider,
  ],
  unknownProvider,
);
