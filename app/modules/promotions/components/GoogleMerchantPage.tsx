import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { FetcherWithComponents } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { googleLimits } from "../design/googlePromotion";
import { ModalOverlay } from "./ModalOverlay";

type Promotion = { id: string; routeId: string; label: string; title: string; status: string; issues: string[]; checkedAt: string | null };
type PageData = { feedUrl: string; builtAt: string | null; count: number; promotions: Promotion[]; working: boolean };
type Result = { ok: boolean; error: string | null; intent: string };

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";

/**
 * Sending promotions to Google Merchant Center: the private address Merchant Center collects the file from, the steps
 * to set that up, and the promotions chosen with whether each one passes Google's rules and what to change if not.
 */
export function GoogleMerchantPage({ data, fetcher }: { data: PageData; fetcher: FetcherWithComponents<Result> }) {
  const appUrl = useEmbeddedAppUrl();
  const shopify = useAppBridge();
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [title, setTitle] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = useRef<string | null>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !sent.current) return;
    const intent = sent.current;
    sent.current = null;
    if (!fetcher.data.ok) { setError(fetcher.data.error); return; }
    setError(null);
    if (intent === "title") setEditing(null);
    if (intent === "regenerate") { setConfirmNew(false); shopify.toast.show("New address made. Update it in Merchant Center."); }
    if (intent === "check") shopify.toast.show("Checking your promotions");
  }, [fetcher.state, fetcher.data, shopify]);

  const send = (values: Record<string, string>) => { sent.current = values.intent; fetcher.submit(values, { method: "post" }); };
  async function copy() {
    try { await navigator.clipboard.writeText(data.feedUrl); shopify.toast.show("Address copied"); }
    catch { shopify.toast.show("Could not copy. Select the address and copy it.", { isError: true }); }
  }

  const ready = data.promotions.filter(promotion => promotion.status === "ready").length;
  const limit = googleLimits.title;
  return <s-page heading="Google Merchant Center" inlineSize="large">
    <s-button slot="primary-action" type="button" variant="primary" disabled={busy || data.working || undefined} onClick={() => send({ intent: "check" })}>{data.working ? "Checking…" : "Check now"}</s-button>
    <s-button slot="secondary-actions" href={appUrl("/app/promotions")}>Choose promotions</s-button>
    <s-stack direction="block" gap="base">
      {error && <s-banner tone="critical" dismissible onDismiss={() => setError(null)}>{error}</s-banner>}

      <s-section heading="How it works">
        <s-stack direction="block" gap="base">
          <s-paragraph>The app keeps a promotions file up to date with the promotions you choose, and Google Merchant Center collects it on a schedule. Only promotions that pass Google’s rules go into the file. Google reviews each one before it appears, which can take up to a day.</s-paragraph>
          <s-ordered-list>
            <s-list-item>On the Promotions page, tick promotions and choose <s-text type="strong">Send to Google</s-text>.</s-list-item>
            <s-list-item>Copy the address below.</s-list-item>
            <s-list-item>In Merchant Center, open Marketing, then Promotions, and add a promotions data source for the United Kingdom, in English. Choose <s-text type="strong">Scheduled fetch</s-text>, paste the address, and choose a daily time.</s-list-item>
            <s-list-item>Come back here to see which promotions are ready, and what to change in Shopify for the ones that are not.</s-list-item>
          </s-ordered-list>
        </s-stack>
      </s-section>

      <s-section heading="File address">
        <s-stack direction="block" gap="base">
          <s-text-field label="Promotions file address" labelAccessibilityVisibility="exclusive" value={data.feedUrl} readOnly />
          <s-stack direction="inline" gap="base">
            <s-button type="button" variant="secondary" onClick={() => void copy()}>Copy address</s-button>
            <s-button variant="secondary" href={data.feedUrl} target="_blank">Open the file</s-button>
            <s-button type="button" variant="tertiary" tone="critical" onClick={() => setConfirmNew(true)}>Make a new address</s-button>
          </s-stack>
          <s-text color="subdued">The address contains a private key. Only share it with Merchant Center. {data.builtAt ? `The file was last built ${when(data.builtAt)} with ${data.count} ${data.count === 1 ? "promotion" : "promotions"}.` : "The file has not been built yet."}</s-text>
        </s-stack>
      </s-section>

      <s-section heading={`Promotions sent to Google (${data.promotions.length})`}>
        <s-stack direction="block" gap="base">
          {data.promotions.length === 0
            ? <s-banner tone="info">No promotions are chosen yet. On the Promotions page, tick the promotions you want on Google and choose Send to Google.</s-banner>
            : <>
              <s-text color="subdued">{ready} of {data.promotions.length} {data.promotions.length === 1 ? "is" : "are"} ready and in the file.</s-text>
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Promotion</s-table-header>
                  <s-table-header listSlot="inline">Status</s-table-header>
                  <s-table-header>Title on Google</s-table-header>
                  <s-table-header>What to change</s-table-header>
                  <s-table-header><span /></s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.promotions.map(promotion => <s-table-row key={promotion.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-300">
                        <s-link href={appUrl(`/app/promotions/${promotion.routeId}`)}>{promotion.label || "Promotion"}</s-link>
                        {promotion.checkedAt && <s-text color="subdued">Checked {when(promotion.checkedAt)}</s-text>}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{promotion.status === "ready" ? <s-badge tone="success">Ready</s-badge> : promotion.status === "issues" ? <s-badge tone="warning">Not ready</s-badge> : <s-badge>Checking</s-badge>}</s-table-cell>
                    <s-table-cell>{promotion.title || <s-text color="subdued">Same as the discount</s-text>}</s-table-cell>
                    <s-table-cell>
                      {promotion.issues.length
                        ? <s-unordered-list>{promotion.issues.map(issue => <s-list-item key={issue}>{issue}</s-list-item>)}</s-unordered-list>
                        : <s-text color="subdued">{promotion.status === "ready" ? "Nothing" : "Being checked"}</s-text>}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-300" justifyContent="end">
                        <s-button type="button" variant="tertiary" onClick={() => { setError(null); setEditing(promotion); setTitle(promotion.title || promotion.label); }}>Edit title</s-button>
                        <s-button type="button" variant="tertiary" tone="critical" disabled={busy || undefined} onClick={() => send({ intent: "remove", id: promotion.id })}>Remove</s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>)}
                </s-table-body>
              </s-table>
            </>}
        </s-stack>
      </s-section>

      <s-section heading="Google’s rules">
        <s-unordered-list>
          <s-list-item>Every promotion needs a start and an end date, and can run for up to {googleLimits.days} days.</s-list-item>
          <s-list-item>Only promotions for all customers can be shown, not ones for certain customers or segments.</s-list-item>
          <s-list-item>A code must be one shared code of up to {googleLimits.code} characters. Lists of individual codes can’t be sent.</s-list-item>
          <s-list-item>Free shipping needs a code. Percentages must be whole numbers from 1 to 99.</s-list-item>
          <s-list-item>A promotion on specific products or collections can list up to {googleLimits.skus} products, found by their SKU.</s-list-item>
          <s-list-item>Buy X get Y promotions can’t be sent yet.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-stack>

    <ModalOverlay open={Boolean(editing)} heading="Title on Google" size="base" onClose={() => setEditing(null)}>
      {editing && <s-stack direction="block" gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}
        <s-text-field label="Title shown by Google" value={title} maxLength={120} onInput={event => setTitle(event.currentTarget.value)} details={`Google allows up to ${limit} characters (${title.trim().length} now). Leave it empty to use the discount’s own title.`} />
      </s-stack>}
      <s-button slot="secondary-actions" type="button" onClick={() => setEditing(null)}>Cancel</s-button>
      <s-button slot="primary-actions" type="button" variant="primary" disabled={busy || undefined} onClick={() => editing && send({ intent: "title", id: editing.id, title: title.trim() === editing.label ? "" : title })}>Save title</s-button>
    </ModalOverlay>

    <ModalOverlay open={confirmNew} heading="Make a new address?" size="base" onClose={() => setConfirmNew(false)}>
      <s-text>The current address stops working straight away. Merchant Center will not collect the file until you paste the new address into its scheduled fetch.</s-text>
      <s-button slot="secondary-actions" type="button" onClick={() => setConfirmNew(false)}>Cancel</s-button>
      <s-button slot="primary-actions" type="button" variant="primary" tone="critical" disabled={busy || undefined} onClick={() => send({ intent: "regenerate" })}>Make a new address</s-button>
    </ModalOverlay>
  </s-page>;
}
