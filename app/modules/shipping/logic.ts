import script from "../../../extensions/promotion-engine/assets/shipping-countdown.js?raw";
import type { ShippingCountdownConfig } from "./config";

export type DispatchView =
  | { kind: "countdown"; countdown: string; date: string }
  | { kind: "delay"; date: string }
  | { kind: "outofstock" | "backorder" | "none" | "error" | "hidden" };

/** What the app knows about a variant's stock: enough to tell in stock, out of stock and back-order apart. */
export type StockVariant = { available?: boolean; policy?: string; managed?: boolean; qty?: number | null };

type Logic = {
  londonParts(ms: number): { date: string; hour: number; minute: number };
  londonTimeToUtc(date: string, hour: number, minute: number): number;
  dispatchView(nowMs: number, config: ShippingCountdownConfig, variant: StockVariant | null): DispatchView;
  warningVisible(nowMs: number, warning: ShippingCountdownConfig["warning"]): boolean;
  parseRich(text: string): Array<{ text: string; bold: boolean; highlight: boolean }>;
  fillThreshold(text: string, thresholdMinor: number, currency: string, country?: string, rate?: string): string;
  freeShippingMessage(free: ShippingCountdownConfig["freeShipping"], input: { threshold: number | null; thresholdCurrency: string; country: string; rate: string; cartCurrency: string; cartTotal: number; itemPrice: number; quantity: number }): { state: "hidden" | "under" | "add" | "over"; text: string };
};

/**
 * The storefront's own date and message logic, run here so the preview in the app can never disagree with the shop. The file is a plain
 * browser script that also exports its functions when it finds a CommonJS `module`.
 */
const holder: { exports: Partial<Logic> } = { exports: {} };
// HTMLElement and customElements are hidden from it on purpose: the script then only exports its functions and never defines the storefront element here.
new Function("module", "exports", "HTMLElement", "customElements", script)(holder, holder.exports, undefined, undefined);
export const shippingLogic = holder.exports as Logic;
