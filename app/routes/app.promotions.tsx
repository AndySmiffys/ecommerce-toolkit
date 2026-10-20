import { syncStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";
import { useEmbeddedAppUrl } from "../modules/navigation/embeddedAppUrl";
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigation, useRevalidator, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate, unauthenticated } from "../shopify.server";
import { isOtherApp, sourceFromParam } from "../modules/promotions/design/discountSource";
import { buildIndex, countActivePromotions, creatorsOf, deleteSourceRule, forgetDiscounts, indexIsDue, indexState, isIndexing, listFromIndex, listSourceRules, otherApps, saveSourceRule } from "../modules/promotions/services/discountIndex.server";
import { getStatusTone } from "../modules/promotions/design/statusTone";
import { PolarisCheckbox, PolarisSelect } from "../modules/promotions/components/PolarisControls";
import { PromotionBulkBar } from "../modules/promotions/components/PromotionBulkBar";
import { SourceRulesModal } from "../modules/promotions/components/SourceRulesModal";
import { MetricStrip } from "../modules/promotions/components/MetricStrip";
import { daysAgo, emptyFilter, today } from "../modules/promotions/design/orderReport";
import { loadOrderReport } from "../modules/promotions/services/orderReport.server";
import { formatMoney } from "../modules/promotions/design/formatMoney";
import { bulkIntents, parseBulkIds, runBulkAction, type BulkIntent } from "../modules/promotions/services/bulkPromotions.server";
import { discountSearch, getDiscountsByIds, getDiscountsPage, listCursor, type DiscountsPage } from "../modules/promotions/services/discounts.server";
import { mapDiscountsToPromotions } from "../modules/promotions/mappers/promotionMapper";
import { attachPromotionSettings } from "../modules/promotions/services/promotionSettings.server";
import type { PromotionRecord } from "../modules/promotions/models/promotion";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  // The search, status and page are in the address, so a page can be reloaded or shared. Shopify does the searching.
  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").slice(0, 100);
  const status = params.get("status") ?? "";
  const before = listCursor(params.get("before"));
  const after = before ? null : listCursor(params.get("after"));
  const source = sourceFromParam(params.get("source"));
  const app = source === "other" ? (params.get("app") ?? "").slice(0, 100) : "";
  const getAdmin = async () => (await unauthenticated.admin(session.shop)).admin;

  // Other apps (Dotdigital makes thousands of single-use codes) are kept out of the default view. Shopify cannot filter
  // by the creating app, so the app keeps a short index of discounts and pages from it. Until the first build is done
  // (a few minutes) the list shows everything, as before.
  let index = await indexState(session.shop);
  if (!index.ready) { if (!isIndexing(session.shop)) void buildIndex(getAdmin, session.shop); }
  else if (await indexIsDue(session.shop, 60)) await Promise.race([buildIndex(getAdmin, session.shop), new Promise(resolve => setTimeout(resolve, 4000))]);
  index = await indexState(session.shop);
  const useIndex = index.ready && source !== "all";
  let page: DiscountsPage;
  if (useIndex) {
    const found = await listFromIndex(session.shop, { source, app, status, text: q, after, before });
    const nodes = await getDiscountsByIds(admin, found.ids);
    // A discount Shopify no longer has is dropped from the index so it stops being asked for.
    const missing = found.ids.filter(id => !nodes.some(node => node.id === id));
    await forgetDiscounts(session.shop, missing);
    page = { nodes: found.ids.flatMap(id => nodes.filter(node => node.id === id)), pageInfo: found.pageInfo, total: found.total };
  } else {
    page = await getDiscountsPage(admin, { after, before, query: discountSearch(q, status) });
  }
  const creators = await creatorsOf(session.shop, page.nodes.map(node => node.id));
  const apps = index.ready ? await otherApps(session.shop) : [];
  const rules = await listSourceRules(session.shop);
  // The figures across the top: what is running, and what discounts did in the last 30 days.
  const returns = await loadOrderReport(session.shop, emptyFilter(daysAgo(30), today()));
  const activeCount = index.ready ? await countActivePromotions(session.shop) : null;
  const stats = { activeCount, orders: returns.syncedAt ? returns.report.selected.orders : null, valueCents: returns.syncedAt ? returns.report.selected.valueCents : null, discountCents: returns.syncedAt ? returns.report.selected.discountCents : null, share: returns.syncedAt ? returns.report.discountedShare : null, currency: returns.currency };
  const promotions = await attachPromotionSettings(session.shop, mapDiscountsToPromotions(page.nodes));

  // The storefront data is refreshed when the plain newest page opens, not on every search or page turn.
  let syncError: string | null = null;
  if (!after && !before && !q && !status && source === "") {
    try { await syncStorefrontSnapshot(admin, session.shop); } catch (error) { syncError = `Promotions loaded, but storefront sync failed: ${error instanceof Error ? error.message : "Please retry."}`; }
  }
  return { promotions, syncError, pageInfo: page.pageInfo, total: page.total, filters: { q, status, source, app }, creators, apps, rules, stats, indexing: !index.ready, indexError: index.error };
}

// Bulk changes from the list: Shopify discount status, website status, and deleting. See bulkPromotions.server.ts.
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  // The rules for what counts as another app's discount (see SourceRulesModal).
  if (intent === "saveRule" || intent === "deleteRule") {
    try {
      if (intent === "saveRule") await saveSourceRule(session.shop, { name: form.get("name"), matchOn: form.get("matchOn"), matchType: form.get("matchType"), pattern: form.get("pattern") });
      else await deleteSourceRule(session.shop, Number(form.get("id")));
      return { intent, ok: true as const, error: null as string | null, done: [] as string[], failed: [] as Array<{ id: string; message: string }>, syncError: null as string | null };
    } catch (error) {
      return { intent, ok: false as const, error: error instanceof Error ? error.message : "The rule could not be saved.", done: [] as string[], failed: [] as Array<{ id: string; message: string }>, syncError: null as string | null };
    }
  }
  if (!(bulkIntents as readonly string[]).includes(intent)) return { intent, error: "That action is not available.", done: [] as string[], failed: [] as Array<{ id: string; message: string }>, syncError: null as string | null };
  let ids: string[];
  try { ids = parseBulkIds(form.get("ids")); }
  catch (error) { return { intent, error: error instanceof Error ? error.message : "Select at least one promotion.", done: [] as string[], failed: [] as Array<{ id: string; message: string }>, syncError: null as string | null }; }
  const outcome = await runBulkAction(admin, session.shop, intent as BulkIntent, ids);
  let syncError: string | null = null;
  // The storefront data follows whatever changed.
  if (outcome.done.length) { try { await syncStorefrontSnapshot(admin, session.shop); } catch (error) { syncError = `The change was made, but storefront sync failed: ${error instanceof Error ? error.message : "Please reopen the app to retry."}`; } }
  return { intent, error: null as string | null, ...outcome, syncError };
}

function getPromotionValue(promotion: PromotionRecord): string {
  const bxgy = promotion.shopify.bxgy;

  if (!bxgy) {
    return promotion.shopify.general.value;
  }

  const quantity = bxgy.get.quantity ?? 1;

  if (bxgy.get.rewardType === "FREE") {
    return `${quantity} free`;
  }

  if (bxgy.get.rewardType === "PERCENTAGE") {
    return bxgy.get.rewardValue !== null
      ? `${bxgy.get.rewardValue}%`
      : "Percentage reward";
  }

  if (bxgy.get.rewardType === "FIXED_AMOUNT") {
    const value = bxgy.get.rewardValue;
    const currency = bxgy.get.rewardCurrencyCode;

    if (value !== null && currency) {
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
      }).format(value);
    }

    return "Fixed amount reward";
  }

  return "Buy X Get Y";
}

function getEligibility(promotion: PromotionRecord): string {
  const customers = promotion.shopify.customers;

  if (customers.appliesToAllCustomers) {
    return "All customers";
  }

  if (customers.segments.length > 0) {
    return customers.segments.length === 1
      ? customers.segments[0].name
      : `${customers.segments.length} customer segments`;
  }

  if (customers.customers.length > 0) {
    return `${customers.customers.length} selected ${customers.customers.length === 1 ? "customer" : "customers"}`;
  }

  return "Targeted customers";
}

function getSummaryLines(summary: string): string[] {
  return summary
    .split(/\s*•\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
}

function formatDate(value: string | null, empty = "No end date"): string {
  if (!value) {
    return empty;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

type DiscountIconType = "tag" | "order" | "truck";

function DiscountTypeIcon({
  type,
  size = 22,
}: {
  type: DiscountIconType;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        width: `${size + 10}px`,
        height: `${size + 10}px`,
        borderRadius: "10px",
        background: "#f6f6f7",
        color: "#303030",
      }}
    >
      {type === "tag" && (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.6 13.6 13.7 20.5a2 2 0 0 1-2.8 0L3.5 13.1a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h6.7a2 2 0 0 1 1.4.6l7.6 7.2a2 2 0 0 1 0 2.8Z" />
          <circle cx="8" cy="8" r="1.25" />
        </svg>
      )}
      {type === "order" && (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 3h14a2 2 0 0 1 2 2v16l-3-2-3 2-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2Z" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      )}
      {type === "truck" && (
        <svg width={size + 2} height={size} viewBox="0 0 26 22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h14v13H2z" />
          <path d="M16 8h4l4 4v4h-8z" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="20" cy="18" r="2" />
          <path d="M9 18h9M20 8v4h4" />
        </svg>
      )}
    </span>
  );
}

function getPromotionIconType(promotion: PromotionRecord): DiscountIconType {
  if (promotion.shopify.bxgy) {
    return "tag";
  }

  switch (promotion.shopify.general.type) {
    case "Order":
      return "order";
    case "Shipping":
      return "truck";
    default:
      return "tag";
  }
}

const discountTypes: { type: string; title: string; description: string; icon: DiscountIconType }[] = [
  { type: "product", title: "Amount off products", description: "Discount specific products or collections of products", icon: "tag" },
  { type: "bxgy", title: "Buy X get Y", description: "Reward customers who buy specific items", icon: "tag" },
  { type: "order", title: "Amount off order", description: "Discount the total order amount", icon: "order" },
  { type: "shipping", title: "Free shipping", description: "Offer free shipping on an order", icon: "truck" },
];

export default function PromotionsPage() {
  const appUrl = useEmbeddedAppUrl();
  const { promotions, syncError, pageInfo, total, filters, creators, apps, rules, stats, indexing, indexError } = useLoaderData<typeof loader>();
  const [rulesOpen, setRulesOpen] = useState(false);
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const table = useRef<HTMLElementTagNameMap["s-table"]>(null);
  const [query, setQuery] = useState(filters.q);
  const statusFilter = filters.status || "ALL";
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [selected, setSelected] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<unknown>(null);

  // While the first index of discounts is being built, check back so the filter takes over as soon as it is ready.
  useEffect(() => {
    if (!indexing) return;
    const timer = setTimeout(() => revalidator.revalidate(), 8000);
    return () => clearTimeout(timer);
  }, [indexing, revalidator]);
  // Shopify already searched, filtered and paged the list.
  const filteredPromotions = promotions;
  const search = searchParams.toString();

  // Turn to another page, or change what is searched or filtered (which starts again from the newest page).
  function go(change: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [name, value] of Object.entries(change)) { if (value) next.set(name, value); else next.delete(name); }
    setSearchParams(next);
  }
  // Typing searches after a short pause. A search is not repeated for what is already showing.
  useEffect(() => {
    if (query.trim() === filters.q) return;
    const timer = setTimeout(() => go({ q: query.trim() || null, after: null, before: null }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  // A new page or search starts with nothing selected, so a promotion that is no longer in view is never changed.
  useEffect(() => { setSelected([]); }, [search]);
  // The table's own next and previous buttons.
  useEffect(() => {
    const element = table.current;
    const next = () => go({ after: pageInfo.endCursor, before: null });
    const previous = () => go({ before: pageInfo.startCursor, after: null });
    element?.addEventListener("nextpage", next);
    element?.addEventListener("previouspage", previous);
    return () => { element?.removeEventListener("nextpage", next); element?.removeEventListener("previouspage", previous); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageInfo.endCursor, pageInfo.startCursor, search]);

  // Only promotions that are showing can be selected, so a hidden one is never changed by mistake.
  const visibleSelected = filteredPromotions.filter(promotion => selected.includes(promotion.id));
  const allSelected = filteredPromotions.length > 0 && visibleSelected.length === filteredPromotions.length;
  const titleOf = (id: string) => promotions.find(promotion => promotion.id === id)?.shopify.general.title ?? "A promotion";
  const working = fetcher.state !== "idle";
  const result = fetcher.data && fetcher.data !== dismissed ? fetcher.data : null;
  function toggle(id: string, on: boolean) { setDismissed(fetcher.data); setSelected(current => on ? [...new Set([...current, id])] : current.filter(item => item !== id)); }
  function toggleAll(on: boolean) { setDismissed(fetcher.data); setSelected(current => on ? [...new Set([...current, ...filteredPromotions.map(promotion => promotion.id)])] : current.filter(id => !filteredPromotions.some(promotion => promotion.id === id))); }
  function run(intent: BulkIntent) {
    if (working) return;
    setDismissed(null);
    fetcher.submit({ intent, ids: JSON.stringify(visibleSelected.map(promotion => promotion.id)) }, { method: "post" });
  }
  // When a change finishes: confirm it, and stop selecting what was changed. A promotion that failed stays selected.
  useEffect(() => {
    const data = fetcher.data;
    if (fetcher.state !== "idle" || !data || !data.done.length) return;
    setSelected(current => current.filter(id => !data.done.includes(id)));
    const count = data.done.length;
    const what = data.intent === "delete" ? "deleted" : data.intent === "activate" ? "activated" : data.intent === "deactivate" ? "deactivated" : data.intent === "website-enable" ? "enabled on the website" : "set to Draft on the website";
    shopify.toast.show(`${count} promotion${count === 1 ? "" : "s"} ${what}`);
  }, [fetcher.data, fetcher.state, shopify]);

  // One bar for search and filters, in the table's own filter area like Shopify's Products page.
  const filterBar = (
    <s-stack direction="inline" gap="base" alignItems="center">
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <s-search-field label="Search promotions" labelAccessibilityVisibility="exclusive" placeholder="Search and filter" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
      </div>
      <div style={{ flex: "0 0 180px" }}>
        <PolarisSelect label="Source" labelAccessibilityVisibility="exclusive" value={filters.source || "mine"} onChange={(event) => go({ source: event.currentTarget.value === "mine" ? null : event.currentTarget.value, app: null, after: null, before: null })}>
          <s-option value="mine">Promotions</s-option>
          <s-option value="other">Other apps</s-option>
          <s-option value="all">All discounts</s-option>
        </PolarisSelect>
      </div>
      {filters.source === "other" && apps.length > 0 && <div style={{ flex: "0 0 200px" }}>
        <PolarisSelect label="App" labelAccessibilityVisibility="exclusive" value={filters.app || "ALL"} onChange={(event) => go({ app: event.currentTarget.value === "ALL" ? null : event.currentTarget.value, after: null, before: null })}>
          <s-option value="ALL">All other apps</s-option>
          {apps.map(item => <s-option key={item.name} value={item.name}>{`${item.name} (${item.count})`}</s-option>)}
        </PolarisSelect>
      </div>}
      <div style={{ flex: "0 0 160px" }}>
        <PolarisSelect label="Status" labelAccessibilityVisibility="exclusive" value={statusFilter} onChange={(event) => go({ status: event.currentTarget.value === "ALL" ? null : event.currentTarget.value, after: null, before: null })}>
          <s-option value="ALL">All statuses</s-option>
          <s-option value="active">Active</s-option>
          <s-option value="scheduled">Scheduled</s-option>
          <s-option value="expired">Expired</s-option>
        </PolarisSelect>
      </div>
    </s-stack>
  );

  return (
    <s-page heading="Promotions" inlineSize="large">
      <s-button slot="primary-action" variant="primary" commandFor="create-discount-modal" command="--show">
        Create discount
      </s-button>
      <s-button slot="secondary-actions" href="shopify:admin/discounts" target="_blank">
        Open Shopify discounts
      </s-button>
      <s-button slot="secondary-actions" commandFor="promotions-more-actions">
        More actions
      </s-button>
      <s-menu id="promotions-more-actions" accessibilityLabel="More actions">
        <s-button icon="hide" onClick={() => setRulesOpen(true)}>Hide by pattern</s-button>
        <s-button icon="list-numbered" href={appUrl("/app/storefront-priorities")}>Storefront priority</s-button>
        <s-button icon="chart-vertical" href={appUrl("/app/reports")}>Reports</s-button>
      </s-menu>
      <div style={{ width: "100%" }}>
        <s-stack direction="block" gap="base">
          {syncError && <s-banner tone="warning">{syncError}</s-banner>}
          {indexing && <s-banner tone="info" heading="Preparing the source filter">{indexError ? `Reading your discounts failed: ${indexError} It will be tried again.` : "The app is reading your discounts so it can keep discounts made by other apps out of the way. Until it finishes, every discount is shown. This page updates by itself."}</s-banner>}
          {result?.error && <s-banner tone="critical" heading="Nothing was changed">{result.error}</s-banner>}
          {result && result.failed.length > 0 && (
            <s-banner tone="critical" heading={`${result.failed.length} promotion${result.failed.length === 1 ? "" : "s"} could not be changed`}>
              <s-unordered-list>{result.failed.map(item => <s-list-item key={item.id}>{titleOf(item.id)}: {item.message}</s-list-item>)}</s-unordered-list>
            </s-banner>
          )}
          {result?.syncError && <s-banner tone="warning">{result.syncError}</s-banner>}

          <MetricStrip caption="Last 30 days" metrics={[
            { label: "Active promotions", value: stats.activeCount === null ? "–" : String(stats.activeCount) },
            { label: "Orders with a discount", value: stats.orders === null ? "–" : String(stats.orders), note: stats.share === null ? undefined : `${(stats.share * 100).toFixed(1)}% of orders` },
            { label: "Order value", value: stats.valueCents === null ? "–" : formatMoney(stats.valueCents, stats.currency) },
            { label: "Discount given away", value: stats.discountCents === null ? "–" : formatMoney(stats.discountCents, stats.currency) },
          ]} />

          <s-section padding="none">
            {visibleSelected.length > 0 && (
              <PromotionBulkBar titles={visibleSelected.map(promotion => promotion.shopify.general.title)} busy={working} onAction={run} onClear={() => { setDismissed(fetcher.data); setSelected([]); }} />
            )}

            {filteredPromotions.length === 0 ? (
              <>
                <s-box padding="base">{filterBar}</s-box>
                <s-box padding="large">
                  <s-stack direction="block" gap="small-300" alignItems="center">
                    <s-text type="strong">No promotions found</s-text>
                    <s-text color="subdued">Try changing the search or the filters.</s-text>
                  </s-stack>
                </s-box>
              </>
            ) : (
              <s-table ref={table} paginate hasPreviousPage={pageInfo.hasPreviousPage || undefined} hasNextPage={pageInfo.hasNextPage || undefined} loading={navigation.state === "loading" || undefined}>
                <s-box slot="filters">{filterBar}</s-box>
                <s-table-header-row>
                  <s-table-header listSlot="inline"><PolarisCheckbox accessibilityLabel="Select all promotions" checked={allSelected} indeterminate={visibleSelected.length > 0 && !allSelected} onChange={event => toggleAll(event.currentTarget.checked)} /></s-table-header>
                  <s-table-header listSlot="primary">Promotion</s-table-header>
                  <s-table-header listSlot="inline">Status</s-table-header>
                  <s-table-header listSlot="inline">Website</s-table-header>
                  <s-table-header listSlot="secondary">Value</s-table-header>
                  <s-table-header>Type</s-table-header>
                  <s-table-header>Dates</s-table-header>
                  <s-table-header>Created by</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {filteredPromotions.map((promotion) => {
                    const general = promotion.shopify.general;
                    const summary = getSummaryLines(general.summary).join(" · ");
                    // A discount another app made can be looked at here but is changed in Shopify or in that app.
                    const otherApp = isOtherApp(creators[promotion.id]);
                    const shopifyUrl = `shopify:admin/discounts/${promotion.id.split("/").pop()}`;
                    const linkId = `open-${promotion.routeId}`;
                    return (
                      <s-table-row key={promotion.id} clickDelegate={linkId}>
                        <s-table-cell><PolarisCheckbox accessibilityLabel={`Select ${general.title}`} disabled={otherApp} checked={selected.includes(promotion.id)} onChange={event => toggle(promotion.id, event.currentTarget.checked)} /></s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="base" alignItems="center">
                            <DiscountTypeIcon type={getPromotionIconType(promotion)} size={20} />
                            <s-stack direction="block" gap="small-300">
                              {otherApp ? <s-link id={linkId} href={shopifyUrl} target="_blank">{general.title}</s-link> : <s-link id={linkId} href={appUrl(`/app/promotions/${promotion.routeId}`)}>{general.title}</s-link>}
                              {summary && <s-text color="subdued">{summary}</s-text>}
                            </s-stack>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell><s-badge tone={getStatusTone(general.status)}>{sentenceCase(general.status)}</s-badge></s-table-cell>
                        <s-table-cell><s-badge tone={promotion.settings.websiteEnabled ? "success" : "neutral"}>{promotion.settings.websiteEnabled ? "Enabled" : "Draft"}</s-badge></s-table-cell>
                        <s-table-cell>{getPromotionValue(promotion)}</s-table-cell>
                        <s-table-cell>
                          <s-stack direction="block" gap="small-300">
                            <s-text>{general.type}</s-text>
                            <s-text color="subdued">{general.method} · {getEligibility(promotion)}</s-text>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack direction="block" gap="small-300">
                            <s-text>{formatDate(promotion.shopify.schedule.startsAt, "Starts now")}</s-text>
                            <s-text color="subdued">{promotion.shopify.schedule.endsAt ? `Ends ${formatDate(promotion.shopify.schedule.endsAt)}` : "No end date"}</s-text>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>{creators[promotion.id] ?? "–"}</s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
            )}
          </s-section>
          {total !== null && <s-text color="subdued">{total > promotions.length ? `Showing ${promotions.length} of ${total}` : `${promotions.length} promotion${promotions.length === 1 ? "" : "s"}`}{filters.source === "" && !indexing ? " · discounts made by other apps, such as Dotdigital, are hidden (see Source)" : ""}</s-text>}
        </s-stack>
      </div>

      <SourceRulesModal open={rulesOpen} rules={rules} onClose={() => setRulesOpen(false)} />
      <s-modal id="create-discount-modal" heading="Select discount type">
        <s-stack direction="block" gap="small">
          {discountTypes.map((discountType) => (
            <s-clickable
              key={discountType.type}
              href={appUrl(`/app/promotions/new?type=${discountType.type}`)}
              accessibilityLabel={discountType.title}
              border="base"
              borderRadius="base"
              padding="base"
            >
              <s-stack direction="inline" gap="base" alignItems="center">
                <DiscountTypeIcon type={discountType.icon} size={20} />
                <s-stack direction="block" gap="small-300">
                  <s-text type="strong">{discountType.title}</s-text>
                  <s-text color="subdued">{discountType.description}</s-text>
                </s-stack>
              </s-stack>
            </s-clickable>
          ))}
        </s-stack>
        <s-button slot="secondary-actions" commandFor="create-discount-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
