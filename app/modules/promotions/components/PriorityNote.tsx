import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";

export type PriorityInfo = { position: number; total: number } | null;

/**
 * One line saying where a promotion sits in the storefront priority order, with a link to change it.
 * A promotion that is about to enter the order is told it will be taken there after saving.
 */
export function PriorityNote({ rankable, blocker, wasRanked, info, routeId }: { rankable: boolean; blocker: string | null; wasRanked: boolean; info?: PriorityInfo; routeId?: string }) {
  const appUrl = useEmbeddedAppUrl();
  const label = <s-text type="strong">Priority: </s-text>;
  if (!rankable) return <s-text>{label}Not in the order. {blocker ?? "It cannot appear on the website yet."} It joins at the top once it can appear.</s-text>;
  if (!wasRanked) return <s-text>{label}You will place it after saving. It starts at the top of the order.</s-text>;
  return <s-stack direction="inline" gap="small-200" alignItems="center">
    <s-text>{label}{info ? `position ${info.position} of ${info.total}` : "in the order"}</s-text>
    {routeId && <s-button variant="tertiary" href={appUrl(`/app/storefront-priorities?highlight=${routeId}`)}>Change priority</s-button>}
  </s-stack>;
}
