# Progress

Status of the Smiffys Promotion Engine, a Shopify embedded app that creates and edits native Shopify discounts and manages how they appear on the storefront. Last updated 19 October 2026.

Branch `feature/free-shipping-support`, at `f2c6a00`, pushed and up to date with GitHub. 141 tests pass, and lint, typecheck and the build are clean.

For the architecture and the rules to follow when changing the code, see `CLAUDE.md`. For setup and storefront behaviour, see `docs/storefront-setup.md` and `docs/promotion-designs.md`.

## What the app does

- **Create and edit native Shopify discounts** (product, order, buy X get Y and free shipping; code or automatic) in one shared editor.
- **Control how each promotion looks on the storefront** through four blocks: header announcement, collection banner, product offer and product badge.
- **Rank promotions** in one drag-and-drop priority order.

## Done

### Discounts and codes
- Shared create/edit editor for all four types, code or automatic. Existing discounts are updated, not replaced, and website-only edits skip the rule update.
- Free-shipping countries come from the store's shipping setup. Customer segments, schedules, usage limits and combinations are editable.
- One shared code by default. Generated code lists of up to 10,000, in resumable batches with CSV export.
- Unsupported or oversized discounts open on a fallback page that edits the website promotion only.

### The editor
- **Six collapsible steps:** Type and method, Discount value (or Countries), Who can use it, Schedule, Advanced options and Website promotion. Steps after the first incomplete one are locked, Continue stays greyed until a step is valid, and steps show Complete or Needs attention once opened.
- **One overview card at the top:** name, type, Shopify status, website visibility, a plain-English summary, the Website promotion status (Enabled or Draft), the priority position with a link to change it, and what is left before saving.
- **Validation** reuses the server's own checks (`design/stepValidation.ts`), so Save only appears for a discount Shopify will accept.
- **Native Shopify save bar,** with toasts for success and banners for failures and missing items.
- The editor is split into `PromotionEditor.tsx` plus `components/editor/` (a form hook and a component per step).

### Website promotion design
- **Campaign content and colours set once:** headline, body, button, countdown label and images apply to Header, Collection and Product together. Fine-tune sections override per block and show the campaign wording in grey while following it.
- **Campaign colours:** main colour, secondary colour, button text colour, and two text colours (on colour and on white), chosen per surface by contrast. Blocks showing an image get a white background. A live list shows where each colour is used and flags low contrast.
- **One link destination picker** for collections, products, pages, blogs or a web address.
- **Header block is always square.** The preview shows each block in a realistic mock storefront and can be enlarged.

### Priority
- One drag-and-drop order for the whole storefront, with Move up and Move down for keyboard and touch. It lists only Active and Scheduled promotions that can appear on the website, and explains the rest.
- A promotion that joins the order starts at the top, and the merchant is taken to place it. The editor never writes priority; it is stored in the existing `priority` number.
- The "include in promotion sync" setting is removed: an enabled promotion syncs.

### Storefront
- **Served from Shopify:** published offers and badges make no requests to the app server (see `CLAUDE.md`). The old design asked the app on every page view, every 60 seconds and once per product card; for about 6,000,000 page views a year that was most of the load and used the shop's Admin API allowance. The app now works only when a promotion changes. Customer-specific offers are paused (not shown) until a logged-in-only path is built. **After pulling:** run `shopify app deploy` for the theme extension, then open the app (it republishes version 3), and save or sync once. Check a collection page in the Network tab: no `/apps/promotion-engine` requests.
- Public promotions are published to an app metafield and rendered in Shopify's first HTML response, so there is no layout shift. A desktop Lighthouse run went from CLS 0.222 to 0.0006.
- Signed app-proxy route for customer-specific offers. Automatic badges for Dawn and Horizon.

### Quality
- The admin uses Shopify's native components (Polaris web components and App Bridge) throughout. The exceptions are listed in `CLAUDE.md`.
- Tests render the real editor in a simulated browser (`tests/editor-render.test.cjs`, with a recorded baseline, and `tests/editor-flows.test.cjs`). Run with `npm test`.

## Needs doing

### Needs checking in a browser
None of the following has been seen in a real browser by the assistant, only tested in a simulated one: the priority page and dragging, the overview card and the status control, the stepped form, the preview and its modals, and the native event wiring on the Shopify components. Please try them in the dev store. Start with a new promotion, Enabled and Draft, and the priority page.

### Storefront validation
- Mobile Lighthouse.
- A page with no eligible promotion, to confirm there is no blank space.
- Future schedules, and customer or segment-restricted offers (these render live and can still shift layout).
- Dawn and Horizon with variants, filters, quick-add and theme-editor reloads.
- The newer rules on a live theme: white backgrounds on image blocks, button text colours and the square header.
- Production deployment and field performance.

### Housekeeping
- **Vulnerabilities:** `npm audit --omit=dev` reports 0. The Prisma CLI chain (`deepmerge-ts` stack exhaustion) is cleared by an `overrides` entry forcing `deepmerge-ts` 8.0.2, so the app stays on Prisma 6. A Prisma 7 upgrade was ruled out: `@shopify/shopify-app-session-storage-prisma` (latest 11.0.1) only supports Prisma ^6.19, and Prisma 7 is now the previous release (latest is 8.0 RC). Revisit when Shopify's package supports a newer Prisma, and remove the override then. 41 high-severity advisories remain in dev tooling only (codegen, ESLint, graphql-config).
- **Config:** one app config, `shopify.app.toml`, for the app with client ID `c8717906a421013fbf5c47e976637862` (confirmed by Andy). The old second file (a different app ID) was removed. Webhook API version is 2026-07, matching `app/shopify.server.ts`. Run `shopify app deploy` to apply it: it adds the `app/uninstalled` and `app/scopes_update` subscriptions the live app was missing and moves the webhooks from 2026-10 to 2026-07.
- The Shopify CLI may remove `include_config_on_deploy = true` from the real config when it deploys. Restore it if it does.

### Platform
- **Polaris 2.0 (release candidate):** prepared but switched off. The app's `polarisUrl` (one constant in `app/shopify.server.ts`, used by `shopifyApp()` and `AppProvider`) is set to the current `polaris.js`. The packages needed for Polaris 2 are in place (`@shopify/shopify-app-react-router` 3.0.2, Node 22+, `@shopify/polaris-types` 2.0.0-rc.3). When enabled with `polaris-2.0-rc.js`, a store without the new admin design showed a restyled page header (plain breadcrumb link, white pill buttons), and the edit page threw `saveBar.hide is not a function` from the App Bridge save bar. Switching back to `polaris.js` fixed both, so the Polaris 2 script (rc.3) is the cause and the package upgrade is fine. Before enabling it, test on a dev store with the new admin design (`shopify store create dev --feature-preview new_admin_design`) and one without it, find out why the save bar fails under Polaris 2 (it may need a newer release candidate or a change to how `PromotionSaveBar` is mounted), and check hand-written colours (the greys in the editor styles) and the Inter stylesheet in `app/root.tsx`. Built for Shopify apps have until 1 May 2027.

## Known limitations

- Arbitrary third-party themes are not guaranteed to work; badge selectors are configurable.
- Checkout stays authoritative for geography, minimums and eligibility.
- Shopify test orders did not increment the discount usage counter in an earlier test. No app-side fix exists.
- Generated code imports pause when the page is closed and resume when it is reopened (no background worker). Uploaded Shopify Files stay after Discard so they can be reused.
- Browser drag-and-drop does not work on touch, so the priority page also has Move up and Move down buttons.
- Priority numbers of ended or draft promotions are left alone. A promotion that becomes active again slots in by its old number.

## Deployment

- The app was deployed with `shopify app deploy` after adding the `read_online_store_pages` scope, and Pages and Blogs now list in the link picker.
- A git push never deploys to Shopify or activates theme blocks. Redeploy the extension for theme changes, and re-add blocks per theme.
- Existing stores republish the storefront snapshot automatically the next time the app opens after the shared CSS changes.

## Ideas

- A duplicate-promotion action.
- Templates, for example a Halloween 20% off that pre-fills the discount and the website design.
- A storefront health panel on Home, showing whether the loader embed and blocks are set up.
- A "why isn't mine showing?" hint on each priority row.
- A preview of what a given visitor would see, such as a chosen customer or date.
