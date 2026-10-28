# Shipping countdown

A product-page block that shows a free-shipping message, a dispatch countdown ("Order in the next 1 hour 21 minutes for dispatch on Monday 26 Oct"), the days you ship, and an optional dated warning notice. It replaces the old "Shipping countdown" theme block. **Everything lives in the app** (Shipping countdown in the app's menu): the wording, the rules and the look. The block has no settings in the theme editor; you only choose where it goes.

## How it fits together

- **Settings** are one JSON document in an app-installation metafield, `shipping_countdown.config` (`app/modules/shipping/config.ts` describes it and validates it; `config.server.ts` reads and writes it through the Admin API).
- **The block** (`extensions/promotion-engine/blocks/shipping-countdown.liquid`) reads `app.metafields.shipping_countdown.config.value`, renders the free-shipping line, the warning and the days on the server, and passes the settings to its script as `<script type="application/json">`. Shopify's `json` filter keeps the text from breaking out of the tag.
- **The script** (`assets/shipping-countdown.js`) holds pure date and message functions, and a single `<shipping-countdown>` element (defined once, however many blocks are on the page). The app's preview loads the same file, so the preview cannot disagree with the shop.
- **Time**: "now" and every calendar day are London's, taken from `Intl.DateTimeFormat` with `timeZone: "Europe/London"`. The shopper's time zone is never used. Days are `YYYY-MM-DD` strings; day arithmetic is done in UTC on those strings.

## Delivery services and estimated delivery dates

A **Delivery options** dropdown under the dispatch message lists each service the shopper can choose in their country, with its price and the date it should arrive. It is switched on, and its wording set, in the **Delivery services** step of Shipping countdown; the services themselves are set up on the **Shipping** page, beside the shipping options they come from.

- **A service is a Shopify shipping option.** All the rates with one name in a zone (one per price band) are one service. Shopify only allows a free threshold on a single option, so a service whose price changes with the order total is two or more lines with the same name (for example "£4.99 up to £29.99" and "£2.99 from £30"); the app joins them into one service with its price break. Names are matched ignoring stray or doubled spaces and capital letters, so a slightly different spelling still joins.
- **A country split into zones by region.** A zone can cover only some regions of a country ("Domestic": England, Scotland and Wales; "Northern Ireland" its own zone). A product page only knows the shopper's country, not their region, so it shows the options of the zone covering the most regions (then the first listed), for both free delivery and delivery services. Checkout uses the shopper's address and offers the right ones. The Shipping page shows which regions each zone covers, and explains a split like this when the zones offer different things. The app reads the name, the price bands and the delivery time from Shopify, and publishes them, with the free-delivery table, to the app metafield `shipping_countdown.delivery_services` (by zone, with each country pointing at its zone; refreshed when the Shipping page opens, on first use, and when Shopify sends `profiles/*`). Only the general profile is used, as for free delivery.
- **Delivery times** ("2 business days" in Shopify's Shipping zones screen) are only offered by Shopify's **unstable** API, so they are read by a separate optional request that can never break the Shipping review. If it stops working, type the days into the service; a time typed here always wins over Shopify's. A service with no delivery time from either place is listed in the settings with a warning, and **no date is shown for it** on the product page.
- **Where it is set up.** The **Shipping** page has a **Delivery services** section with a card per service and its own Save, so the options and what the app adds to each are together. Shipping countdown keeps the on/off switch, the dropdown heading and the two messages, with a link to the Shipping page straight under the switch. Each page saves only its own part: saving Shipping countdown keeps the services already saved on the Shipping page, and the other way round.
- **What the app adds per service**, matched by the option's name (a rename in Shopify detaches the settings, which the page shows with a warning and a Remove button): whether it is **guaranteed**, a shorter display name (Shopify names often carry the cut-off and "Non Guaranteed", which are set here instead), the **days the carrier delivers** (Monday to Friday, Saturday, Sunday), whether it **delivers on bank holidays**, an optional **cut-off** of its own, a delivery time, and whether to show it. Only what differs from the defaults is saved.
- **Nothing is promised that was not chosen.** Every service is non-guaranteed until set otherwise. A guaranteed service says "Delivery by Wed 28th Oct"; every other says "Delivery by Wed 28th Oct (Non-Guaranteed)". Both messages are editable (with bold and highlight) using `{date}` (the latest date), `{from}` (the earliest) and `{service}`, listed above the message boxes. The month is always shown ("Wed 28th Oct"), because near a month's end "Fri 30th" could be this month or the next.
- **How the date is worked out** (the pure engine in `shipping-countdown.js`, tested in `tests/shipping-delivery.test.cjs`): the order is dispatched by the service's cut-off (the shop's when it has none), on the shop's dispatch days, skipping bank holidays, or on the warehouse delay date when one is set; then the delivery time counts only the days that carrier delivers, skipping bank holidays unless it delivers on them. A Friday dispatch with a next-working-day weekday carrier arrives Monday; a Saturday carrier delivers on Saturday. The date after "by" is the longest time.
- **Prices** come from the price bands: "£6.99, or £4.99 on orders of £30 or more", "£3.99, or free on orders of £30 or more", or "From £4.99" when the price also depends on weight. They are in the shop's currency; a cart in another currency shows no dropdown.
- **The button that opens the list** has its own words (default "View Delivery Options", with bold and highlight), text size (10 to 32 px, default 16) and position (left, centre or right), set in the Delivery services step of Shipping countdown. Its arrow is drawn by the stylesheet, because themes often reset how `<summary>` looks and hide the browser's own arrow; the browser's marker is removed so there is never a second one.
- **The dropdown** is a native disclosure (it opens without a script), soonest first then cheapest. It is hidden for a variant that is out of stock or zero stock with continue selling, like the dispatch date. The settings preview shows it for any day, time, stock case and country.

## Bold and highlight in every wording

Every wording box on the settings page (the countdown prefix and suffix, the days prefix, no dispatch day and error text, the free-delivery messages, the two stock messages, the delay message and the warning) is a small formatting editor. Select words and press **Bold** or **Highlight** (or Ctrl+B and Ctrl+Shift+H); the box shows the result as you type, and so does the preview. Highlight is the countdown's colour, from Appearance. A message is one paragraph: Enter does nothing, and pasted text loses its line breaks and formatting.

- **What is stored** is the same text as before with two tags, `[bold]…[/bold]` and `[highlight]…[/highlight]`, so wording saved before the editor (the delay message's `[highlight]`) works unchanged. The editor always writes them closed and nested; saving rejects anything that is not.
- **On the product page** the tags become `<strong>` and a highlight `<span>`, and nothing else in a message can become markup: the server escapes the whole message first and only turns these four fixed tags into HTML (`snippets/shipping-rich.liquid`), and the script builds the same from text nodes. Anything in braces is a placeholder, filled in before the formatting is read, so `[bold]{rate}[/bold]` works.
- **The editor is hand-built.** Shopify has no rich text field, so this is one of the few exceptions to using native components, like the image focal-point picker. It lives in `app/modules/shipping/RichTextField.tsx`, with the editing rules (select characters, toggle a format, write back the tags) in `richText.ts`, which reads messages with the storefront script's own `parseRich` so the editor and the product page cannot disagree.

## Placeholders in the free-delivery messages

The three free-delivery wordings (under the threshold, this item would reach it, and reached) can use these. Write one in braces and the product page fills it in for each shopper. Each can be used more than once, and the settings page lists them with an example for the country in the preview.

| Placeholder | What it becomes | Example |
| --- | --- | --- |
| `{threshold}` | The order total that unlocks free delivery, in the shopper's currency (pence kept: £49.50) | £50 |
| `{country}` | The shopper's country | United Kingdom |
| `{rate}` | The name of the free delivery option in your Shopify shipping settings, for that shopper's country | Free delivery |

Anything else in braces, such as `{thresold}`, is rejected when saving, so a typo is never shown to shoppers. The other messages (dispatch, delay, out of stock, back-order, warning) are fixed wording with no placeholders.

## Shipping review

The **Shipping** page reads Shopify's shipping setup (delivery profiles, zones, rates and their conditions, and your Markets) and shows where free delivery is offered and from what order total. Free delivery in Shopify is a rate that costs nothing: either with a minimum order total (the threshold), or with no condition (always free). The page lists problems and suggestions with a link into Shopify's own settings to fix each. It only reads; changes are made in Shopify.

- **Checks:** no rates at all; a zone with none switched on; order totals no rate covers (for example a paid rate stopping at £49.50 and a free rate starting at £50); a free rate switched off; no free service anywhere; always-free zones next to zones that need a minimum; countries in an active Market with no shipping; zones to countries nobody sells to; custom profiles whose threshold differs from the general profile's.
- **Where the product page gets its figure:** the app publishes a small table, by country, from the **general (default) profile** to the app metafield `shipping_countdown.delivery`, and the block reads it with the shopper's country. A custom profile with a different threshold is flagged, because the message follows the general profile.
- **Staying current:** the app republishes when the Shipping page is opened (only writes if something changed), the first time the app is opened, and when Shopify sends `profiles/create`, `profiles/update` or `profiles/delete`.
- **Permissions:** `read_shipping` (already granted) and `read_markets`. Without Markets the review still works and says what it could not check.

## Rules

- Dispatch is today when today is a shipping day, not a bank holiday, and before the cut-off; otherwise the next such day (searched up to 30 days ahead). The countdown is the real time to that day's cut-off: under 24 hours "X hours Y minutes", from 24 hours "X days Y hours".
- **Delay** (delay days above 0) replaces the countdown with dispatch from the Nth shipping day after today, whatever the time of day. Select words in the message and use **Highlight** to colour them like the countdown.
- **Free shipping** is read from Shopify's shipping settings, never typed in (see Shipping review below). Each shopper gets the free-delivery rule for their own country: free from an order total, always free, or nothing. The message only shows for a cart in the shop's currency, and nothing is converted. "This item reaches it" uses the chosen variant's price times the chosen quantity. Wording can use the placeholders below.
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

`tests/shipping-countdown.test.cjs` (the date and message functions with fixed instants: cut-offs, bank holidays, the Christmas run, both clock changes, other visitor time zones, delay mode, thresholds), `tests/shipping-countdown-element.test.cjs` (the real block rendered and driven in a simulated browser) and `tests/shipping-config.test.ts` (validation, the bank-holiday import), `tests/shipping-review.test.ts`, `tests/shipping-page.test.tsx` and `tests/rich-text-field.test.cjs` and `tests/shipping-rich-text.test.ts` (the formatting editor and its rules), `tests/shipping-services-page.test.cjs` (the services on the Shipping page), `tests/shipping-config-server.test.ts` (saving the two parts), `tests/shipping-delivery.test.cjs` (the delivery date engine) and `tests/shipping-delivery-services.test.ts` (the published services table), `tests/shipping-sync.test.ts` (reading Shopify's shipping, the free-service finder, the review checks, the Shipping page, and publishing the table) and `tests/shipping-appearance.test.ts` (the block and the app agree on the look). Run with `npm test`.

## Still to check on a real theme

Variant and quantity changes, quick-add and cart-drawer updates on Dawn and Horizon, mobile layout, the first-paint space (no jump), and the theme editor's reloads. The script is about 18 KB, over the 10 KB Shopify's theme check suggests for an app block's JavaScript (a warning, not an error).
