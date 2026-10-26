# Shipping countdown

A product-page block that shows a free-shipping message, a dispatch countdown ("Order in the next 1 hour 21 minutes for dispatch on Monday 26 Oct"), the days you ship, and an optional dated warning notice. It replaces the old "Shipping countdown" theme block. **All business settings live in the app** (Shipping countdown in the app's menu); the block itself only has its look.

## How it fits together

- **Settings** are one JSON document in an app-installation metafield, `shipping_countdown.config` (`app/modules/shipping/config.ts` describes it and validates it; `config.server.ts` reads and writes it through the Admin API).
- **The block** (`extensions/promotion-engine/blocks/shipping-countdown.liquid`) reads `app.metafields.shipping_countdown.config.value`, renders the free-shipping line, the warning and the days on the server, and passes the settings to its script as `<script type="application/json">`. Shopify's `json` filter keeps the text from breaking out of the tag.
- **The script** (`assets/shipping-countdown.js`) holds pure date and message functions, and a single `<shipping-countdown>` element (defined once, however many blocks are on the page). The app's preview loads the same file, so the preview cannot disagree with the shop.
- **Time**: "now" and every calendar day are London's, taken from `Intl.DateTimeFormat` with `timeZone: "Europe/London"`. The shopper's time zone is never used. Days are `YYYY-MM-DD` strings; day arithmetic is done in UTC on those strings.

## Rules

- Dispatch is today when today is a shipping day, not a bank holiday, and before the cut-off; otherwise the next such day (searched up to 30 days ahead). The countdown is the real time to that day's cut-off: under 24 hours "X hours Y minutes", from 24 hours "X days Y hours".
- **Delay** (delay days above 0) replaces the countdown with dispatch from the Nth shipping day after today, whatever the time of day. Wrap words in `[highlight]` and `[/highlight]` to colour them.
- **Free shipping** thresholds are entered per currency in that currency (pounds as `50` or `49.50`). Nothing is converted: a cart in a currency with no threshold shows no free-shipping message, so adding a market means adding a row. "This item reaches it" uses the chosen variant's price times the chosen quantity.
- **Sold-out variants** (unavailable, or sold while out of stock) never get a dispatch date: they show the pre-order message, or the line is hidden, as set.
- **The warning notice** shows between its first and last day inclusive by London's date.
- The cart is read once, debounced (300 ms), from `/cart.js` after cart events, or taken from an event that carries the cart.

## Adding the block

1. Deploy the theme extension to the right app (test first: `shopify app deploy --config test`).
2. In the app, open **Shipping countdown**, check each section and **Save**. Until it is saved the block shows nothing (the theme editor says so).
3. In the theme editor, open a product template, **Add block** under the product information and choose **Shipping countdown** (listed under the app). Set its alignment, colours and spacing.
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
| `show_free_shipping`, `free_shipping_threshold` | Free shipping (threshold per currency, in pounds, not pence) |
| `free_shipping_text_under`, `_add_item`, `_over` | Free shipping (`{threshold}` is replaced everywhere it appears) |
| `warning_notice_*` | Warning notice (the colours are new settings) |
| `timezone` | Gone: always London |
| Block style settings (alignment, icon, sizes, colours, spacing, radius) | Unchanged, same ids and defaults, on the block |

## Tests

`tests/shipping-countdown.test.cjs` (the date and message functions with fixed instants: cut-offs, bank holidays, the Christmas run, both clock changes, other visitor time zones, delay mode, thresholds), `tests/shipping-countdown-element.test.cjs` (the real block rendered and driven in a simulated browser) and `tests/shipping-config.test.ts` (validation, the bank-holiday import). Run with `npm test`.

## Still to check on a real theme

Variant and quantity changes, quick-add and cart-drawer updates on Dawn and Horizon, mobile layout, the first-paint space (no jump), and the theme editor's reloads. The script is about 18 KB, over the 10 KB Shopify's theme check suggests for an app block's JavaScript (a warning, not an error).
