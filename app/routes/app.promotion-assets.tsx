import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { resolvePromotionImage, uploadPromotionImage } from "../modules/promotions/services/promotionAssets.server";
export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  try {
    const data = await request.formData();
    const file = data.get("file");
    const image = data.get("intent") === "upload" && file instanceof File
      ? await uploadPromotionImage(admin, file)
      : await resolvePromotionImage(admin, String(data.get("fileId") ?? ""));
    return { success: true as const, image, error: null };
  } catch (error) {
    return { success: false as const, image: null, error: error instanceof Error ? error.message : "The image could not be loaded." };
  }
}
