# Shipping countdown

A product-page block that shows a free-shipping message, a dispatch countdown ("Order in the next 1 hour 21 minutes for dispatch on Monday 26 Oct"), the days you ship, and an optional dated warning notice. It replaces the old "Shipping countdown" theme block. **Everything lives in the app** (Shipping countdown in the app's menu): the wording, the rules and the look. The block has no settings in the theme editor; you only choose where it goes.

## How it fits together

- **Settings** are one JSON document in an app-installation metafield, `shipping_countdown.config` (`app/modules/shipping/config.ts` describes it and validates it; `config.server.ts` reads and writes it through the Admin API).
- **The block** (`extensions/promotion-engine/blocks/shipping-countdown.liquid`) reads `app.metafields.shipping_countdown.config.value`, renders the free-shipping line, the warning and the days on the server, and passes the settings to its script as `<script type="application/json">`. Shopify's `json` filter keeps the text from breaking out of the tag.
- **The script** (`assets/shipping-countdown.js`) holds pure date and message functions, and a single `<shipping-countdown>` element (defined once, however many blocks are on the page). The app's preview loads the same file, so the preview cannot disagree with the shop.
- **Time**: "now" and every calendar day are London's, taken from `Intl.DateTimeFormat` with `timeZone: "Europe/London"`. The shopper's time zone is never used. Days are `YYYY-MM-DD` strings; day arithmetic is done in UTC on those strings.

## Shipping review

The **Shipping** page reads Shopify's shipping setup (delivery profiles, zones, rates and their conditions, and your Markets) and shows where free delivery is offered and from what order total. Free delivery in Shopify is a rate that costs nothing: either with a minimum order total (the threshold), or with no condition (always free). The page lists problems and suggestions with a link into Shopify's own settings to fix each. It only reads; changes are made in Shopify.

- **Checks:** no rates at all; a zone with none switched on; order totals no rate covers (for example a paid rate stopping at £49.50 and a free rate starting at £50); a free rate switched off; no free service anywhere; always-free zones next to zones that need a minimum; countries in an active Market with no shipping; zones to countries nobody sells to; custom profiles whose threshold differs from the general profile's.
- **Where the product page gets its figure:** the app publishes a small table, by country, from the **general (default) profile** to the app metafield `shipping_countdown.delivery`, and the block reads it with the shopper's country. A custom profile with a different threshold is flagged, because the message follows the general profile.
- **Staying current:** the app republishes when the Shipping page is opened (only writes if something changed), the first time the app is opened, and when Shopify sends `profiles/create`, `profiles/update` or `profiles/delete`.
- **Permissions:** `read_shipping` (already granted) and `read_markets`. Without Markets the review still works and says what it could not check.

## Rules

- Dispatch is today when today is a shipping day, not a bank holiday, and before the cut-off; otherwise the next such day (searched up to 30 days ahead). The countdown is the real time to that day's cut-off: under 24 hours "X hours Y minutes", from 24 hours "X days Y hours".
- **Delay** (delay days above 0) replaces the countdown with dispatch from the Nth shipping day after today, whatever the time of day. Wrap words in `[highlight]` and `[/highlight]` to colour them.
- **Free shipping** is read from Shopify's shipping settings, never typed in (see Shipping review below). Each shopper gets the free-delivery rule for their own country: free from an order total, always free, or nothing. The message only shows for a cart in the shop's currency, and nothing is converted. "This item reaches it" uses the chosen variant's price times the chosen quantity. Wording can use `{threshold}` and `{country}`.
- **Stock.** A variant that cannot be dispatched now never gets a dispatch date, and the two cases are told apart, each with its own wording or a hide option:
  - **Out of stock:** the variant is unavailable, so it cannot be bought.
  - **Zero stock, continue selling:** stock is tracked and is zero or below, but "Continue selling when out of stock" is on, so it can still be bought (a back-order or pre-order). Shopify only reports zero when stock is tracked.
  An out of stock item never counts towards the free-delivery threshold, because it cannot be added to the basket.
- **The warning notice** shows between its first and last day inclusive by London's date.
- The cart is read once, debounced (300 ms), from `/cart.js` after cart events, or taken from an event that carries the cart.

## The settings page

Laid out like the promotion editor, so the app feels the same throughout: the **Storefront preview** stays in view on the left, and the settings are numbered step cards on the right, one open at a time, with **Appearance** first. On a narrow screen the preview is behind a **Preview** button.

- The preview is the block's own markup and stylesheet and the same logic file, so it shows exactly what the product page will.
- It has controls to see the block in other situations: **a day and time** (London) to see it on a set day, a **stock** choice (in stock, out of stock, zero stock with continue selling) and the **country** of the shopper.

## Adding the block

1. Deploy the theme extension to the right app (test first: `shopify app deploy --config test`).
2. In the app, open **Shipping countdown**, check each section and **Save**. Until it is saved the block shows nothing (the theme editor says so).
3. In the theme editor, open a product template, **Add block** under the product information and choose **Shipping countdown** (listed under the app). There is nothing to set there; the look is in the app under **Appearance**.
4. Remove the old theme block, then the old "Shipping settings" in Theme settings.

## Moving the old theme settings

| Old theme setting | Now |
| --- | --- |
| `cutoff_time` | Dispatch → Daily cut-off time |
| `ships_monday` … `ships_sunday` | Dispatch → Days orders are dispatched |
| `show_shipping_days`, `shipping_days_prefix` | Dispatch |
| `countdown_prefix`, `countdown_suffix`, `no_shipping_text`, `error_text`, `hide_if_unavailable` | Dispatch |
| `bank_holidays` | Bank holidays (one `YYYY-MM-DD` per line; **Import UK bank holidays** adds gov.uk's England and Wales dates) |
| `delay_days`, `delay_message` | Warehouse delay |
| `show_free_shipping` | Free shipping: show the message |
| `free_shipping_threshold` | Gone: read from Shopify's shipping settings (see Shipping review) |
| `free_shipping_text_under`, `_add_item`, `_over` | Free shipping (`{threshold}` and `{country}` are replaced everywhere they appear) |
| `warning_notice_*` | Warning notice (the colours are new settings) |
| `timezone` | Gone: always London |
| Block style settings | Appearance in the app, with the same defaults, simplified (below) |

## Appearance

The old block had 17 settings; the app has fewer, better chosen ones, and the defaults reproduce the old look exactly.

- **One text size** (default 16 px). The days line (87.5%) and the icon (1.5 times) scale with it, replacing separate sizes for each.
- **Padding** is Compact, Standard (16/24 px, as before) or Roomy, replacing two sliders. On phones it is 20% smaller, inside the box.
- **Border** is Double (as before), Solid or None, with a width.
- **Space between lines** (default 8 px) is one gap between every line in the block (the icon, the free delivery line, the dispatch line, the days line, and the warning above). Nothing else adds space between them: the dispatch line holds a single line while it loads, the icon has no margin of its own, and every line uses the same line height.
- **Colours**: background, text, time left, dispatch day and border, secondary text, icon. The separate "expired text" colour is now the secondary text colour. The warning notice has its own colours.
- The app warns when text would be hard to read on its background (4.5 to 1 for text, 3 to 1 for the icon).
- The preview in the app is the block's own markup and stylesheet. A test renders the block's Liquid and checks it writes the same attributes and variables the app's preview does.
- Settings saved before Appearance existed still work: the block falls back to the stylesheet's defaults until they are saved again.

## Tests

`tests/shipping-countdown.test.cjs` (the date and message functions with fixed instants: cut-offs, bank holidays, the Christmas run, both clock changes, other visitor time zones, delay mode, thresholds), `tests/shipping-countdown-element.test.cjs` (the real block rendered and driven in a simulated browser) and `tests/shipping-config.test.ts` (validation, the bank-holiday import), `tests/shipping-review.test.ts`, `tests/shipping-page.test.tsx` and `tests/shipping-sync.test.ts` (reading Shopify's shipping, the free-service finder, the review checks, the Shipping page, and publishing the table) and `tests/shipping-appearance.test.ts` (the block and the app agree on the look). Run with `npm test`.

## Still to check on a real theme

Variant and quantity changes, quick-add and cart-drawer updates on Dawn and Horizon, mobile layout, the first-paint space (no jump), and the theme editor's reloads. The script is about 18 KB, over the 10 KB Shopify's theme check suggests for an app block's JavaScript (a warning, not an error).
