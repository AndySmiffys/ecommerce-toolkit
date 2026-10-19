import type { ShopifyAdminClient } from "./discount.server";
import { imageRatio, type WebsiteDraft } from "../design/design";

export type PromotionImage = { id: string; url: string; alt: string | null; ratio: string };
export async function resolvePromotionImage(admin: ShopifyAdminClient, id: string): Promise<PromotionImage> {
  if (!/^gid:\/\/shopify\/MediaImage\/\d+$/.test(id)) throw new Error("Select a Shopify image file.");
  const response = await admin.graphql(`query PromotionImage($id: ID!) { node(id: $id) { ... on MediaImage { id alt fileStatus image { url width height } } } }`, { variables: { id } });
  const result = await response.json();
  if (result.errors?.length) throw new Error(result.errors.map((e: { message: string }) => e.message).join(", "));
  const node = result.data?.node;
  if (node?.fileStatus === "FAILED") throw new Error("Shopify could not process this image.");
  if (!node?.image?.url) throw new Error("The image is still processing. Select it again from Shopify Files in a moment.");
  return { id: node.id, url: node.image.url, alt: node.alt, ratio: imageRatio(node.image.width, node.image.height) };
}
export async function uploadPromotionImage(admin: ShopifyAdminClient, file: File): Promise<PromotionImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) throw new Error("Choose a JPG, PNG or WebP image up to 20 MB.");
  const staged = await admin.graphql(`mutation StagePromotionImage($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`, { variables: { input: [{ filename: file.name, mimeType: file.type, resource: "IMAGE", httpMethod: "POST", fileSize: String(file.size) }] } });
  const stageResult = await staged.json();
  const stageErrors = stageResult.errors ?? stageResult.data?.stagedUploadsCreate?.userErrors;
  if (stageErrors?.length) throw new Error(stageErrors.map((e: { message: string }) => e.message).join(", "));
  const target = stageResult.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("Shopify could not prepare the image upload.");
  const body = new FormData();
  for (const parameter of target.parameters) body.append(parameter.name, parameter.value);
  body.append("file", file);
  const upload = await fetch(target.url, { method: "POST", body });
  if (!upload.ok) throw new Error("The image upload failed. Please try again.");
  const created = await admin.graphql(`mutation CreatePromotionImage($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id } userErrors { message } } }`, { variables: { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt: file.name }] } });
  const createResult = await created.json();
  const createErrors = createResult.errors ?? createResult.data?.fileCreate?.userErrors;
  if (createErrors?.length) throw new Error(createErrors.map((e: { message: string }) => e.message).join(", "));
  const id = createResult.data?.fileCreate?.files?.[0]?.id;
  if (!id) throw new Error("The image could not be saved to Shopify Files.");
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try { return await resolvePromotionImage(admin, id); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes("still processing") || attempt === 9) throw error;
    }
  }
  throw new Error("Select the processed image from Shopify Files.");
}

/**
 * Campaigns saved before banners were sized from their images have no image shape recorded. Fill it in from
 * Shopify when such a promotion is saved, so older banners fit their images without every image being re-applied.
 * Best effort: an image Shopify cannot describe keeps an unknown shape, and the save carries on.
 */
export async function withImageRatios(admin: ShopifyAdminClient, website: WebsiteDraft): Promise<WebsiteDraft> {
  const known = new Map<string, string>();
  async function ratioFor(id: string) {
    if (!id) return "";
    if (!known.has(id)) known.set(id, await resolvePromotionImage(admin, id).then(image => image.ratio, () => ""));
    return known.get(id)!;
  }
  async function fill<T extends { desktopImageId: string; desktopImageRatio: string; mobileImageId: string; mobileImageRatio: string }>(style: T): Promise<T> {
    return {
      ...style,
      desktopImageRatio: style.desktopImageRatio || (await ratioFor(style.desktopImageId)),
      mobileImageRatio: style.mobileImageRatio || (await ratioFor(style.mobileImageId)),
    };
  }
  const design = await fill(website.design);
  const blocks = website.design.blocks ? { ...website.design.blocks } : undefined;
  if (blocks) for (const id of Object.keys(blocks) as Array<keyof typeof blocks>) {
    const block = blocks[id];
    if (block) blocks[id] = { ...block, style: await fill(block.style) };
  }
  return { ...website, design: { ...design, ...(blocks ? { blocks } : {}) } };
}

