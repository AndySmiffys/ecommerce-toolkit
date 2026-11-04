import { ProductValue } from "./ProductValue";
import { OrderValue } from "./OrderValue";
import { BxgyValue } from "./BxgyValue";
import { ShippingValue } from "./ShippingValue";
import type { ShippingCountries } from "../../services/shippingCountries.server";
import type { DiscountForm } from "./useDiscountForm";

/** The discount value, or the countries for free shipping: one part for each discount type. */
export function ValueStep({ form, shippingCountries }: { form: DiscountForm; shippingCountries?: ShippingCountries | null }) {
const { discountType } = form;
return <>
{discountType === "product" && <ProductValue form={form} />}
{discountType === "order" && <OrderValue form={form} />}
{discountType === "bxgy" && <BxgyValue form={form} />}
{discountType === "shipping" && <ShippingValue form={form} shippingCountries={shippingCountries} />}
</>;
}
