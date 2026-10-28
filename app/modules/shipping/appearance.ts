import type { BannerSettings, ShippingStyle } from "./config";

/**
 * The block's look as the stylesheet reads it: three data attributes for the choices (alignment, padding, border) and CSS variables
 * for the values. The theme block's Liquid writes the same attributes and variables from the same settings (a test renders it and
 * compares), and the preview in the app uses this, so what you see here is what the product page gets.
 */
export function styleAttributes(style: ShippingStyle) {
  return {
    data: { "data-align": style.align, "data-padding": style.padding, "data-border": style.border },
    vars: {
      "--sc-margin": `${style.margin}px`,
      "--sc-radius": `${style.radius}px`,
      "--sc-border-width": `${style.borderWidth}px`,
      "--sc-size": `${style.textSize}px`,
      "--sc-weight": style.fontWeight,
      "--sc-bg": style.background,
      "--sc-text": style.text,
      "--sc-accent": style.accent,
      "--sc-dispatch": style.dispatch,
      "--sc-muted": style.muted,
      "--sc-icon": style.icon,
      "--sc-gap": `${style.lineGap}px`,
    },
  };
}

/** The same variables as a style attribute value, in the order the block's Liquid writes them. */
export function styleText(style: ShippingStyle) {
  return Object.entries(styleAttributes(style).vars).map(([name, value]) => `${name}:${value}`).join(";");
}

/** The header banner's look, the same way: a data attribute for the alignment and CSS variables for the values. The banner block's Liquid writes the same ones. */
export function bannerAttributes(banner: BannerSettings) {
  return {
    data: { "data-align": banner.align },
    vars: { "--scb-size": `${banner.textSize}px`, "--scb-bg": banner.background, "--scb-text": banner.text, "--scb-highlight": banner.highlight, "--scb-dispatch": banner.dispatch },
  };
}
