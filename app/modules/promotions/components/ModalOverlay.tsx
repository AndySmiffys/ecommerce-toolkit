import { useEffect, useRef, type ReactNode } from "react";

/**
 * Shopify's native modal, opened and closed from React state. The content is only
 * rendered while the modal is open. Put `slot="primary-actions"` and
 * `slot="secondary-actions"` buttons among the children for the modal's footer.
 */
export function ModalOverlay({ open, heading, size, onClose, children }: { open: boolean; heading: string; size?: "small" | "base" | "large"; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const close = useRef(onClose); close.current = onClose;
  const openRef = useRef(open); openRef.current = open;
  useEffect(() => {
    const element = ref.current;
    const hidden = () => { if (openRef.current) close.current(); };
    element?.addEventListener("hide", hidden);
    return () => element?.removeEventListener("hide", hidden);
  }, []);
  useEffect(() => {
    let active = true;
    void window.customElements.whenDefined("s-modal").then(() => {
      if (!active) return;
      if (open) ref.current?.showOverlay?.(); else ref.current?.hideOverlay?.();
    });
    return () => { active = false; };
  }, [open]);
  return <s-modal ref={ref} heading={heading} size={size}>{open ? children : null}</s-modal>;
}
