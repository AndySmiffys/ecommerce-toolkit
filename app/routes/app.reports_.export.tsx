import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { toCsv } from "../modules/promotions/design/csv";
import { filterFromParams } from "../modules/promotions/design/orderReport";
import { describeGroup, periodDays, type ReportLine } from "../modules/promotions/design/reports";
import { exportKinds, exportOrderTable, type ExportKind } from "../modules/promotions/services/orderReport.server";
import { loadReport } from "../modules/promotions/services/reports.server";

// A table from a Reports page as a CSV file, with every row and the filters the page was showing.
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const kind = params.get("report") ?? "";
  const download = (filename: string, body: string) => new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  if (kind === "redemptions") {
    // Lifetime redemptions by group, by code prefix and by creating app.
    const data = await loadReport(session.shop, periodDays(params.get("period")));
    const rule = (line: ReportLine) => { const group = data.groups.find(item => `group-${item.id}` === line.key); return group ? describeGroup(group) : line.description; };
    const rows = (type: string, lines: ReportLine[] = []) => lines.map(line => [type, line.name, rule(line), line.redemptions, line.discounts, line.allTime]);
    return download("redemptions.csv", toCsv(["Kind", "Name", "Rule", "Redemptions", "Discounts used", "All time"], [...rows("Group", data.report?.groups), ...rows("Code prefix", data.report?.prefixes), ...rows("Created by", data.report?.creators)]));
  }
  if (!(exportKinds as readonly string[]).includes(kind)) return new Response("Unknown report.", { status: 400 });
  const table = await exportOrderTable(session.shop, kind as ExportKind, filterFromParams(params));
  return download(table.filename, toCsv(table.headers, table.rows));
}
