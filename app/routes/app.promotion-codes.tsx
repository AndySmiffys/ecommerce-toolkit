import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { advancePromotionCodeBatch } from "../modules/promotions/services/promotionCodeBatches.server";
import { codesCsv } from "../modules/promotions/design/codeGeneration";

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  try {
    const data = await request.formData();
    if (data.get("intent") !== "advance") throw new Error("Unsupported code list action.");
    return { batch: await advancePromotionCodeBatch(admin, session.shop, String(data.get("batchId")), data.get("retry") === "true") };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Code generation could not continue." };
  }
}
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const batchId = new URL(request.url).searchParams.get("batchId");
  const batch = await db.promotionCodeBatch.findFirst({ where: { id: batchId ?? "", shop: session.shop } });
  if (!batch) throw new Response("Code list not found", { status: 404 });
  if (batch.status !== "COMPLETE") throw new Response("Finish code generation before downloading the list.", { status: 409 });
  const codes: string[] = JSON.parse(batch.confirmedJson);
  if (codes.length !== JSON.parse(batch.codesJson).length) throw new Response("This code list is incomplete.", { status: 409 });
  return new Response(codesCsv(codes), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="promotion-codes-${batch.shopifyDiscountId?.split("/").pop()}.csv"`, "Cache-Control": "private, no-store" } });
}
