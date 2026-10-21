import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher, useNavigate } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import { averages, spanDays } from "../design/orderReport";
import { formatMoney } from "../design/formatMoney";
import { getStatusTone } from "../design/statusTone";
import { describeGroup, matchOnLabels, matchOptions, matchTypeLabels, matchTypes, maxGroups, maxRulesPerGroup, type GroupDef, type GroupRule, type MatchOn, type MatchType } from "../design/reports";
import type { OrderReportData, UngroupedDiscount } from "../services/orderReport.server";
import { ModalOverlay } from "./ModalOverlay";
import { PolarisSelect } from "./PolarisControls";
import { ReportStatus } from "./ReportOrders";
import { useCsvDownload } from "./useCsvDownload";

const count = new Intl.NumberFormat("en-GB");
const periods = [{ value: "7", label: "Last 7 days" }, { value: "14", label: "Last 14 days" }, { value: "30", label: "Last 30 days" }, { value: "60", label: "Last 60 days" }];
const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

type Draft = { id: string; name: string; rules: GroupRule[] };
const blankRule: GroupRule = { matchOn: "either", matchType: "starts_with", pattern: "" };

/**
 * Revenue by group, and the groups themselves: what each group's discounts returned in the period, the controls to add,
 * change, reorder and remove groups, and the discounts that no group catches so a new group can be made for them.
 */
export function ReportGroups({ groups, orders, ungrouped, refreshing }: { groups: GroupDef[]; orders: OrderReportData; ungrouped: { rows: UngroupedDiscount[]; count: number }; refreshing: boolean }) {
  const appUrl = useEmbeddedAppUrl();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const { busy: downloading, exportUrl, download } = useCsvDownload();
  const fetcher = useFetcher<{ ok: boolean; error: string | null }>();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef<string | null>(null);
  const busy = fetcher.state !== "idle";
  const { report, filter } = orders;
  const money = (cents: number | null) => formatMoney(cents, orders.currency);
  const preset = periods.find(item => spanDays(filter) === Number(item.value))?.value ?? "30";
  const ready = Boolean(orders.syncedAt);

  // Close the editor when a save worked; show the message when it did not.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !submitted.current) return;
    const intent = submitted.current;
    submitted.current = null;
    if (!fetcher.data.ok) { setError(fetcher.data.error); return; }
    setError(null);
    if (intent === "saveGroup") setDraft(null);
    if (intent === "refresh") shopify.toast.show("Reading your orders from Shopify");
  }, [fetcher.state, fetcher.data, shopify]);

  const send = (values: Record<string, string>) => {
    submitted.current = values.intent;
    fetcher.submit(values, { method: "post", action: appUrl("/app/reports") });
  };
  const setRule = (index: number, change: Partial<GroupRule>) => setDraft(current => current && { ...current, rules: current.rules.map((rule, position) => position === index ? { ...rule, ...change } : rule) });
  const groupOf = (key: string) => groups.find(group => `group-${group.id}` === key);

  return <s-page heading="Revenue by group" inlineSize="large">
    <s-link slot="breadcrumb-actions" href={appUrl("/app/reports")}>Reports</s-link>
    <s-button slot="primary-action" type="button" variant="primary" disabled={refreshing || busy || undefined} onClick={() => send({ intent: "refresh" })}>{refreshing ? "Reading orders…" : "Refresh figures"}</s-button>
    <s-button slot="secondary-actions" commandFor="group-export" disabled={downloading || !ready || undefined}>Export</s-button>
    <s-menu id="group-export" accessibilityLabel="Export a table as CSV">
      <s-button icon="export" onClick={() => void download(exportUrl("groups", filter))}>Revenue by group</s-button>
      <s-button icon="export" onClick={() => void download(exportUrl("discounts", { ...filter, group: "other" }))}>Discounts in no group</s-button>
    </s-menu>
    <s-stack direction="block" gap="base">
      {error && <s-banner tone="critical" dismissible onDismiss={() => setError(null)}>{error}</s-banner>}
      <ReportStatus data={orders} />
      <s-section padding="none">
        <s-box padding="base">
          <PolarisSelect label="Period" value={preset} onChange={event => navigate(appUrl(`/app/reports/groups?days=${event.currentTarget.value}`))}>
            {periods.map(item => <s-option key={item.value} value={item.value}>{item.label}</s-option>)}
          </PolarisSelect>
        </s-box>
      </s-section>

      <s-section heading="Groups">
        <s-stack direction="block" gap="base">
          <s-paragraph>Groups gather discounts whose code or title follows a pattern, for example the single-use codes another app creates. A group can have several ways to match. A discount counts in the first group it matches, so the order matters. Anything that matches no group is counted under Other discounts, so nothing is left out.</s-paragraph>
          {ready && <s-table>
            <s-table-header-row>
              <s-table-header>Group</s-table-header>
              <s-table-header format="numeric">Orders</s-table-header>
              <s-table-header format="numeric">Revenue</s-table-header>
              <s-table-header format="numeric">Discount given</s-table-header>
              <s-table-header format="numeric">Average order</s-table-header>
              <s-table-header><span /></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {report.groups.map((line, index) => {
                const group = groupOf(line.key);
                const average = averages(line);
                return <s-table-row key={line.key}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-300">
                      <s-text type="strong">{line.name}</s-text>
                      <s-text color="subdued">{group ? describeGroup(group) : "Used discounts that are in none of the groups above"}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{count.format(line.orders)}</s-table-cell>
                  <s-table-cell>{money(line.valueCents)}</s-table-cell>
                  <s-table-cell>{money(line.discountCents)}</s-table-cell>
                  <s-table-cell>{money(average.orderValueCents)}</s-table-cell>
                  <s-table-cell>
                    {group && <s-stack direction="inline" gap="small-300" justifyContent="end">
                      <s-button type="button" variant="tertiary" icon="arrow-up" accessibilityLabel={`Move ${line.name} up`} disabled={index === 0 || busy || undefined} onClick={() => send({ intent: "moveGroup", id: String(group.id), direction: "up" })} />
                      <s-button type="button" variant="tertiary" icon="arrow-down" accessibilityLabel={`Move ${line.name} down`} disabled={index >= groups.length - 1 || busy || undefined} onClick={() => send({ intent: "moveGroup", id: String(group.id), direction: "down" })} />
                      <s-button type="button" variant="tertiary" onClick={() => { setError(null); setDraft({ id: String(group.id), name: group.name, rules: group.rules.map(rule => ({ ...rule })) }); }}>Edit</s-button>
                      <s-button type="button" variant="tertiary" tone="critical" disabled={busy || undefined} onClick={() => send({ intent: "deleteGroup", id: String(group.id) })}>Delete</s-button>
                    </s-stack>}
                  </s-table-cell>
                </s-table-row>;
              })}
            </s-table-body>
          </s-table>}
          <div><s-button type="button" variant="secondary" disabled={groups.length >= maxGroups || undefined} onClick={() => { setError(null); setDraft({ id: "", name: "", rules: [{ ...blankRule }] }); }}>Add group</s-button></div>
        </s-stack>
      </s-section>

      {ready && <s-section heading="Discounts in no group">
        <s-stack direction="block" gap="base">
          <s-paragraph>Discounts used in this period that no group catches, with the most revenue first. If several share a pattern, add a group or another way to match for them. Status is shown where the app can match the discount.</s-paragraph>
          {ungrouped.rows.length === 0
            ? <s-text color="subdued">Every discount used in this period belongs to a group.</s-text>
            : <s-table>
              <s-table-header-row>
                <s-table-header>Discount</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Type</s-table-header>
                <s-table-header format="numeric">Orders</s-table-header>
                <s-table-header format="numeric">Revenue</s-table-header>
                <s-table-header format="numeric">Discount given</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {ungrouped.rows.map(row => <s-table-row key={row.key}>
                  <s-table-cell>{row.label}</s-table-cell>
                  <s-table-cell>{row.status ? <s-badge tone={getStatusTone(row.status.toUpperCase())}>{sentence(row.status)}</s-badge> : <s-text color="subdued">–</s-text>}</s-table-cell>
                  <s-table-cell>{row.kind === "code" ? "Discount code" : row.kind === "manual" ? "Manual discount" : "Automatic discount"}</s-table-cell>
                  <s-table-cell>{count.format(row.orders)}</s-table-cell>
                  <s-table-cell>{money(row.valueCents)}</s-table-cell>
                  <s-table-cell>{money(row.discountCents)}</s-table-cell>
                </s-table-row>)}
              </s-table-body>
            </s-table>}
          {ungrouped.count > ungrouped.rows.length && <s-text color="subdued">Showing the {count.format(ungrouped.rows.length)} with the most revenue of {count.format(ungrouped.count)}. Export the list to see them all.</s-text>}
        </s-stack>
      </s-section>}
    </s-stack>

    <ModalOverlay open={Boolean(draft)} heading={draft?.id ? "Edit group" : "Add group"} size="base" onClose={() => setDraft(null)}>
      {draft && <s-stack direction="block" gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}
        <s-text-field label="Name" value={draft.name} maxLength={60} onInput={event => setDraft({ ...draft, name: event.currentTarget.value })} details="For example: Dotdigital" />
        <s-text color="subdued">A discount belongs to this group when it fits any one of these ways of matching. Add one for each prefix or pattern, and add more whenever a new one appears.</s-text>
        {draft.rules.map((rule, index) => <s-box key={index} border="base" borderRadius="base" padding="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" justifyContent="space-between" alignItems="center">
              <s-text type="strong">Way to match {index + 1}</s-text>
              {draft.rules.length > 1 && <s-button type="button" variant="tertiary" tone="critical" onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, position) => position !== index) })}>Remove</s-button>}
            </s-stack>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
              <PolarisSelect label="Look in" value={rule.matchOn} onChange={event => setRule(index, { matchOn: event.currentTarget.value as MatchOn })}>
                {matchOptions.map(value => <s-option key={value} value={value}>{matchOnLabels[value]}</s-option>)}
              </PolarisSelect>
              <PolarisSelect label="Matches when it" value={rule.matchType} onChange={event => setRule(index, { matchType: event.currentTarget.value as MatchType })}>
                {matchTypes.map(value => <s-option key={value} value={value}>{matchTypeLabels[value]}</s-option>)}
              </PolarisSelect>
              <s-text-field label="Text to look for" value={rule.pattern} maxLength={60} onInput={event => setRule(index, { pattern: event.currentTarget.value })} />
            </s-grid>
          </s-stack>
        </s-box>)}
        <div><s-button type="button" variant="secondary" disabled={draft.rules.length >= maxRulesPerGroup || undefined} onClick={() => setDraft({ ...draft, rules: [...draft.rules, { ...blankRule }] })}>Add another way to match</s-button></div>
        <s-text color="subdued">Not case sensitive. A discount with many codes matches on its first code or its title.</s-text>
      </s-stack>}
      <s-button slot="secondary-actions" type="button" onClick={() => setDraft(null)}>Cancel</s-button>
      <s-button slot="primary-actions" type="button" variant="primary" disabled={busy || undefined} onClick={() => draft && send({ intent: "saveGroup", id: draft.id, name: draft.name, rules: JSON.stringify(draft.rules) })}>Save group</s-button>
    </ModalOverlay>
  </s-page>;
}
