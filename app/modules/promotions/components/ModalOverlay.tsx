import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Shopify's native modal, opened and closed from React state. In the admin, Shopify
 * opens and closes modals by their `id`, so every modal must have one. The content
 * stays rendered until the modal has finished closing, so it never shows empty.
 * Put `slot="primary-actions"` and `slot="secondary-actions"` buttons among the
 * children for the modal's footer.
 */
export function ModalOverlay({ open, heading, size, onClose, children }: { open: boolean; heading: string; size?: "small" | "base" | "large"; onClose: () => void; children: ReactNode }) {
  const id = "modal-" + useId().replace(/:/g, "");
  const ref = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const close = useRef(onClose); close.current = onClose;
  const openRef = useRef(open); openRef.current = open;
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    const element = ref.current;
    // Closing from Shopify's own X button or Escape key must update the page state too.
    const hidden = () => { if (openRef.current) close.current(); };
    const finished = () => { if (!openRef.current) setMounted(false); };
    element?.addEventListener("hide", hidden);
    element?.addEventListener("afterhide", finished);
    return () => { element?.removeEventListener("hide", hidden); element?.removeEventListener("afterhide", finished); };
  }, []);
  useEffect(() => {
    let active = true;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    if (open) setMounted(true);
    // Wait until the content is in place before showing, and let the modal finish closing before removing it.
    void window.customElements.whenDefined("s-modal").then(() => {
      if (!active) return;
      if (open) ref.current?.showOverlay?.();
      else { ref.current?.hideOverlay?.(); fallback = setTimeout(() => { if (!openRef.current) setMounted(false); }, 600); }
    });
    return () => { active = false; if (fallback) clearTimeout(fallback); };
  }, [open]);
  return <s-modal ref={ref} id={id} heading={heading} size={size}>{mounted ? children : null}</s-modal>;
}
