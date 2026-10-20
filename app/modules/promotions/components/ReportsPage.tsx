import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { matchOnLabels, matchOptions, matchTypeLabels, matchTypes, maxGroups, otherKey, reportPeriods, type GroupDef, type MatchOn, type MatchType, type ReportLine } from "../design/reports";
import type { ReportData } from "../services/reports.server";
import { ModalOverlay } from "./ModalOverlay";
import { PolarisSelect } from "./PolarisControls";

const number = new Intl.NumberFormat("en-GB");
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
const whenDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "";

type Draft = { id: string; name: string; matchOn: MatchOn; matchType: MatchType; pattern: string };
const blankDraft: Draft = { id: "", name: "", matchOn: "either", matchType: "starts_with", pattern: "" };

export function ReportsPage({ data, period, refreshing }: { data: ReportData; period: string; refreshing: boolean }) {
  const appUrl = useEmbeddedAppUrl();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ ok: boolean; error: string | null; intent?: string }>();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef<string | null>(null);
  const action = appUrl("/app/reports");
  const busy = fetcher.state !== "idle";

  // Close the editor when a save worked; show the message when it did not.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !submitted.current) return;
    const intent = submitted.current;
    submitted.current = null;
    if (!fetcher.data.ok) { setError(fetcher.data.error); return; }
    setError(null);
    if (intent === "saveGroup") setDraft(null);
    if (intent === "refresh") shopify.toast.show("Reading the discounts from Shopify");
  }, [fetcher.state, fetcher.data]);

  const send = (values: Record<string, string>) => {
    submitted.current = values.intent;
    fetcher.submit(values, { method: "post", action });
  };

  const { report, groups } = data;
  const compared = data.days !== null;
  const heading = compared ? "Redemptions" : "Redemptions (all time)";
  const groupById = (key: string): GroupDef | undefined => groups.find(group => `group-${group.id}` === key);

  const table = (lines: ReportLine[], nameHeading: string, withActions: boolean) => <s-table>
    <s-table-header-row>
      <s-table-header>{nameHeading}</s-table-header>
      <s-table-header format="numeric">{heading}</s-table-header>
      <s-table-header format="numeric">Discounts used</s-table-header>
      {compared && <s-table-header format="numeric">All time</s-table-header>}
      {withActions && <s-table-header><span /></s-table-header>}
    </s-table-header-row>
    <s-table-body>
      {lines.map((line, index) => {
        const group = groupById(line.key);
        return <s-table-row key={line.key}>
          <s-table-cell>
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">{line.name}</s-text>
              <s-text color="subdued">{line.description}</s-text>
            </s-stack>
          </s-table-cell>
          <s-table-cell>{number.format(line.redemptions)}</s-table-cell>
          <s-table-cell>{number.format(line.discounts)}</s-table-cell>
          {compared && <s-table-cell>{number.format(line.allTime)}</s-table-cell>}
          {withActions && <s-table-cell>
            {group && <s-stack direction="inline" gap="small-300" justifyContent="end">
              <s-button type="button" variant="tertiary" icon="arrow-up" accessibilityLabel={`Move ${line.name} up`} disabled={index === 0 || busy || undefined} onClick={() => send({ intent: "moveGroup", id: String(group.id), direction: "up" })} />
              <s-button type="button" variant="tertiary" icon="arrow-down" accessibilityLabel={`Move ${line.name} down`} disabled={index >= groups.length - 1 || busy || undefined} onClick={() => send({ intent: "moveGroup", id: String(group.id), direction: "down" })} />
              <s-button type="button" variant="tertiary" onClick={() => { setError(null); setDraft({ id: String(group.id), name: group.name, matchOn: group.matchOn, matchType: group.matchType, pattern: group.pattern }); }}>Edit</s-button>
              <s-button type="button" variant="tertiary" tone="critical" disabled={busy || undefined} onClick={() => send({ intent: "deleteGroup", id: String(group.id) })}>Delete</s-button>
            </s-stack>}
          </s-table-cell>}
        </s-table-row>;
      })}
    </s-table-body>
  </s-table>;

  return <s-page heading="Reports" inlineSize="large">
    <s-button slot="primary-action" type="button" variant="primary" disabled={refreshing || busy || undefined} onClick={() => send({ intent: "refresh" })}>{refreshing ? "Reading discounts…" : "Refresh figures"}</s-button>
    <s-stack direction="block" gap="base">
      {error && <s-banner tone="critical" dismissible onDismiss={() => setError(null)}>{error}</s-banner>}
      {refreshing && <s-banner tone="info">Reading how often every discount has been used. This page updates by itself when it is done.</s-banner>}
      {!data.complete && <s-banner tone="warning" heading="These figures may be incomplete">There are more used discounts than one reading can cover, so some are missing from the totals.</s-banner>}
      {!report && !refreshing && <s-banner tone="info">There are no figures yet. Choose Refresh figures to read them from Shopify.</s-banner>}
      {report && compared && !data.comparedWith && <s-banner tone="info" heading="Not enough history for this period yet">
        Figures have been kept since {whenDate(data.historyStart)}, so this period cannot be measured yet. Until then the totals shown are for all time. The app takes a reading every day.
      </s-banner>}
      {report && <s-section heading="Redemptions">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="end" justifyContent="space-between">
            <s-stack direction="block" gap="small-300">
              <s-heading>{number.format(compared && data.comparedWith ? report.totals.redemptions : report.totals.allTime)} redemptions</s-heading>
              <s-text color="subdued">
                {compared && data.comparedWith ? `Since ${when(data.comparedWith)}, across ${number.format(report.totals.discounts)} discounts.` : `Across ${number.format(report.totals.discounts || report.groups.reduce((sum, line) => sum + line.discounts, 0))} discounts used so far.`} Includes discounts made by hand, by this app and by other apps. Read from Shopify {when(data.takenAt)}.
              </s-text>
            </s-stack>
            <PolarisSelect label="Period" value={period} onChange={event => navigate(appUrl(`/app/reports?period=${event.currentTarget.value}`))}>
              {reportPeriods.map(option => <s-option key={option.value} value={option.value}>{option.label}</s-option>)}
            </PolarisSelect>
          </s-stack>
        </s-stack>
      </s-section>}
      {report && <s-section heading="Groups">
        <s-stack direction="block" gap="base">
          <s-paragraph>Groups gather discounts whose code or title follows a pattern, for example the single-use codes another app creates. A discount counts in the first group it matches, so the order matters. Anything that matches no group is counted under Other discounts, so nothing is left out.</s-paragraph>
          {table(report.groups, "Group", true)}
          <div><s-button type="button" variant="secondary" disabled={groups.length >= maxGroups || undefined} onClick={() => { setError(null); setDraft({ ...blankDraft }); }}>Add group</s-button></div>
        </s-stack>
      </s-section>}
      {report && <s-section heading="By app">
        <s-stack direction="block" gap="base">
          <s-paragraph>The same redemptions by whoever created the discount. A new app’s discounts appear here without any set-up.</s-paragraph>
          {report.creators.length ? table(report.creators, "Created by", false) : <s-text color="subdued">No discounts have been used yet.</s-text>}
        </s-stack>
      </s-section>}
      {report && report.unmatched.length > 0 && <s-section heading="Discounts in no group">
        <s-stack direction="block" gap="base">
          <s-paragraph>The most used discounts that no group catches. If several share a pattern, add a group for them.</s-paragraph>
          <s-table>
            <s-table-header-row>
              <s-table-header>Discount</s-table-header>
              <s-table-header>Code</s-table-header>
              <s-table-header>Created by</s-table-header>
              <s-table-header format="numeric">{heading}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {report.unmatched.map(row => <s-table-row key={row.id}>
                <s-table-cell>{row.title}</s-table-cell>
                <s-table-cell>{row.code || "Automatic"}</s-table-cell>
                <s-table-cell>{row.createdBy}</s-table-cell>
                <s-table-cell>{number.format(compared && data.comparedWith ? row.redemptions : row.allTime)}</s-table-cell>
              </s-table-row>)}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>}
    </s-stack>
    <ModalOverlay open={Boolean(draft)} heading={draft?.id ? "Edit group" : "Add group"} size="base" onClose={() => setDraft(null)}>
      {draft && <s-stack direction="block" gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}
        <s-text-field label="Name" value={draft.name} maxLength={60} onInput={event => setDraft({ ...draft, name: event.currentTarget.value })} details="For example: Dotdigital sign-up codes" />
        <PolarisSelect label="Look in" value={draft.matchOn} onChange={event => setDraft({ ...draft, matchOn: event.currentTarget.value as MatchOn })}>
          {matchOptions.map(value => <s-option key={value} value={value}>{matchOnLabels[value]}</s-option>)}
        </PolarisSelect>
        <PolarisSelect label="Matches when it" value={draft.matchType} onChange={event => setDraft({ ...draft, matchType: event.currentTarget.value as MatchType })}>
          {matchTypes.map(value => <s-option key={value} value={value}>{matchTypeLabels[value]}</s-option>)}
        </PolarisSelect>
        <s-text-field label="Text to look for" value={draft.pattern} maxLength={60} onInput={event => setDraft({ ...draft, pattern: event.currentTarget.value })} details="Not case sensitive. A discount with many codes matches on its first code or its title." />
      </s-stack>}
      <s-button slot="secondary-actions" type="button" onClick={() => setDraft(null)}>Cancel</s-button>
      <s-button slot="primary-actions" type="button" variant="primary" disabled={busy || undefined} onClick={() => draft && send({ intent: "saveGroup", ...draft })}>Save group</s-button>
    </ModalOverlay>
  </s-page>;
}

// The key of the line that holds everything in no group, for tests and callers that need it.
export { otherKey };
