# Discounted price

A product-page block that shows the product's price, and the price after any discount that covers it ("Now £16.00, was £20.00"), for automatic discounts and for code discounts. It is meant to replace the theme's own price block on the product page. Its look and wording are set in the app under **Discounted price**; the block has no settings in the theme editor.

## Adding it to the theme

1. In the theme editor, open a product page and add the **Discounted price** app block where the theme's own price block is.
2. Remove the theme's price block. The app block shows the standard price when nothing applies, so nothing is lost.
3. Open **Discounted price** in the app to set the look and the saving and code messages. Until settings are saved the block uses the stylesheet's own defaults and the theme's text size and font.

Nothing is added to a theme automatically.

## What is shown

The block works out the price in the shopper's browser from rules the app publishes, so it follows the selected variant and costs no request to the app.

- **The main price** is Shopify's own: the price, and the compare-at price struck through when there is one (a permanent reduction made in Shopify), with optionally how much that saves ("Save £10.00", or "40% off"). No discount in this app changes it.
- **Automatic discounts** are a separate line under it, "£16.00 with the automatic discount", in their own colour, never folded into the main price. Every active automatic discount that covers the product counts, **whether or not it is enabled for the website**, because Shopify applies it in the cart and what is shown has to match. When several apply, the lowest price is shown. The line's words can use `{price}`, `{amount}` and `{percent}` (against the price before any discount).
- **A code discount:** its own line under the price, "£15.00 with code SAVE25", because the shopper has not entered the code yet. Only codes of promotions that are **enabled for the website** are spoken of, and only **one**: the first promotion that covers the product in the order the banners use (the highest priority), so the code in the block is the one the banner is about, never a cheaper one. It appears only when the code would make the price lower than the lowest price already shown (the main price, or the automatic discount's). The message can also say what the code takes off, with `{amount}` and `{percent}` (a whole percentage, rounded half up), both against the price before any discount, so a 25% code says 25%: "{percent}% off with code {code}". If the first promotion's code has no price to show (it needs a minimum spend, say), nothing is shown in its place.
- **Codes and automatic discounts that cannot be combined:** when an automatic discount applies and it cannot be combined with the code (two discounts combine only when each allows the other's kind, using each discount's own "combines with" settings from Shopify), the code line is left out, because the price with the code is not one the shopper can have alongside the price shown.
- **A permanent reduction made in Shopify** (a compare-at price above the price) is the main price and its saving: with the saving switched on the block says "£15.00, was £25.00, 40% off" with the message "{percent}% off". An automatic discount on top is its own line below ("£12.00 with the automatic discount", worked out from the £15.00).

Prices are in the shop's currency and are written with the shop's money format.

## Which discounts count

A promotion gets a price rule when it is for all customers, has not ended, and is one of:

- a **percentage off products or the whole order** (an order discount of 10% is 10% off every product);
- an **amount off each item** of specific products.

These do not get a price (the shopper's price depends on the cart): an amount off the whole order, an amount off a set of products shared across the order, buy X get Y, free shipping, anything with a minimum spend or minimum quantity, and anything limited to customers or segments. Checkout stays authoritative for customer eligibility, usage limits and combinations.

**The Discounted price page lists every active automatic discount that changes prices at checkout but cannot be shown**, with the reason and a link, so a difference between the block and the cart is visible there instead of being found on a product page.

**Keeping it right.** The storefront data is rewritten whenever a promotion changes, and now also whenever an automatic discount is created, changed or deleted in Shopify (the app subscribes to `discounts/create` as well as `discounts/update` and `discounts/delete`, and an automatic discount's change is acted on even when the shop has no website settings for it). Start and end dates are checked on the page itself. **Update the storefront prices now** on the Discounted price page rewrites it on request. The page also has **Prices the storefront is using**: every discount the block speaks of, with what Shopify holds now beside what the storefront has been given, and whether they match (matches, out of date, not published yet, or no longer applies), so a difference is found there instead of on a product page. As a safety, opening the app compares the two (at most every ten minutes, in the background) and publishes again if anything differs.

A rule covers a product when the promotion is for everything, or lists the product, or one of its collections, or (for variant discounts) the selected variant. A discount whose list of products Shopify could not give in full is never claimed for a product.

## How it is built

- `app/modules/promotions/design/priceRule.ts` turns a promotion into a rule (`priceRuleFor`) and an entry for the block (`priceEntryFor`), and says why it has none (`priceProblem`). A rule is `{t: "p", v: 2000, c: "SAVE20"}` (a percentage in hundredths of a percent) or `{t: "a", v: 500, c: "", u: "GBP"}` (an amount off each item in pence, with its currency). `c` is the code, empty for an automatic discount. The raw percentage or amount comes from `PromotionGeneral.reduction`, read from Shopify's discount by the adapter.
- The rules are published in the small storefront snapshot (`promotion_engine.storefront`) as `prices`, apart from the banners' `promotions`, together with `priceRules: 2`. `prices` holds the enabled code promotions in the banners' order (with no price when they have no rule) followed by every active automatic discount, read from Shopify when the snapshot is published (`services/automaticDiscounts.server.ts`). Each entry has the code (empty for automatic), the rule, its kind (`k`: P product, O order) and what it combines with (`cp`, `co`). Bumping `priceRulesVersion` makes the app rewrite the snapshot the next time it is opened, without any promotion changing. Product and collection lists are the existing `scope_<id>` metafields.
- `extensions/promotion-engine/blocks/discounted-price.liquid` finds the rules that cover the product, works out the price for the first variant on the server (so the page does not change when the script starts), and sends the rules and the variants' prices to the script.
- `extensions/promotion-engine/assets/discounted-price.js` does the same sums in whole minor units for any variant, so the server and the script always agree to the penny: a percentage takes off `floor((price × v + 5000) / 10000)`, which rounds half a penny up, as Shopify does. The same file runs in the app's preview.
- Settings are the app metafield `price_display.config` (`app/modules/price/`), validated like the shipping countdown's. The preview on the Discounted price page uses the block's own stylesheet and script.

## Limits

- It estimates the price from the product alone. The cart and checkout always decide the final price (customers, usage limits, combinations, shipping, taxes).
- The block itself is only for the product page. Product cards (collections, search, scrollers) are covered by the separate card price below, which is off until switched on.
- Unit prices, "tax included" text and price ranges for products without a selected variant are not shown.
- A fixed amount is only applied to prices in its own currency.

## Prices on product cards

Off until **Show the discounted price on product cards** is switched on in the app (Discounted price, step Product cards). It needs the eCommerce Toolkit loader app embed turned on in the theme, and it is built for **Horizon** (Dawn as far as its markup allows). It adds no request to the app and nothing to a page when it is off.

- **What a card shows:** the price with the best automatic discount that covers its product, the old price struck through, and what is saved, worded by **Card saving message** (default "Save {amount} ({percent}%)", against the price before any discount). If the product has an old (compare-at) price, that stays the struck price and the discount comes off the price the card shows. The colours and weight are the ones set under Appearance.
- **Automatic discounts only.** A code is never shown on a card, because the shopper has not entered it. Every active automatic discount counts, enabled for the website or not, as on the product page. A discount limited to certain variants is left off cards, because a card cannot tell which variant it shows.
- **How it works.** When the storefront data is published, each automatic discount that can be shown on a card gets its own metafield (`promotion_engine.cardprice_<id>`: the rule, its dates and the products it covers, packed like badge data), with `cardprice_index` listing them. A discount on collections lists the products found in those collections (read when publishing, cached 10 minutes, at most 9,000 per collection; a larger one is left off the cards). Switching cards on or off publishes again straight away. The loader embed writes the data into `<script id="promotion-engine-card-prices">`, and `card-prices.js` (with `discounted-price.js` for the sums, so cards and the product page always agree to the penny) reads each card's price from the page, works out the discounted price and shows it beside the theme's own price, which it hides. A discount is dated in the data, so a start or end takes effect without a publish.
- **What it will not touch.** A price it cannot read with certainty (a range such as "£5.00 - £10.00", "From", "Sold out", an unfamiliar format) or a card without a product id is left exactly as the theme wrote it. A card whose price the theme changes (a new variant) is worked out again, and one that stops being discounted gets the theme's price back.
- **Weight on the page:** about 5 KB of script and style when switched on, plus the data (about 100 bytes for an everything or a listed discount, and the packed product ids for the rest). It reads only cards on the page; new cards from filters or infinite scroll are picked up as they appear.
- **Known limits:** the card shows the first variant's price, as the theme does; the shopper may see the theme's price for a moment before the discounted one appears; other themes' card markup would each need checking; the price on a card is an estimate, and the cart and checkout decide the final price.
