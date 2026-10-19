import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";

export type PriorityInfo = { position: number; total: number } | null;

/**
 * A short note saying where a promotion sits in the storefront priority order, with a link to change it.
 * A promotion that is about to enter the order is told it will be taken there after saving.
 */
export function PriorityNote({ rankable, blocker, wasRanked, info, routeId }: { rankable: boolean; blocker: string | null; wasRanked: boolean; info?: PriorityInfo; routeId?: string }) {
  const appUrl = useEmbeddedAppUrl();
  if (!rankable) return <s-text color="subdued">Not in the order. {blocker ?? "It cannot appear on the website yet."} It joins at the top once it can appear.</s-text>;
  if (!wasRanked) return <s-text color="subdued">You will place it after saving. It starts at the top of the order.</s-text>;
  return <s-stack direction="block" gap="small-200">
    <s-text type="strong">{info ? `Position ${info.position} of ${info.total}` : "In the order"}</s-text>
    <s-text color="subdued">The highest position wins when promotions overlap on the same block.</s-text>
    {routeId && <s-link href={appUrl(`/app/storefront-priorities?highlight=${routeId}`)}>Change priority</s-link>}
  </s-stack>;
}
