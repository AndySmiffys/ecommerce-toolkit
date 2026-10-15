import { getStatusTone } from "../modules/promotions/design/statusTone";
import { syncStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";
import { getShippingCountries, validateShippingCountries } from "../modules/promotions/services/shippingCountries.server";
import { PromotionSaveError } from "../modules/promotions/components/PromotionSaveError";
import { PromotionSaveBar } from "../modules/promotions/components/PromotionSaveBar";
import { getPromotionCodeBatch } from "../modules/promotions/services/promotionCodeBatches.server";
import { getEditableDiscount } from "../modules/promotions/services/editableDiscount.server";
import { PromotionEditor } from "../modules/promotions/components/PromotionEditor";
import { discountToEditorDraft, type EditorDiscountDraft } from "../modules/promotions/design/editorDraft";
import { getPromotionEditorResources } from "../modules/promotions/services/promotionEditorResources.server";
import { promotionEditorAction } from "../modules/promotions/services/promotionEditorAction.server";
import { updateShopifyPromotion } from "../modules/promotions/services/updatePromotion.server";
import type { CreateDiscountDraft } from "../modules/promotions/services/createPromotion.server";
import { useEmbeddedAppUrl } from "../modules/navigation/embeddedAppUrl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ShouldRevalidateFunctionArgs,
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";

import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import { authenticate } from "../shopify.server";
import { readWebsite, websiteFromSettings, websiteStorage, validateWebsite, type Placement } from "../modules/promotions/design/design";
import { PromotionWebsiteEditor } from "../modules/promotions/components/PromotionWebsiteEditor";
import { PromotionPreview } from "../modules/promotions/components/PromotionPreview";
import { getPreviewProducts } from "../modules/promotions/services/previewProducts.server";

import {
  getDiscount,
  getDiscountNodeId,
} from "../modules/promotions/services/discount.server";

import { mapDiscountToPromotion } from "../modules/promotions/mappers/promotionMapper";

import { getPromotionCoverage } from "../modules/promotions/coverage/coverage.server";

import {
  PromotionTabs,
  type PromotionTab,
} from "../modules/promotions/components/PromotionTabs";

import { PromotionGeneralTab } from "../modules/promotions/components/PromotionGeneralTab";

import { PromotionProductsTab } from "../modules/promotions/components/PromotionProductsTab";

import { PromotionCustomersTab } from "../modules/promotions/components/PromotionCustomersTab";

import { PromotionConditionsTab } from "../modules/promotions/components/PromotionConditionsTab";

import { PromotionScheduleTab } from "../modules/promotions/components/PromotionScheduleTab";

import {
  attachPromotionSettings,
  updatePromotionWebsiteSettings,
} from "../modules/promotions/services/promotionSettings.server";

export async function loader({
  request,
  params,
}: LoaderFunctionArgs) {
  const { admin, session } =
    await authenticate.admin(request);

  const promotionId = params.promotionId;

  if (!promotionId) {
    throw new Response(
      "Promotion ID is required",
      {
        status: 400,
      },
    );
  }

  const discountNode = await getEditableDiscount(admin, getDiscountNodeId(promotionId));

  if (!discountNode) {
    throw new Response(
      "Promotion not found",
      {
        status: 404,
      },
    );
  }

  const mappedPromotion =
    mapDiscountToPromotion(discountNode);

  const [promotion] =
    await attachPromotionSettings(
      session.shop,
      [mappedPromotion],
    );

  if (!promotion) {
    throw new Response(
      "Promotion could not be loaded",
      {
        status: 500,
      },
    );
  }

  const selectedCollections =
    promotion.shopify.products.collections;

  const coverage =
    selectedCollections.length > 0
      ? await getPromotionCoverage(
        admin,
        selectedCollections,
      )
      : null;

  const previewProducts = await getPreviewProducts(admin, [...promotion.shopify.products.products.map(p=>p.id), ...promotion.shopify.products.variants.flatMap(v=>v.productId ? [v.productId] : [])], selectedCollections.map(c=>c.id));
  let editorDiscount: EditorDiscountDraft | null = null;
  let editRulesMessage: string | null = null;
  try { editorDiscount = discountToEditorDraft(discountNode); } catch (error) { editRulesMessage = error instanceof Error ? error.message : "Edit this discount's rules in Shopify."; }
  const codeBatch = await getPromotionCodeBatch(session.shop, discountNode.id);
  if (editorDiscount && codeBatch) Object.assign(editorDiscount, { codeMode: "bulk", codeCount: String(codeBatch.total), codePrefix: codeBatch.prefix, codeSuffix: codeBatch.suffix, codeListTitle: codeBatch.title });
  const resources = editorDiscount ? await getPromotionEditorResources(admin) : { products: [], collections: [] };
  const shippingCountries = editorDiscount?.discountType === "shipping" ? await getShippingCountries(admin) : null;
  return { promotion, coverage, previewProducts, editorDiscount, editRulesMessage, products: resources.products, codeBatch, shippingCountries };
}
export async function action({
  request,
  params,
}: ActionFunctionArgs) {
  const { admin, session } =
    await authenticate.admin(request);

  const promotionId = params.promotionId;

  if (!promotionId) {
    return {
      success: false,
      error: "Promotion ID is required.",
    };
  }

  const delegatedRequest = request.clone();
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (["searchResources", "searchEligibility", "resolveFile"].includes(String(intent))) return promotionEditorAction({ request: delegatedRequest });
  if (intent === "updatePromotion") {
    let discountUpdated = false;
    try {
      const node = await getEditableDiscount(admin, getDiscountNodeId(promotionId));
      if (!node) throw new Error("This discount no longer exists.");
      const payload = JSON.parse(String(formData.get("payload") ?? "{}"));
      const website = readWebsite(payload.website);
      if (website.websiteEnabled && ((node.discount.codesCount?.count ?? node.discount.codes?.nodes.length ?? 0) > 1 || await getPromotionCodeBatch(session.shop, node.id))) throw new Error("Individual code lists must stay in website Draft status.");
      const errors = validateWebsite(website, payload.updateRules === false ? node.discount.endsAt : payload.discount?.endsAt);
      if (errors.length) throw new Error(errors.join(" "));
      if (payload.updateRules !== false) {
        await validateShippingCountries(admin, payload.discount, node.discount.destinationSelection?.countries ?? []);
        await updateShopifyPromotion(admin, node, payload.discount as CreateDiscountDraft);
        discountUpdated = true;
      }
      await updatePromotionWebsiteSettings(session.shop, node.id, websiteStorage(website));
      await syncStorefrontSnapshot(admin, session.shop);
      return { success: true, savedId: node.id };
    } catch (error) {
      return { success: false, error: (discountUpdated ? "The Shopify discount was updated, but website saving or storefront sync did not finish. Retry saving to finish. " : "") + (error instanceof Error ? error.message : "The promotion could not be saved.") };
    }
  }

  const shopifyDiscountId =
    formData.get("shopifyDiscountId");

  if (
    typeof shopifyDiscountId !== "string" ||
    !shopifyDiscountId.startsWith("gid://shopify/")
  ) {
    return {
      success: false,
      error: "The Shopify discount ID is invalid.",
    };
  }

  try {
    if (shopifyDiscountId.split("/").pop() !== promotionId.split("/").pop()) throw new Error("The discount does not match this page.");
    const discount = await getDiscount(admin, shopifyDiscountId);
    if (!discount) throw new Error("This discount no longer exists.");
    const website = readWebsite(JSON.parse(String(formData.get("website") ?? "{}")));
    if (website.websiteEnabled && ((discount.discount.codesCount?.count ?? discount.discount.codes?.nodes.length ?? 0) > 1 || await getPromotionCodeBatch(session.shop, shopifyDiscountId))) throw new Error("Individual code lists must stay in website Draft status.");
    const errors = validateWebsite(website, discount.discount.endsAt);
    if (errors.length) throw new Error(errors.join(" "));
    await updatePromotionWebsiteSettings(session.shop, shopifyDiscountId, websiteStorage(website));
    await syncStorefrontSnapshot(admin, session.shop);

    return {
      success: true,
      error: null,
    };
  } catch (error) {
    console.error(
      "Failed to save promotion settings:",
      error,
    );

    return {
      success: false,
      error:
        error instanceof Error ? error.message : "The promotion settings could not be saved.",
    };
  }
}

export default function PromotionDetailsPage() {
  const appUrl = useEmbeddedAppUrl();
  const { promotion, coverage, previewProducts, editorDiscount, editRulesMessage, products, codeBatch, shippingCountries } =
    useLoaderData<typeof loader>();

  const general = promotion.shopify.general;

  const actionData =
    useActionData<typeof action>();

  const [dismissedAction, setDismissedAction] = useState<typeof actionData>();
  const saveSucceeded = useRef(false);
  saveSucceeded.current = Boolean(actionData?.success);
  const navigation = useNavigation();

  const isSaving =
    navigation.state !== "idle";

  const savedWebsite = useMemo(() => websiteFromSettings(promotion.settings), [promotion.settings]);
  const [website, setWebsite] = useState(savedWebsite);
  const [assetsBusy, setAssetsBusy] = useState(false);
  const [previewPlacement, setPreviewPlacement] = useState<Placement | undefined>();
  const formRef = useRef<HTMLFormElement>(null);
  const previousSavedWebsite = useRef(savedWebsite);
  const submittedWebsite = useRef(savedWebsite);
  const [activeTab, setActiveTab] = useState<PromotionTab>("general");
  useEffect(() => {
    const previous = JSON.stringify(previousSavedWebsite.current);
    const submitted = JSON.stringify(submittedWebsite.current);
    setWebsite(current => JSON.stringify(current) === previous || (saveSucceeded.current && JSON.stringify(current) === submitted) ? savedWebsite : current);
    previousSavedWebsite.current = savedWebsite;
  }, [savedWebsite]);
  function resetFormState() { setWebsite(savedWebsite); setDismissedAction(actionData); }
  const hasUnsavedChanges = JSON.stringify(website) !== JSON.stringify(savedWebsite);

  if (editorDiscount) return <PromotionEditor key={promotion.id} products={products} initialDiscount={editorDiscount} initialWebsite={savedWebsite} promotionId={promotion.id} shopifyStatus={general.status} codeBatch={codeBatch} shippingCountries={shippingCountries} />;

  return (
    <s-page heading={general.title} inlineSize="large">
      <s-link slot="breadcrumb-actions" href={appUrl("/app/promotions")}>Promotions</s-link>
      <s-button slot="secondary-actions" href={`shopify:admin/discounts/${promotion.routeId}`} target="_blank">Edit in Shopify</s-button>
      <PromotionSaveBar dirty={hasUnsavedChanges} saving={isSaving} busy={assetsBusy} invalid={validateWebsite(website, promotion.endsAt).length > 0} onSave={() => formRef.current?.requestSubmit()} onDiscard={resetFormState} />
      <PromotionSaveError error={actionData !== dismissedAction ? actionData?.error : undefined} />
      <div
        style={{
          width: "100%",
        }}
      >
        <s-stack
          direction="block"
          gap="large"
        >
          <div>
            <s-badge tone={getStatusTone(general.status)}>{general.status}</s-badge>
          </div>

          {editRulesMessage && <s-banner tone="info">{editRulesMessage}</s-banner>}
          <PromotionTabs
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        <Form ref={formRef} method="post" onSubmit={() => { submittedWebsite.current = website; setDismissedAction(actionData); }}>
          <input
            type="hidden"
            name="shopifyDiscountId"
            value={promotion.id}
          />

          {/* General tab */}
          <div
            style={{
              display:
                activeTab === "general"
                  ? "block"
                  : "none",
            }}
          >
            <PromotionGeneralTab promotion={promotion} />
          </div>

          {/* Products tab */}
          <div
            style={{
              display:
                activeTab === "products"
                  ? "block"
                  : "none",
            }}
          >
            <PromotionProductsTab
              promotion={promotion}
              coverage={coverage}
            />
          </div>

          {/* Customers tab */}
          <div
            style={{
              display:
                activeTab === "customers"
                  ? "block"
                  : "none",
            }}
          >
            <PromotionCustomersTab promotion={promotion} />
          </div>

          {/* Conditions tab */}
          <div
            style={{
              display:
                activeTab === "conditions"
                  ? "block"
                  : "none",
            }}
          >
            <PromotionConditionsTab promotion={promotion} />
          </div>

          {/* Schedule tab */}
          <div
            style={{
              display:
                activeTab === "schedule"
                  ? "block"
                  : "none",
            }}
          >
            <PromotionScheduleTab promotion={promotion} />
          </div>

          <input type="hidden" name="website" value={JSON.stringify(website)} />
          <div style={{ display: activeTab === "website" || activeTab === "messages" ? "grid" : "none", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", gap: 20 }}>
            <PromotionWebsiteEditor onActiveBlockChange={setPreviewPlacement} value={website} onChange={setWebsite} endsAt={promotion.endsAt} onBusyChange={setAssetsBusy} />
            <div style={{ alignSelf: "start", position: "sticky", top: 20 }}><PromotionPreview placement={previewPlacement} onPlacementChange={setPreviewPlacement} discountCode={promotion.code} offerNote={promotion.code ? `Use code: ${promotion.code}` : "Applied automatically at checkout."} value={website} products={previewProducts} endsAt={promotion.endsAt} /></div>
          </div>

          </Form>
        </s-stack>
      </div>
    </s-page>
  );
}

export function shouldRevalidate({ formAction, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formAction && new URL(formAction, "https://app.example").pathname === "/app/promotion-codes") return false;
  return defaultShouldRevalidate;
}
