# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Shopify embedded app (React Router 7 + Prisma/PostgreSQL, forked from the Shopify React Router app template) that lets merchants attach storefront marketing content (header banners, product-page offers, collection banners, product-card badges) to native Shopify discounts. The `README.md` is largely the untouched template README; the real setup/behaviour docs are `docs/storefront-setup.md` and `docs/promotion-designs.md`.

## Commands

- `npm run dev` — `shopify app dev` (tunnel required; storefront testing does not work with `--use-localhost` because the app proxy is called server-side by Shopify). `shopify.web.toml` predev runs `sync:promotion-ui` + `prisma generate`, and dev runs `prisma migrate deploy`.
- `npm run build` / `npm run typecheck` (`react-router typegen && tsc --noEmit`) / `npm run lint`
- `npm test` — runs `scripts/test-promotions.mjs`: esbuild bundles the `.ts/.tsx` tests (with a `?raw` import loader) to a temp dir, then runs everything under `node --test`. The list of test files is **hardcoded in that script** — add new test files there or they won't run. To run one test file, bundle it the same way or run a `.cjs` test directly, e.g. `node --test tests/priority-manager.test.cjs`.
- `npm run deploy` — `shopify app deploy`. `shopify.app.toml` is the one app config (client ID `c8717906a421013fbf5c47e976637862`); it is the default, so no `--config` flag is needed. Its webhook `api_version` must match `ApiVersion` in `app/shopify.server.ts` (July 2026; the installed `@shopify/shopify-api` supports no newer).
- `npm run setup` — `prisma generate && prisma migrate deploy`.

## Architecture

**Source of truth is Shopify discounts.** The app does not own discount logic. Discounts are created/edited/read through the Admin GraphQL API (`services/*.server.ts`, `graphql/*.graphql.ts`); the app stores only per-discount marketing config in `PromotionSettings` (keyed by `shop` + `shopifyDiscountId`; design is serialized in `designJson`, plus `priority` and per-placement `show*` flags). `PromotionCodeBatch` tracks bulk discount-code generation with leases/reconciliation. Shopify enforces eligibility minimums/geography at checkout; the app only controls messaging.

All promotion code lives in `app/modules/promotions/`:
- `adapters/` — maps raw Shopify discount nodes to the app's `ShopifyPromotion` model. `adapters/shopify/ProviderManager` picks a per-discount-type provider (`product`, `order`, `bxgy`, `shipping`, `unknown` fallback) via `supports(node)`; register new discount types in `adapters/shopify/registry.ts`. (This branch, `feature/free-shipping-support`, is adding shipping discounts.)
- `mappers/promotionMapper.ts` merges Shopify data + `PromotionSettings` into a `PromotionRecord`.
- `design/` — placements (`header`, `collection`, `product`, `badge`), editor draft/validation shared by create and edit, priority logic.
- `components/` — Polaris-based editor tabs; `PromotionPreview.tsx` exports `PromotionOffer` and CSS used by **both** the admin preview and server-rendered storefront markup, so they stay identical.
- **The create/edit editor** is `components/PromotionEditor.tsx` (saving, discarding, step gating, layout) plus `components/editor/`: `useDiscountForm.ts` holds every discount and website field and the section handlers; `TypeStep`, `ValueStep` (with `ProductValue`, `OrderValue`, `BxgyValue`, `ShippingValue`), `WhoStep`, `ScheduleStep` and `AdvancedStep` render one step each from the form (`form: DiscountForm`); `EligibilityPickerModal`, `editorStyles.ts` and `shared.tsx` hold the rest. Which step a field belongs to is also encoded in `design/stepValidation.ts` (per-step checks that reuse the server's `buildDiscountMutation`) and `design/saveIssueStep.ts` (maps a message to a step), so keep them in step when adding a field.
- `tests/editor-render.test.cjs` mounts the real editor in jsdom and compares its text and markup with `tests/editor-render.golden.json`. After an intended change to the editor's markup or text, re-record with `UPDATE_GOLDEN=1 node --test tests/editor-render.test.cjs`.
- `services/storefront*.server.ts` — storefront selection (highest `priority`, then newest saved wins when placements overlap), eligibility, and snapshotting.

**Storefront delivery: Shopify serves it, the app only publishes.** Shoppers' requests go to Shopify (Liquid, the theme app extension's CDN assets, Shopify Files images), not to the app server. `storefrontSnapshot.server.tsx` pre-renders public (all-customers) promotions with `renderToStaticMarkup` and, whenever a promotion or its discount changes, publishes version 3 as app-installation metafields (namespace `promotion_engine`): `storefront` (small JSON read on every page: HTML per placement, dates, priority; Shopify limits a JSON metafield to 128 KB), `scope_<id>` (one JSON per promotion with its product, variant and collection lists, read only on product and collection pages; the full list is read from Shopify in pages by `discountScope.server.ts`), `badge_<id>` (one compact text per promotion: its product IDs packed by `design/compactIds.ts`, plus the badge HTML) and `badge_index`. Liquid (`snippets/server-promotion.liquid`, blocks) renders the first paint and checks dates and scope itself; the loader embed joins the badge data into `<script id="promotion-engine-badges">` and `promotion-engine.js` decides each card's badge in the browser. A block with `data-snapshot-state="ready"` makes no request to the app (a product offer that depends on the chosen variant, `data-variant-scoped`, asks when the variant changes). Never put customer IDs, segment IDs or restricted content in any of this. Text metafields are limited to 64 KB, so one promotion's badge data is capped (about 9,000 products) and its lists (about 7,000); the sync names the promotion when it is too big. A card only knows its product, so a badge for a discount on collections lists the products found in those collections: `collectionProducts.server.ts` reads them (paged, retried when Shopify throttles, cached for 10 minutes, at most 9,000 per collection) while publishing, never while a shopper browses. `webhooks.collections.update` forgets a changed collection and republishes; `webhooks.products.update` republishes when the lists are due (a product can move in or out of a smart collection). Badge membership is therefore up to about 10 minutes behind a change in Shopify, while the product-page offer (Liquid `product.collections`) is immediate.

*Live app proxy (fallback only)*: `routes/promotion-storefront.tsx` (served at `/apps/promotion-engine`) authenticates via `authenticate.public.appProxy` and returns `{html, css, promotionId, revision}` as `no-store` JSON. The browser uses it only when no published data exists (before the first sync, or an old theme extension). Customer- and segment-restricted offers are not published and are not shown on the storefront yet (the editor says so); bringing them back means a live request for logged-in customers only.

`webhooks.discounts.changed` and save actions resync the snapshot. Storefront JS (`extensions/promotion-engine/assets/promotion-engine.js`, `promotion-placements.js`) fetches/hydrates and renders into shadow DOM; theme blocks (`blocks/*.liquid`) must be added explicitly by merchants — nothing (especially the header) is inserted automatically. Only the "Promotion Engine loader" app embed handles product-card badges.

**Duplicated file:** `app/modules/promotions/design/promotion-ui.js` is the source and is copied to `extensions/promotion-engine/assets/promotion-ui.js` by `scripts/sync-promotion-ui.mjs` (run automatically on dev/build/deploy). Edit the `app/` copy, never the extension copy.

Routing is file-based (`@react-router/fs-routes`, `app/routes.ts`); admin pages are `app.*` routes behind `authenticate.admin`. Prisma uses PostgreSQL through `DATABASE_URL` (see `docs/database.md`; copy `.env.example` to `.env`); add migrations with `npx prisma migrate dev`. `npm test` starts a temporary PostgreSQL itself (`embedded-postgres`, no Docker) and the database tests each get a schema of their own (`tests/helpers/database.ts`).

## UI conventions

Andy's rule: use Shopify's native functionality everywhere in the admin so the app keeps up to date as Shopify changes. Do not hand-build what a native component provides.
- **Components:** Polaris web components (`s-page`, `s-section`, `s-banner`, `s-table`, `s-modal`, `s-choice-list`, `s-color-field`, `s-date-field`, `s-search-field`, `s-clickable`, `s-heading`, `s-text`, …). React 18 does not bind their `change` events, so use the adapters in `components/PolarisControls.tsx` (`PolarisSelect`, `PolarisCheckbox`, `PolarisRadioList`, `PolarisCheckboxList`) or add native listeners; `ModalOverlay` opens `s-modal` from state.
- **Save/Discard:** the native App Bridge contextual save bar only (`PromotionSaveBar`). It cannot show messages: confirm saves with `shopify.toast.show`, and show failures and what is missing with `SaveNotices` (native banners). New promotions show the bar only once the form is valid (`saveIssue` in the editor); existing ones keep it visible with Save disabled.
- **Pickers:** `shopify.resourcePicker` for products and collections, `intents.invoke("pick:shopify/File")` for Shopify Files. There is no native customer or page picker, so those use a native `s-modal` (`LinkDestinationField`, the customer picker).
- **Known exceptions (no native equivalent):** `<details>` accordions (`FormStep`, fine-tune sections), the click-to-set focal point surface in `ImageEditModal` (inside a native `s-modal`; Shopify offers apps no image editor, only the `pick:shopify/File` picker), the drag-and-drop priority list (no native sortable list; it has Move up/Move down buttons for keyboard and touch), and the markup inside the storefront preview/snapshot (`PromotionPreview`), which renders on the merchant's theme.
- Pages should use `s-page` with `inlineSize="large"`, a breadcrumb link in `breadcrumb-actions`, and actions in the `primary-action` / `secondary-actions` slots.

## Handoff notes (from previous assistant)

Point-in-time summary as of commit `7c879d3` on `feature/free-shipping-support`; verify against the code before relying on it. Repo: https://github.com/AndySmiffys/smiffys-promotion-engine. The user (Andy, Head of eCommerce at Smiffys) wants a professional, Shopify-consistent editor that supports multiple themes and lets merchants control each placement's content, styling and visibility independently.

### Environment and deployment
- Andy's setup: Windows, Shopify CLI 4.9.2, Node v24.18.0. Update flow: `git pull --ff-only origin feature/free-shipping-support`, `npm ci`, `npm run setup`, `shopify app dev` (needs Node 22.12+; stop any running dev server before `npm ci` or Windows locks `esbuild.exe`). After committed updates, give Andy the local pull/restart command.
- Production: `npm run setup`, `npm run build`, `npm start`. Theme extension/app config deploys separately via `shopify app deploy`; git updates never activate theme blocks or deploy production.
- There is one app config, `shopify.app.toml` (client ID `c8717906a421013fbf5c47e976637862`). Earlier there were two files with different app IDs; the other was a template leftover and was removed. The CLI may rewrite `shopify.app.toml` when deploying; check `git diff` afterwards.
- `docs/promotion-designs.md` has an obsolete `--use-localhost` instruction in its free-shipping section; follow `docs/storefront-setup.md` (public tunnel).

### Key behaviours and decisions
- Shared create/edit editor (`PromotionEditor.tsx`, `PromotionWebsiteEditor.tsx`) so validation and controls stay consistent. Each selected placement has its own settings; no shared styling or single-select overrides.
- Shopify owns discount rules; local settings own presentation. Discount IDs are canonicalised (`design/discountIdentity.ts`: DiscountNode / DiscountCodeNode / DiscountAutomaticNode) so saved designs don't vanish when Shopify returns a different node type.
- Website-only edits skip native discount updates. Updates omit purchase-type/subscription fields the editor doesn't expose (preserves existing values, avoids errors on stores without subscriptions).
- Eligibility is checked before priority; priority must never bypass customer/product restrictions. Priority is one drag-and-drop order on its own page (`app.storefront-priorities.tsx`, `PromotionPriorityManager`), stored as the existing `priority` number (top of the list = highest; saving writes N down to 1). Only promotions that can appear are ranked (`design/ranking.ts`: not ended, website Enabled, a block chosen). The editor never writes `priority`: `priorityForSave` keeps a saved promotion's place and puts a promotion entering the order at the top, and the save response's `rankEntry` takes the merchant to the priority page to place it. Priority-only saves preserve designs and rules. The website status (Enabled/Draft) is set in the overview card (`PromotionOverview`) at the top of the editor, not in the Website step or the preview. There is no "include in sync" setting: an enabled promotion always syncs. The `included` column remains in the database, is never read, and is written as true on every save.
- Codes: one reusable shared code by default (no implicit usage limits). Generated lists up to 10,000, imported in persistent batches of up to 250 with reconciliation/retry; closing the page pauses submission and reopening resumes (no background worker). CSV export needs a fully confirmed list. Multi-code lists are excluded from public shared-code display.
- Free-shipping countries come from active shipping configuration; existing selections are preserved if coverage changes or the permission is missing.
- Missing Shopify discounts are omitted from lists without deleting saved designs. Unsupported/oversized native configs fall back to a detail/website editor with an "Edit in Shopify" link.
- Snapshot metafield `promotion_engine.storefront` is version 2. It is published on app init/upgrade (`app/routes/app.tsx`), listing refresh, create/edit/priority saves and discount/code webhooks, with compare-digest concurrency checks. Initial HTML uses scoped CSS; JS moves it into shadow DOM after parsing. A failed live validation keeps the initial offer until its known expiry; a successful empty response removes it. No reserved height when nothing is eligible. Restricted customer offers and scopes hitting API limits render live and can still shift layout.
- Keep legacy generic `blocks/promotion.liquid` and saved designs compatible. Collection banners use dedicated wrappers with Content width / Full page width modes (earlier viewport-margin approaches caused overflow).

### Known issues
- `npm test`: 83 passed. `npm run build` passes. **`npm run typecheck` fails on existing errors**: unsupported Polaris `fontWeight`/`"subdued"` props in `PromotionBxgyTab.tsx`, `PromotionCustomersTab.tsx`, `PromotionGeneralTab.tsx` and `app/routes/app.promotions.tsx`, plus a nullable count passed as a number in `PromotionProductsTab.tsx`.
- Lint previously found two accessibility errors in the promotion-list modal (not rerun). Build emits React Router future-flag warnings; npm warns about `http-proxy` and `shamefully-hoist` config.
- Shopify test orders did not visibly increment the discount usage counter; no app-side fix exists. Shopify may show an "app-created code" panel with one code; that does not make it single-use.
- Uploaded Shopify Files are kept after Discard so they can be reused.
- Third-party theme compatibility isn't guaranteed (badge selectors are configurable; clipping themes may need their own full-width setting). Checkout stays authoritative for geography, minimums and eligibility.
- Lighthouse (desktop only): performance 75→91, CLS 0.222→0.0006. Still to validate: mobile Lighthouse, no-eligible-promotion (no blank space), future schedules, customer/segment-restricted offers, Dawn/Horizon behaviour (variants, filters, quick-add, theme-editor reloads), and production field performance.

### Andy's preferences
- Match Shopify's control/button styling; contextual Save/Discard bar (only when unsaved changes); errors below the bar.
- Content and styling controls stacked, one per line; group related settings and explain their effect; only show sections for selected blocks.
- Keep visibility guidance near the preview, not duplicated. Image selectors directly clickable, no redundant buttons. Keep create and edit consistent.
- Support multiple themes including Dawn and Horizon.
- Smiffys marketing tone/imagery: fun and family-friendly (Andy rejected a dark masquerade concept).

### Next work
No code patch is in progress. The SLT Halloween demo promotion is finished. What remains is in `PROGRESS.md`: the storefront validation that needs a real store (mobile and no-promotion checks, Dawn and Horizon, future schedules, restricted offers, production), deploying the app config with `shopify app deploy`, and Polaris 2 once the save bar issue under it is fixed.
