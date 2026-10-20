import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEmbeddedAppUrl } from "../../navigation/embeddedAppUrl";
import type { OrderFilter } from "../design/orderReport";

/**
 * Downloads a table from the export route as a file. The request goes through fetch, which App Bridge signs for the
 * signed-in user, so the file is only given to someone who is allowed to see it.
 */
export function useCsvDownload() {
  const shopify = useAppBridge();
  const appUrl = useEmbeddedAppUrl();
  const [busy, setBusy] = useState(false);

  /** The address of a download for a report, carrying the filters the page is showing. */
  function exportUrl(report: string, filter?: OrderFilter, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ report, ...extra });
    if (filter) {
      params.set("from", filter.from); params.set("to", filter.to);
      if (filter.group) params.set("group", filter.group);
      if (filter.prefix) params.set("prefix", filter.prefix);
      if (filter.kind) params.set("kind", filter.kind);
      if (filter.search) params.set("q", filter.search);
    }
    return appUrl(`/app/reports/export?${params}`);
  }

  async function download(url: string) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("The download failed.");
      const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "report.csv";
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      shopify.toast.show("Download started");
    } catch {
      shopify.toast.show("The download failed. Try again.", { isError: true });
    } finally { setBusy(false); }
  }

  return { busy, exportUrl, download };
}
