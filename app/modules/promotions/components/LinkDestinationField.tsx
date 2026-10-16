import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { safeLink } from "../design/design";
import type { DestinationType, LinkDestinationResult } from "../services/linkDestinations.server";

const types: Array<{ id: DestinationType | "url"; label: string }> = [
  { id: "collection", label: "Collections" },
  { id: "product", label: "Products" },
  { id: "page", label: "Pages" },
  { id: "blog", label: "Blogs" },
  { id: "url", label: "Web address" },
];
const singular: Record<DestinationType, string> = { collection: "Collection", product: "Product", page: "Page", blog: "Blog" };
const paths: Record<string, DestinationType> = { collections: "collection", products: "product", pages: "page", blogs: "blog" };

/** Name a saved link for display, e.g. "Collection: halloween". Other addresses are shown as written. */
export function describeLink(url: string): string {
  const match = /^\/(collections|products|pages|blogs)\/([^/?#]+)/.exec(url);
  return match ? `${singular[paths[match[1]]]}: ${decodeURIComponent(match[2])}` : url;
}

/** One control for choosing where a promotion button leads. */
export function LinkDestinationField({ value, onChange, inherited }: { value: string; onChange: (value: string) => void; inherited?: string }) {
  const appUrl = useEmbeddedAppUrl();
  const fetcher = useFetcher<LinkDestinationResult>();
  const modalId = "link-destination-" + useId().replace(/:/g, "");
  const modalRef = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DestinationType | "url">("collection");
  const [query, setQuery] = useState("");
  const [address, setAddress] = useState("");
  const loadRef = useRef(fetcher.load); loadRef.current = fetcher.load;

  useEffect(() => {
    const modal = modalRef.current;
    const closed = () => setOpen(false);
    modal?.addEventListener("hide", closed);
    return () => modal?.removeEventListener("hide", closed);
  }, []);
  useEffect(() => {
    if (!open || type === "url") return;
    const timer = setTimeout(() => loadRef.current(appUrl(`/app/link-destinations?type=${type}&q=${encodeURIComponent(query)}`)), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, type, query, appUrl]);

  function show() { setAddress(value && !/^\/(collections|products|pages|blogs)\//.test(value) ? value : ""); setOpen(true); modalRef.current?.showOverlay(); }
  function choose(url: string) { onChange(url); setOpen(false); modalRef.current?.hideOverlay(); }
  const loading = fetcher.state !== "idle";
  const result = fetcher.data;
  const addressValid = Boolean(address.trim()) && safeLink(address.trim());
  const following = Boolean(inherited) && value === inherited;

  return <div style={{ display: "grid", gap: 8 }}>
    <div style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>Link destination</span>
      <span style={{ fontSize: 13, color: following ? "#8a8a8a" : value ? "#202223" : "#616161", overflowWrap: "anywhere" }}>{value ? describeLink(value) : "No link selected"}{following && " (campaign link)"}</span>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <s-button type="button" variant="secondary" onClick={show}>{value ? "Change destination" : "Choose destination"}</s-button>
      {value && <s-button type="button" variant="tertiary" onClick={() => onChange("")}>Remove</s-button>}
      {inherited && value !== inherited && <s-button type="button" variant="tertiary" onClick={() => onChange(inherited)}>Use campaign link</s-button>}
    </div>
    <s-modal ref={modalRef} id={modalId} heading="Choose link destination">
      <s-stack direction="block" gap="base">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {types.map(item => <s-button key={item.id} type="button" variant={type === item.id ? "primary" : "secondary"} aria-pressed={type === item.id} onClick={() => { setType(item.id); setQuery(""); }}>{item.label}</s-button>)}
        </div>
        {type === "url"
          ? <s-stack direction="block" gap="small">
              <s-text-field label="Web address" value={address} details="A shop path such as /collections/sale, or an http/https address." onInput={event => setAddress(event.currentTarget.value)} />
              {address.trim() && !addressValid && <s-banner tone="critical">Use a shop path starting with / or an http/https address.</s-banner>}
              <div><s-button type="button" variant="primary" disabled={!addressValid || undefined} onClick={() => choose(address.trim())}>Use this address</s-button></div>
            </s-stack>
          : <s-stack direction="block" gap="small">
              <s-search-field label="Search" labelAccessibilityVisibility="exclusive" placeholder={`Search ${types.find(item => item.id === type)!.label.toLowerCase()}`} value={query} onInput={event => setQuery(event.currentTarget.value)} />
              {loading && <s-text color="subdued">Loading…</s-text>}
              {result?.error && <s-banner tone="warning">{result.error}</s-banner>}
              {!loading && !result?.error && result && result.items.length === 0 && <s-text color="subdued">Nothing found.</s-text>}
              {result?.items.map(item => <s-clickable key={item.id} border="base" borderRadius="base" padding="small" accessibilityLabel={`Use ${item.title}`} onClick={() => choose(item.url)}>
                <s-stack direction="block" gap="small-300"><s-text type="strong">{item.title}</s-text><s-text color="subdued">{item.url}</s-text></s-stack>
              </s-clickable>)}
            </s-stack>}
      </s-stack>
      <s-button slot="secondary-actions" type="button" onClick={() => { setOpen(false); modalRef.current?.hideOverlay(); }}>Cancel</s-button>
    </s-modal>
  </div>;
}
