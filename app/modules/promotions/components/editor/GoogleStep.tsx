import { useEmbeddedAppUrl } from "../../../navigation/embeddedAppUrl";
import { googleLimits } from "../../design/googlePromotion";
import { PolarisCheckbox } from "../PolarisControls";

export type GoogleChoice = { enabled: boolean; title: string };
export type GoogleSaved = { enabled: boolean; title: string; status: string; issues: string[]; checkedAt: string | null };

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";

/**
 * Whether this promotion is sent to Google Merchant Center, and the title Google shows. While the promotion is being
 * written it says what Google would reject (`issues`), and once saved it shows how the last check went.
 */
export function GoogleStep({ choice, onChange, issues, isCodeList, saved }: { choice: GoogleChoice; onChange: (choice: GoogleChoice) => void; issues: string[]; isCodeList: boolean; saved?: GoogleSaved | null }) {
  const appUrl = useEmbeddedAppUrl();
  const length = choice.title.trim().length;
  return <s-stack direction="block" gap="base">
    <s-text color="subdued">Send this promotion to Google so it can show as an offer on your Shopping ads and free listings. The app keeps a promotions file up to date, and Google collects it on a schedule. Google reviews each promotion, which can take up to a day.</s-text>
    <PolarisCheckbox label="Send this promotion to Google Merchant Center" checked={choice.enabled && !isCodeList} disabled={isCodeList} details={isCodeList ? "A list of individual codes can’t be sent to Google. Google needs one shared code." : undefined} onChange={event => onChange({ ...choice, enabled: event.currentTarget.checked })} />
    {choice.enabled && !isCodeList && <>
      <s-text-field label="Title on Google (optional)" value={choice.title} maxLength={120} onInput={event => onChange({ ...choice, title: event.currentTarget.value })} details={`Leave it empty to use the promotion’s own title. Google allows up to ${googleLimits.title} characters${length ? ` (${length} now)` : ""}.`} />
      {issues.length > 0
        ? <s-banner tone="warning" heading="Google would not take this promotion yet">
          <s-unordered-list>{issues.map(issue => <s-list-item key={issue}>{issue}</s-list-item>)}</s-unordered-list>
          <s-text>You can still save it. It goes into the file once these are fixed.</s-text>
        </s-banner>
        : <s-banner tone="success">Nothing here stops Google taking it. The number of products is checked after you save.</s-banner>}
      {saved && <s-stack direction="block" gap="small-300">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text type="strong">Last check</s-text>
          {saved.status === "ready" ? <s-badge tone="success">Ready</s-badge> : saved.status === "issues" ? <s-badge tone="warning">Not ready</s-badge> : <s-badge>Checking</s-badge>}
          {saved.checkedAt && <s-text color="subdued">{when(saved.checkedAt)}</s-text>}
        </s-stack>
        {saved.issues.length > 0 && <s-unordered-list>{saved.issues.map(issue => <s-list-item key={issue}>{issue}</s-list-item>)}</s-unordered-list>}
      </s-stack>}
    </>}
    <div><s-button variant="tertiary" href={appUrl("/app/google")}>Open Google Merchant Center</s-button></div>
  </s-stack>;
}
