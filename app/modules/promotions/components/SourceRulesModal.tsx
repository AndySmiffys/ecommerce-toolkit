import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { describeGroup, matchOnLabels, matchOptions, matchTypeLabels, matchTypes, type GroupDef, type MatchOn, type MatchType } from "../design/reports";
import { ModalOverlay } from "./ModalOverlay";
import { PolarisSelect } from "./PolarisControls";

type Draft = { name: string; matchOn: MatchOn; matchType: MatchType; pattern: string };
const blank: Draft = { name: "", matchOn: "either", matchType: "starts_with", pattern: "" };

/**
 * The rules for what counts as another app's discount. Some apps (Loox, for example) leave no app name on their
 * discounts, so Shopify cannot say who made them. A rule names them by a pattern in the code or title instead.
 */
export function SourceRulesModal({ open, rules, onClose }: { open: boolean; rules: GroupDef[]; onClose: () => void }) {
  const fetcher = useFetcher<{ ok: boolean; error: string | null }>();
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !pending.current) return;
    pending.current = false;
    if (fetcher.data.ok) { setError(null); setDraft(blank); } else setError(fetcher.data.error);
  }, [fetcher.state, fetcher.data]);

  const send = (values: Record<string, string>) => { pending.current = true; fetcher.submit(values, { method: "post" }); };

  return <ModalOverlay open={open} heading="Hide discounts by pattern" size="base" onClose={onClose}>
    <s-stack direction="block" gap="base">
      <s-paragraph>Discounts made by other apps are kept out of the Promotions list. Shopify names most apps itself, but some leave no name. Add a rule for those: any discount whose code or title matches is treated as another app’s. Nothing is deleted, and you can always see them under Source, Other apps.</s-paragraph>
      {error && <s-banner tone="critical">{error}</s-banner>}
      {rules.length > 0 && <s-table>
        <s-table-header-row><s-table-header>Rule</s-table-header><s-table-header><span /></s-table-header></s-table-header-row>
        <s-table-body>
          {rules.map(rule => <s-table-row key={rule.id}>
            <s-table-cell><s-stack direction="block" gap="small-300"><s-text type="strong">{rule.name}</s-text><s-text color="subdued">{describeGroup(rule)}</s-text></s-stack></s-table-cell>
            <s-table-cell><s-button type="button" variant="tertiary" tone="critical" disabled={busy || undefined} onClick={() => send({ intent: "deleteRule", id: String(rule.id) })}>Remove</s-button></s-table-cell>
          </s-table-row>)}
        </s-table-body>
      </s-table>}
      <s-text type="strong">Add a rule</s-text>
      <s-text-field label="Name" value={draft.name} maxLength={60} onInput={event => setDraft({ ...draft, name: event.currentTarget.value })} details="Shown as the app in the Created by column, for example Loox" />
      <PolarisSelect label="Look in" value={draft.matchOn} onChange={event => setDraft({ ...draft, matchOn: event.currentTarget.value as MatchOn })}>
        {matchOptions.map(value => <s-option key={value} value={value}>{matchOnLabels[value]}</s-option>)}
      </PolarisSelect>
      <PolarisSelect label="Matches when it" value={draft.matchType} onChange={event => setDraft({ ...draft, matchType: event.currentTarget.value as MatchType })}>
        {matchTypes.map(value => <s-option key={value} value={value}>{matchTypeLabels[value]}</s-option>)}
      </PolarisSelect>
      <s-text-field label="Text to look for" value={draft.pattern} maxLength={60} onInput={event => setDraft({ ...draft, pattern: event.currentTarget.value })} details="Not case sensitive, for example Loox Referrals" />
    </s-stack>
    <s-button slot="secondary-actions" type="button" onClick={onClose}>Close</s-button>
    <s-button slot="primary-actions" type="button" variant="primary" disabled={busy || undefined} onClick={() => send({ intent: "saveRule", ...draft })}>Add rule</s-button>
  </ModalOverlay>;
}
