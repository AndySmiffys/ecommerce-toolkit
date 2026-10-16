import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import type { CodeBatchSummary } from "../design/codeGeneration";
import type { action } from "../../../routes/app.promotion-codes";

export function PromotionCodeList({ initialBatch }: { initialBatch: CodeBatchSummary }) {
  const [batch, setBatch] = useState(initialBatch);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const fetcher = useFetcher<typeof action>();
  const processed = useRef<typeof fetcher.data>();
  const appUrl = useEmbeddedAppUrl();
  const submitRef = useRef(fetcher.submit); submitRef.current = fetcher.submit;
  // Each response is processed once even when intermediate fetcher renders are batched.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fetcher.data || processed.current === fetcher.data || fetcher.state !== "idle") return;
    processed.current = fetcher.data;
    if ("batch" in fetcher.data && fetcher.data.batch) setBatch(fetcher.data.batch);
    setError("error" in fetcher.data ? fetcher.data.error ?? "" : "");
  });
  useEffect(() => {
    if (batch.status !== "RUNNING" || fetcher.state !== "idle" || error) return;
    const timer = window.setTimeout(() => submitRef.current({ intent: "advance", batchId: batch.id }, { method: "post", action: appUrl("/app/promotion-codes") }), 1200);
    return () => window.clearTimeout(timer);
  }, [batch, fetcher.state, appUrl, error]);
  async function downloadCodes() {
    setDownloading(true); setDownloadError("");
    try {
      const response = await fetch(appUrl(`/app/promotion-codes?batchId=${batch.id}`), { headers: { Accept: "text/csv" } });
      if (!response.ok || !response.headers.get("Content-Type")?.includes("text/csv")) throw new Error("The code list could not be downloaded. Try again.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = "promotion-codes.csv"; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setDownloadError(failure instanceof Error ? failure.message : "The download failed."); }
    finally { setDownloading(false); }
  }
  return <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
    <s-banner tone="info">Individual codes are for distribution to customers. This promotion stays in website Draft status, and no individual code is published in the website preview.</s-banner>
    <div><s-text type="strong">{batch.title}</s-text><s-text color="subdued">{batch.confirmed.toLocaleString()} of {batch.total.toLocaleString()} codes confirmed in Shopify.</s-text>
      <progress aria-label="Code generation progress" value={batch.confirmed} max={batch.total} style={{ width: "100%", accentColor: "#202223" }} />
    </div>
    {batch.status === "RUNNING" && <s-text>{batch.reconciling ? "Checking codes already in Shopify…" : "Generating codes…"} Keep this page open. You can reopen the promotion to resume.</s-text>}
    {(batch.error || error) && <s-banner tone="critical">{error || batch.error}</s-banner>}
    {(batch.status === "ERROR" || error) && <s-button loading={fetcher.state !== "idle"} disabled={fetcher.state !== "idle"} onClick={() => { setError(""); submitRef.current({ intent: "advance", batchId: batch.id, retry: "true" }, { method: "post", action: appUrl("/app/promotion-codes") }); }}>Retry code generation</s-button>}
    {downloadError && <s-banner tone="critical">{downloadError}</s-banner>}
    {batch.status === "COMPLETE" && <><s-badge tone="success">Code list ready</s-badge><s-button onClick={downloadCodes} loading={downloading} disabled={downloading} variant="secondary">Download codes CSV</s-button></>}
  </div>;
}
