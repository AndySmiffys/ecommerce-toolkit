import { createElement, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { FetcherWithComponents } from "react-router";
import { useEmbeddedAppUrl } from "../navigation/embeddedAppUrl";
import { PromotionSaveBar } from "../promotions/components/PromotionSaveBar";
import { SaveNotices } from "../promotions/components/SaveNotices";
import { FormStep } from "../promotions/components/FormStep";
import { ModalOverlay } from "../promotions/components/ModalOverlay";
import { editorCss } from "../promotions/components/editor/editorStyles";
import { PolarisCheckbox, PolarisNumberField, PolarisSelect } from "../promotions/components/PolarisControls";
import { contrastRatio } from "../promotions/design/design";
import blockCss from "../../../extensions/promotion-engine/assets/discounted-price.css?raw";
import { ColourField, PlaceholderList, TextField } from "../shipping/ShippingCountdownPage";
import { codePlaceholders, defaultPriceDisplay, savingsPlaceholders, validatePriceDisplay, type PriceDisplayConfig } from "./config";
import { priceVars } from "./appearance";
import { priceLogic, type PriceRuleInput, type PriceVariant } from "./logic";

export type PriceResult = { ok: boolean; intent: string; errors: string[]; config?: PriceDisplayConfig };

type Form = { showSavings: boolean; savingsText: string; codeText: string; size: string; weight: string; margin: string; textColour: string; saleColour: string; wasColour: string; saveBackground: string; saveText: string; codeColour: string };

const toForm = (c: PriceDisplayConfig): Form => ({ ...c, size: String(c.size), margin: String(c.margin) });
const toInput = (f: Form) => ({ version: 1, ...f, size: f.size.trim() === "" ? 0 : f.size, margin: f.margin.trim() === "" ? 0 : f.margin });

/** The money format the preview writes prices in, like a shop whose format is "£{{amount}}". */
const previewFormat = "£{{amount}}";

/** Examples to look at: what a product page shows in each situation. Prices are in pence, as Shopify holds them. */
const scenarios: Record<string, { label: string; variant: PriceVariant; rules: PriceRuleInput[] }> = {
  none: { label: "No discount", variant: { id: 1, price: 2000 }, rules: [] },
  automatic: { label: "Automatic discount, 20% off", variant: { id: 1, price: 2000 }, rules: [{ t: "p", v: 2000, c: "" }] },
  compare: { label: "Automatic discount on a product with an old price", variant: { id: 1, price: 1500, compare_at_price: 2500 }, rules: [{ t: "p", v: 2000, c: "" }] },
  code: { label: "A code that takes 25% off", variant: { id: 1, price: 2000 }, rules: [{ t: "p", v: 2500, c: "SAVE25" }] },
  both: { label: "Automatic 10% off and a code that takes 25% off", variant: { id: 1, price: 2000 }, rules: [{ t: "p", v: 1000, c: "" }, { t: "p", v: 2500, c: "SAVE25" }] },
};

/** The price lines exactly as the product page builds them (same markup, same stylesheet, same variables). */
function PricePreview({ config, scenario }: { config: PriceDisplayConfig; scenario: string }) {
  const example = scenarios[scenario] ?? scenarios.none;
  const state = priceLogic.priceState(example.variant, example.rules, "GBP");
  const money = (minor: number) => priceLogic.formatMoney(minor, previewFormat);
  const sale = state.was > 0;
  return <>
    <style>{blockCss}</style>
    {createElement("discounted-price", { class: "dp", style: priceVars(config) as CSSProperties },
      <p className="dp__line">
        {sale && <span className="dp__sr">Sale price </span>}
        <span className={sale ? "dp__now dp__now--sale" : "dp__now"}>{money(state.now)}</span>
        {sale && <><span className="dp__sr">Regular price </span><s className="dp__was">{money(state.was)}</s>
          {config.showSavings && <span className="dp__save">{priceLogic.fillText(config.savingsText, { amount: money(state.saving), percent: String(state.percent) })}</span>}</>}
      </p>,
      state.code && <p className="dp__code">{priceLogic.fillText(config.codeText, { price: money(state.code.price), code: state.code.name, amount: money(state.code.saving), percent: String(state.code.percent) })}</p>)}
  </>;
}

/** Text that is hard to read on its background (white, as the preview's page is; the theme's own background may differ). */
function contrastNotes(config: PriceDisplayConfig) {
  const pairs: Array<[string, string, string]> = [
    ["Sale price", config.saleColour, "#ffffff"], ["Old price", config.wasColour, "#ffffff"], ["Code message", config.codeColour, "#ffffff"],
    ...(config.textColour ? [["Price", config.textColour, "#ffffff"] as [string, string, string]] : []),
    ...(config.showSavings ? [["Saving", config.saveText, config.saveBackground] as [string, string, string]] : []),
  ];
  return pairs.map(([label, foreground, background]) => ({ label, ratio: contrastRatio(foreground, background) })).filter(item => item.ratio < 4.5);
}

const panelStyle: CSSProperties = { border: "1px solid #e3e3e3", borderRadius: 12, background: "#fff", boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)", padding: 16, display: "grid", gap: 16, minWidth: 0 };
const stepOrder = ["wording", "appearance"] as const;
type StepId = (typeof stepOrder)[number];
const stepTitles: Record<StepId, string> = { wording: "Savings and codes", appearance: "Appearance" };

/**
 * The Discounted price block's settings, laid out like the other editors: the preview stays in view on the left and the settings are
 * numbered step cards on the right. Which discounts show, and what they take off, come from the promotions themselves.
 */
export function PriceDisplayPage({ initial, saved, fetcher }: { initial: PriceDisplayConfig; saved: boolean; fetcher: FetcherWithComponents<PriceResult> }) {
  const appUrl = useEmbeddedAppUrl();
  const shopify = useAppBridge();
  const [baseline, setBaseline] = useState(() => toForm(initial));
  const [form, setForm] = useState(baseline);
  const [error, setError] = useState<string | null>(null);
  const [firstSave, setFirstSave] = useState(!saved);
  const sent = useRef(false);
  const [openStep, setOpenStep] = useState<StepId | null>("wording");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scenario, setScenario] = useState("automatic");
  const set = (changes: Partial<Form>) => setForm(current => ({ ...current, ...changes }));

  const check = useMemo(() => validatePriceDisplay(toInput(form)), [form]);
  const errors = check.ok ? [] : check.errors;
  const dirty = firstSave || JSON.stringify(form) !== JSON.stringify(baseline);
  const saving = fetcher.state !== "idle" && sent.current;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !sent.current) return;
    sent.current = false;
    if (!fetcher.data.ok) { setError(fetcher.data.errors.join(" ")); return; }
    setError(null);
    if (fetcher.data.config) {
      const next = toForm(fetcher.data.config);
      setBaseline(next); setForm(next); setFirstSave(false);
      shopify.toast.show("Discounted price saved");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  async function copyPlaceholder(placeholder: string) {
    try { await window.navigator.clipboard.writeText(placeholder); shopify.toast.show(`Copied ${placeholder}`); }
    catch { shopify.toast.show("Could not copy. Type it in braces instead.", { isError: true }); }
  }
  const save = () => { if (check.ok) { sent.current = true; fetcher.submit({ intent: "save", config: JSON.stringify(check.config) }, { method: "post" }); } };

  const config = check.ok ? check.config : null;
  const example = scenarios[scenario] ?? scenarios.none;
  const state = priceLogic.priceState(example.variant, example.rules, "GBP");
  const money = (minor: number) => priceLogic.formatMoney(minor, previewFormat);
  const savingsExamples = { amount: money(state.saving || 400), percent: String(state.percent || 20) };
  const codeExamples = { price: money(state.code?.price ?? 1500), code: state.code?.name ?? "SAVE25", amount: money(state.code?.saving ?? 500), percent: String(state.code?.percent ?? 25) };
  const notes = config ? contrastNotes(config) : [];

  const previewPanel = <div style={panelStyle}>
    <s-stack direction="block" gap="small-300">
      <s-heading>Storefront preview</s-heading>
      <s-text color="subdued">The product page&rsquo;s own markup, stylesheet and sums. It updates as you change a setting.</s-text>
    </s-stack>
    <PolarisSelect label="Example" value={scenario} onChange={event => setScenario(event.currentTarget.value)}>
      {Object.entries(scenarios).map(([id, item]) => <s-option key={id} value={id}>{item.label}</s-option>)}
    </PolarisSelect>
    {config === null
      ? <s-banner tone="warning">Fix the problem shown above the settings to see a preview.</s-banner>
      : <div style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: 16, background: "#fff", display: "grid", gap: 6 }}>
        <span style={{ fontSize: 13, color: "#616161" }}>Product page</span>
        <span style={{ fontWeight: 600 }}>Example product</span>
        <PricePreview config={config} scenario={scenario} />
        <span aria-hidden="true" style={{ background: "#202223", color: "#fff", borderRadius: 8, padding: "10px 16px", textAlign: "center", fontSize: 14 }}>Add to basket</span>
      </div>}
    <s-text color="subdued">The theme&rsquo;s own text size and font are used unless you set a size.</s-text>
  </div>;

  const step = (id: StepId, summary: string, children: ReactNode) => (
    <FormStep id={id} number={stepOrder.indexOf(id) + 1} title={stepTitles[id]} summary={summary} open={openStep === id} onToggle={open => setOpenStep(open ? id : current => (current === id ? null : current))}>
      {children}
    </FormStep>
  );

  return <s-page heading="Discounted price" inlineSize="large">
    <s-link slot="breadcrumb-actions" href={appUrl("/app")}>Home</s-link>
    <s-button slot="secondary-actions" data-preview-toggle="" onClick={() => setPreviewOpen(true)}>Preview</s-button>
    <PromotionSaveBar dirty={dirty} saving={saving} issue={errors[0] ?? null} showWhileIncomplete onSave={save} onDiscard={() => { setForm(baseline); setError(null); setFirstSave(false); }} />
    <s-stack direction="block" gap="base">
      <SaveNotices error={error} issue={errors.length ? errors[0] : null} onDismissError={() => setError(null)} />
      {!saved && <s-banner tone="info" heading="Nothing is saved yet">These are starting values. The Discounted price block shows the standard price in the theme&rsquo;s own style until you save.</s-banner>}
      <s-banner tone="info" heading="How the price is worked out">
        The block shows a product&rsquo;s price after any enabled promotion that covers it: a percentage off products or the whole order, or an amount off each item. Promotions with a minimum spend or quantity, an amount off the whole order, buy X get Y, free shipping, or limited to certain customers are not shown here. A code discount is shown as a separate line, because the shopper has not entered the code yet. The cart and checkout always decide the final price.
      </s-banner>

      <div className="create-discount-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
        <aside className="desktop-preview-panel" style={{ position: "sticky", top: 20, maxHeight: "calc(100vh - 40px)", overflowY: "auto", scrollbarGutter: "stable", padding: 3, alignSelf: "start" }}>
          {previewPanel}
        </aside>

        <div>
          <s-stack direction="block" gap="large">
            {step("wording", form.showSavings ? "Shows the saving, and codes" : "Codes only", <>
              <PolarisCheckbox label="Show how much is saved beside the old price" checked={form.showSavings} details="For example “Save £4.00”, shown when a discount or an old (compare-at) price makes the price lower." onChange={event => set({ showSavings: event.currentTarget.checked })} />
              {form.showSavings && <>
                <PlaceholderList placeholders={savingsPlaceholders} examples={savingsExamples} onCopy={copyPlaceholder} heading="Placeholders you can use in the saving message" exampleHeading="For the example in the preview" />
                <TextField label="Saving message" value={form.savingsText} maxLength={100} onChange={value => set({ savingsText: value })} details="For example “Save {amount}” or “{percent}% off”." />
              </>}
              <PlaceholderList placeholders={codePlaceholders} examples={codeExamples} onCopy={copyPlaceholder} heading="Placeholders you can use in the code message" exampleHeading="For the example in the preview" />
              <TextField label="Code message" value={form.codeText} maxLength={100} onChange={value => set({ codeText: value })} details="Shown under the price when a code would make it lower, for example “{price} with code {code}” or “{percent}% off with code {code}”. It must include {price} and {code}." />
            </>)}

            {step("appearance", `${Number(form.size) > 0 ? `${form.size}px` : "Theme's text size"} · weight ${form.weight}`, <>
              <s-text color="subdued">How the price lines look. Leave the size at 0 to use the theme&rsquo;s own text size.</s-text>
              <s-grid gridTemplateColumns="1fr 1fr" gap="base" alignItems="start">
                <PolarisNumberField label="Text size (px)" min={0} max={48} step={1} value={form.size} details="0 is the theme's own size." onInput={event => set({ size: event.currentTarget.value })} />
                <PolarisSelect label="Price font weight" value={form.weight} onChange={event => set({ weight: event.currentTarget.value })}>
                  <s-option value="400">Normal</s-option><s-option value="500">Medium</s-option><s-option value="600">Semibold</s-option><s-option value="700">Bold</s-option>
                </PolarisSelect>
                <PolarisNumberField label="Space above and below (px)" min={0} max={40} step={1} value={form.margin} onInput={event => set({ margin: event.currentTarget.value })} />
              </s-grid>
              <section aria-label="Colours" style={{ display: "grid", gap: 12, borderTop: "1px solid #e3e3e3", paddingTop: 16 }}>
                <s-heading>Colours</s-heading>
                <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                  <ColourField label="Sale price" value={form.saleColour} onChange={value => set({ saleColour: value })} />
                  <ColourField label="Old price" value={form.wasColour} onChange={value => set({ wasColour: value })} />
                  <ColourField label="Saving background" value={form.saveBackground} onChange={value => set({ saveBackground: value })} />
                  <ColourField label="Saving text" value={form.saveText} onChange={value => set({ saveText: value })} />
                  <ColourField label="Code message" value={form.codeColour} onChange={value => set({ codeColour: value })} />
                  <ColourField label="Price with no discount" value={form.textColour || "#000000"} onChange={value => set({ textColour: value })} />
                </s-grid>
                <s-text color="subdued">{form.textColour ? "The price with no discount uses the colour above." : "The price with no discount uses the theme's own text colour until you choose one."}</s-text>
                {form.textColour && <div><s-button type="button" variant="tertiary" onClick={() => set({ textColour: "" })}>Use the theme&rsquo;s text colour for the price</s-button></div>}
                {notes.length > 0 && <s-banner tone="warning" heading="Some text may be hard to read">
                  {notes.map(item => `${item.label} on its background is ${item.ratio.toFixed(1)} to 1`).join("; ")}. Aim for at least 4.5 to 1. Prices are checked on a white page; your theme&rsquo;s background may differ.
                </s-banner>}
                <div><s-button type="button" variant="tertiary" onClick={() => setForm(current => ({ ...toForm(defaultPriceDisplay), showSavings: current.showSavings, savingsText: current.savingsText, codeText: current.codeText }))}>Reset the appearance to the original look</s-button></div>
              </section>
            </>)}
          </s-stack>
        </div>
      </div>

      <ModalOverlay open={previewOpen} heading="Storefront preview" size="large" onClose={() => setPreviewOpen(false)}>
        {previewPanel}
        <s-button slot="secondary-actions" onClick={() => setPreviewOpen(false)}>Close</s-button>
      </ModalOverlay>
      <style>{editorCss}</style>
    </s-stack>
  </s-page>;
}
