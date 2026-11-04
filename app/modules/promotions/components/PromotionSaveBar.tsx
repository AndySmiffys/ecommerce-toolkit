import { SaveBar } from "@shopify/app-bridge-react";
import { forwardRef, useId } from "react";

/**
 * Shopify's native contextual save bar. Shopify renders it, so it follows the admin's
 * current design and provides the "leave without saving?" protection. It only shows
 * Save and Discard; messages use toasts and banners (see SaveNotices).
 */
export const PromotionSaveBar = forwardRef<UISaveBarElement, {
  dirty: boolean;
  saving: boolean;
  /** Something the form is still waiting for, such as an image upload. */
  busy?: boolean;
  /** The first thing that must be completed before the changes can be saved. */
  issue?: string | null;
  /** Keep the bar, with Discard, while the form is incomplete. New promotions wait until the form is complete instead. */
  showWhileIncomplete?: boolean;
  discardDisabled?: boolean;
  onSave: () => void;
  onDiscard: () => void;
}>(function PromotionSaveBar({ dirty, saving, busy = false, issue, showWhileIncomplete = false, discardDisabled = false, onSave, onDiscard }, ref) {
  const id = useId();
  const incomplete = Boolean(issue);
  return (
    <SaveBar ref={ref} id={`promotion-save-bar-${id}`} open={dirty && (!incomplete || showWhileIncomplete)}>
      <button type="button" variant="primary" loading={saving ? "" : undefined}
        disabled={!dirty || saving || busy || incomplete} onClick={onSave}>Save</button>
      <button type="button" disabled={!dirty || saving || busy || discardDisabled} onClick={onDiscard}>Discard</button>
    </SaveBar>
  );
});
