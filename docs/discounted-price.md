# Discounted price

A product-page block that shows the product's price, and the price after any discount that covers it ("Now £16.00, was £20.00"), for automatic discounts and for code discounts. It is meant to replace the theme's own price block on the product page. Its look and wording are set in the app under **Discounted price**; the block has no settings in the theme editor.

## Adding it to the theme

1. In the theme editor, open a product page and add the **Discounted price** app block where the theme's own price block is.
2. Remove the theme's price block. The app block shows the standard price when nothing applies, so nothing is lost.
3. Open **Discounted price** in the app to set the look and the saving and code messages. Until settings are saved the block uses the stylesheet's own defaults and the theme's text size and font.

Nothing is added to a theme automatically.

## What is shown

The block works out the price in the shopper's browser from rules the app publishes with each promotion, so it follows the selected variant and costs no request to the app.

- **No discount:** the standard price, plus Shopify's own compare-at price as the old price when there is one.
- **An automatic discount:** the price after the discount, with the old price (the compare-at price, or the price itself) struck through, and optionally how much is saved ("Save £4.00", or "20% off"). When several automatic discounts cover a product, the lowest price is shown.
- **A code discount:** a separate line under the price, "£15.00 with code SAVE25", because the shopper has not entered the code yet and checkout decides whether it applies. It appears only when the code would make the price lower than the one shown. The best code is shown. Codes are not added to automatic discounts. The message can also say what the code takes off, with `{amount}` and `{percent}` (a whole percentage, rounded half up), both against the price before any discount, so a 25% code says 25%: "{percent}% off with code {code}".
- **A permanent reduction made in Shopify** (a compare-at price above the price): the compare-at price is the old price, and with the saving switched on the block says how much it saves, for example "£15.00, was £25.00, 40% off" with the message "{percent}% off". When an automatic discount applies as well, the saving is against the compare-at price.

Prices are in the shop's currency and are written with the shop's money format.

## Which discounts count

A promotion gets a price rule when it is enabled for the website (status Enabled, as for the other placements), is for all customers, has not ended, and is one of:

- a **percentage off products or the whole order** (an order discount of 10% is 10% off every product);
- an **amount off each item** of specific products.

These do not get a price (the shopper's price depends on the cart), so they are shown by the existing banners and badges only: an amount off the whole order, an amount off a set of products shared across the order, buy X get Y, free shipping, anything with a minimum spend or minimum quantity, and anything limited to customers or segments. Checkout stays authoritative for customer eligibility, usage limits and combinations.

A rule covers a product when the promotion is for everything, or lists the product, or one of its collections, or (for variant discounts) the selected variant. A discount whose list of products Shopify could not give in full is never claimed for a product.

## How it is built

- `app/modules/promotions/design/priceRule.ts` turns a promotion into a rule: `{t: "p", v: 2000, c: "SAVE20"}` (a percentage in hundredths of a percent) or `{t: "a", v: 500, c: "", u: "GBP"}` (an amount off each item in pence, with its currency). `c` is the code, empty for an automatic discount. The raw percentage or amount comes from `PromotionGeneral.reduction`, read from Shopify's discount by the adapter.
- The rule is published in the small storefront snapshot (`promotion_engine.storefront`, as `price` on each promotion) together with `priceRules: 1`. Bumping `priceRulesVersion` makes the app rewrite the snapshot the next time it is opened, without any promotion changing. Product and collection lists are the existing `scope_<id>` metafields.
- `extensions/promotion-engine/blocks/discounted-price.liquid` finds the rules that cover the product, works out the price for the first variant on the server (so the page does not change when the script starts), and sends the rules and the variants' prices to the script.
- `extensions/promotion-engine/assets/discounted-price.js` does the same sums in whole minor units for any variant, so the server and the script always agree to the penny: a percentage takes off `floor((price × v + 5000) / 10000)`, which rounds half a penny up, as Shopify does. The same file runs in the app's preview.
- Settings are the app metafield `price_display.config` (`app/modules/price/`), validated like the shipping countdown's. The preview on the Discounted price page uses the block's own stylesheet and script.

## Limits

- It estimates the price from the product alone. The cart and checkout always decide the final price (customers, usage limits, combinations, shipping, taxes).
- Only the product page is covered. Collection cards and product cards in scrollers need either the theme's help or a script that rewrites the card's price; that is not built yet.
- Unit prices, "tax included" text and price ranges for products without a selected variant are not shown.
- A fixed amount is only applied to prices in its own currency.
