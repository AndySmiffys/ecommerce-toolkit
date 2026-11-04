import { withImageRatios } from "../modules/promotions/services/promotionAssets.server";
import { syncStorefrontSnapshot } from "../modules/promotions/services/storefrontSnapshot.server";
import { getShippingCountries, validateShippingCountries } from "../modules/promotions/services/shippingCountries.server";
import { PromotionSaveBar } from "../modules/promotions/components/PromotionSaveBar";
import { SaveNotices, draftSavedWarning } from "../modules/promotions/components/SaveNotices";
import { useAppBridge } from "@shopify/app-bridge-react";
import { getPromotionCodeBatch } from "../modules/promotions/services/promotionCodeBatches.server";
import { getEditableDiscount } from "../modules/promotions/services/editableDiscount.server";
import { PromotionEditor } from "../modules/promotions/components/PromotionEditor";
import { discountToEditorDraft, toLocalDateTime, type EditorDiscountDraft } from "../modules/promotions/design/editorDraft";
import { getPromotionEditorResources } from "../modules/promotions/services/promotionEditorResources.server";
import { promotionEditorAction } from "../modules/promotions/services/promotionEditorAction.server";
import { updateShopifyPromotion } from "../modules/promotions/services/updatePromotion.server";
import { buildGoogleFeed, saveGoogleChoice } from "../modules/promotions/services/googleFeed.server";
import { promotionDiscountId } from "../modules/promotions/design/discountIdentity";
import db from "../db.server";
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
  useNavigate,
  useNavigation,
} from "react-router";

import { authenticate } from "../shopify.server";
import { readWebsite, websiteFromSettings, websiteStorage, validateWebsite, type Placement } from "../modules/promotions/design/design";
import { PromotionWebsiteEditor } from "../modules/promotions/components/PromotionWebsiteEditor";
import { PromotionPreview } from "../modules/promotions/components/PromotionPreview";
import { FormStep } from "../modules/promotions/components/FormStep";
import { PriorityNote } from "../modules/promotions/components/PriorityNote";
import { PromotionOverview } from "../modules/promotions/components/PromotionOverview";
import { getPriorityPosition } from "../modules/promotions/services/promotionPriorities.server";
import { canRank, isRanked, rankBlocker } from "../modules/promotions/design/ranking";
import { ModalOverlay } from "../modules/promotions/components/ModalOverlay";
import { editorCss } from "../modules/promotions/components/editor/editorStyles";
import { summaryDate } from "../modules/promotions/design/promotionSummary";
import { getPreviewProducts } from "../modules/promotions/services/previewProducts.server";

import {
  getDiscount,
  getDiscountNodeId,
} from "../modules/promotions/services/discount.server";

import { mapDiscountToPromotion } from "../modules/promotions/mappers/promotionMapper";

import { PromotionGeneralTab } from "../modules/promotions/components/PromotionGeneralTab";

import { PromotionCustomersTab } from "../modules/promotions/components/PromotionCustomersTab";

import { PromotionConditionsTab } from "../modules/promotions/components/PromotionConditionsTab";

import { PromotionScheduleTab } from "../modules/promotions/components/PromotionScheduleTab";

import {
  attachPromotionSettings,
  priorityForSave,
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

  const previewProducts = await getPreviewProducts(admin, [...promotion.shopify.products.products.map(p=>p.id), ...promotion.shopify.products.variants.flatMap(v=>v.productId ? [v.productId] : [])], selectedCollections.map(c=>c.id));
  let editorDiscount: EditorDiscountDraft | null = null;
  let editRulesMessage: string | null = null;
  try { editorDiscount = discountToEditorDraft(discountNode); } catch (error) { editRulesMessage = error instanceof Error ? error.message : "Edit this discount's rules in Shopify."; }
  const codeBatch = await getPromotionCodeBatch(session.shop, discountNode.id);
  if (editorDiscount && codeBatch) Object.assign(editorDiscount, { codeMode: "bulk", codeCount: String(codeBatch.total), codePrefix: codeBatch.prefix, codeSuffix: codeBatch.suffix, codeListTitle: codeBatch.title });
  const resources = editorDiscount ? await getPromotionEditorResources(admin) : { products: [], collections: [] };
  const shippingCountries = editorDiscount?.discountType === "shipping" ? await getShippingCountries(admin) : null;
  const priorityInfo = isRanked(promotion) ? await getPriorityPosition(admin, session.shop, promotion.id) : null;
  const googleRow = await db.googlePromotion.findUnique({ where: { shop_discountId: { shop: session.shop, discountId: promotionDiscountId(promotion.id) } } });
  const google = googleRow ? { enabled: true, title: googleRow.title, status: googleRow.status, issues: JSON.parse(googleRow.issues) as string[], checkedAt: googleRow.checkedAt?.toISOString() ?? null } : null;
  return { promotion, priorityInfo, google, previewProducts, editorDiscount, editRulesMessage, products: resources.products, codeBatch, shippingCountries };
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
      const website = await withImageRatios(admin, readWebsite(payload.website));
      if (website.websiteEnabled && ((node.discount.codesCount?.count ?? node.discount.codes?.nodes.length ?? 0) > 1 || await getPromotionCodeBatch(session.shop, node.id))) throw new Error("Individual code lists must stay in website Draft status.");
      const errors = validateWebsite(website, payload.updateRules === false ? node.discount.endsAt : payload.discount?.endsAt);
      if (errors.length) throw new Error(errors.join(" "));
      if (payload.updateRules !== false) {
        await validateShippingCountries(admin, payload.discount, node.discount.destinationSelection?.countries ?? []);
        await updateShopifyPromotion(admin, node, payload.discount as CreateDiscountDraft);
        discountUpdated = true;
      }
      const rankEntry = payload.rankEntry === true;
      await updatePromotionWebsiteSettings(session.shop, node.id, { ...websiteStorage(website), priority: await priorityForSave(session.shop, node.id, rankEntry) });
      await syncStorefrontSnapshot(admin, session.shop);
      if (await saveGoogleChoice(session.shop, node.id, payload.google)) void buildGoogleFeed(admin, session.shop).catch(error => console.error("The Google promotions file could not be built:", error instanceof Error ? error.message : error));
      return { success: true, savedId: node.id, rankEntry };
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
    const website = await withImageRatios(admin, readWebsite(JSON.parse(String(formData.get("website") ?? "{}"))));
    if (website.websiteEnabled && ((discount.discount.codesCount?.count ?? discount.discount.codes?.nodes.length ?? 0) > 1 || await getPromotionCodeBatch(session.shop, shopifyDiscountId))) throw new Error("Individual code lists must stay in website Draft status.");
    const errors = validateWebsite(website, discount.discount.endsAt);
    if (errors.length) throw new Error(errors.join(" "));
    const rankEntry = formData.get("rankEntry") === "true";
    await updatePromotionWebsiteSettings(session.shop, shopifyDiscountId, { ...websiteStorage(website), priority: await priorityForSave(session.shop, shopifyDiscountId, rankEntry) });
    await syncStorefrontSnapshot(admin, session.shop);

    return {
      success: true,
      error: null,
      rankEntry,
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
  const { promotion, priorityInfo, google, previewProducts, editorDiscount, editRulesMessage, products, codeBatch, shippingCountries } =
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
  // The website settings are what can be changed here, so that section opens first.
  const [openSection, setOpenSection] = useState<string | null>("website");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  useEffect(() => {
    const previous = JSON.stringify(previousSavedWebsite.current);
    const submitted = JSON.stringify(submittedWebsite.current);
    setWebsite(current => JSON.stringify(current) === previous || (saveSucceeded.current && JSON.stringify(current) === submitted) ? savedWebsite : current);
    previousSavedWebsite.current = savedWebsite;
  }, [savedWebsite]);
  function resetFormState() { setWebsite(savedWebsite); setDismissedAction(actionData); }
  const hasUnsavedChanges = JSON.stringify(website) !== JSON.stringify(savedWebsite);
  const shopify = useAppBridge();
  const [draftSaved, setDraftSaved] = useState(false);
  useEffect(() => {
    if (!actionData?.success) return;
    const draft = !website.websiteEnabled;
    setDraftSaved(draft);
    shopify.toast.show(draft ? "Promotion saved. Website status is Draft, so it is not showing on the storefront." : "Promotion saved", draft ? { duration: 8000 } : undefined);
    // Only react to a new save result, not to later edits of the status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData, shopify]);
  const saveIssue = validateWebsite(website, promotion.endsAt)[0] ?? null;
  const navigate = useNavigate();
  const rankInput = { endsAt: promotion.endsAt, website };
  const rankable = canRank(rankInput);
  const wasRanked = canRank({ endsAt: promotion.endsAt, website: savedWebsite });
  useEffect(() => {
    if (actionData && "rankEntry" in actionData && actionData.rankEntry) navigate(appUrl(`/app/storefront-priorities?highlight=${promotion.routeId}`));
  }, [actionData, appUrl, navigate, promotion.routeId]);

  if (editorDiscount) return <PromotionEditor key={promotion.id} products={products} initialDiscount={editorDiscount} initialWebsite={savedWebsite} promotionId={promotion.id} shopifyStatus={general.status} codeBatch={codeBatch} shippingCountries={shippingCountries} priorityInfo={priorityInfo} initialGoogle={google ?? undefined} />;

  const startsOn = summaryDate(toLocalDateTime(promotion.shopify.schedule.startsAt));
  const endsOn = summaryDate(toLocalDateTime(promotion.shopify.schedule.endsAt));
  const sections = [
    { id: "general", title: "Discount details", summary: `${general.type}, ${general.method}${general.value ? `, ${general.value}` : ""}` },
    { id: "customers", title: "Customers", summary: promotion.shopify.customers.appliesToAllCustomers ? "All customers" : "Selected customers or segments" },
    { id: "conditions", title: "Conditions", summary: "Minimum requirements and usage limits" },
    { id: "schedule", title: "Schedule", summary: `${startsOn ? `Starts ${startsOn}` : "Starts when saved"}, ${endsOn ? `ends ${endsOn}` : "no end date"}` },
    { id: "website", title: "Website promotion", summary: website.websiteEnabled ? "Enabled" : "Draft" },
  ];
  const section = (id: string) => {
    const index = sections.findIndex(item => item.id === id);
    return { id, number: index + 1, title: sections[index].title, summary: sections[index].summary, open: openSection === id, onToggle: (open: boolean) => setOpenSection(current => open ? id : current === id ? null : current) };
  };

  return (
    <s-page heading={general.title} inlineSize="large">
      <s-link slot="breadcrumb-actions" href={appUrl("/app/promotions")}>Promotions</s-link>
      <s-button slot="secondary-actions" data-preview-toggle="" onClick={() => setIsPreviewOpen(true)}>Preview</s-button>
      <s-button slot="secondary-actions" href={`shopify:admin/discounts/${promotion.routeId}`} target="_blank">Edit in Shopify</s-button>
      <PromotionSaveBar dirty={hasUnsavedChanges} saving={isSaving} busy={assetsBusy} issue={saveIssue} showWhileIncomplete onSave={() => formRef.current?.requestSubmit()} onDiscard={resetFormState} />
      <SaveNotices warning={draftSaved && !website.websiteEnabled ? draftSavedWarning : null} error={actionData !== dismissedAction ? actionData?.error : undefined} issue={hasUnsavedChanges ? saveIssue : null} onDismissError={() => setDismissedAction(actionData)} />
      <div style={{ width: "100%" }}>
        <s-stack direction="block" gap="large">
          <PromotionOverview
            title={general.title}
            typeLabel={general.type}
            discountStatus={general.status}
            websiteVisible={rankable}
            websiteEnabled={website.websiteEnabled}
            onWebsiteEnabledChange={enabled => setWebsite(current => ({ ...current, websiteEnabled: enabled }))}
            summary={sections[0].summary}
            priority={<PriorityNote rankable={rankable} blocker={rankBlocker(rankInput)} wasRanked={wasRanked} info={priorityInfo} routeId={promotion.routeId} />}
          />
          {editRulesMessage && <s-banner tone="info">{editRulesMessage}</s-banner>}
          <Form ref={formRef} method="post" onSubmit={() => { submittedWebsite.current = website; setDismissedAction(actionData); }}>
            <input type="hidden" name="shopifyDiscountId" value={promotion.id} />
            <input type="hidden" name="website" value={JSON.stringify(website)} />
            <input type="hidden" name="rankEntry" value={String(rankable && !wasRanked)} />
            <div className="create-discount-layout" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
              <aside className="desktop-preview-panel" style={{ position: "sticky", top: "20px", maxHeight: "calc(100vh - 40px)", overflowY: "auto", scrollbarGutter: "stable", alignSelf: "start" }}>
                <PromotionPreview placement={previewPlacement} onPlacementChange={setPreviewPlacement} discountCode={promotion.code} offerNote={promotion.code ? `Use code: ${promotion.code}` : "Applied automatically at checkout."} value={website} products={previewProducts} endsAt={promotion.endsAt} />
              </aside>
              <s-stack direction="block" gap="large">
                <FormStep {...section("general")}><PromotionGeneralTab promotion={promotion} /></FormStep>
                <FormStep {...section("customers")}><PromotionCustomersTab promotion={promotion} /></FormStep>
                <FormStep {...section("conditions")}><PromotionConditionsTab promotion={promotion} /></FormStep>
                <FormStep {...section("schedule")}><PromotionScheduleTab promotion={promotion} /></FormStep>
                <FormStep {...section("website")}>
                  <PromotionWebsiteEditor onActiveBlockChange={setPreviewPlacement} value={website} onChange={setWebsite} endsAt={promotion.endsAt} onBusyChange={setAssetsBusy} />
                </FormStep>
              </s-stack>
            </div>
          </Form>
        </s-stack>
      </div>
      <ModalOverlay open={isPreviewOpen} heading="Storefront preview" size="large" onClose={() => setIsPreviewOpen(false)}>
        <PromotionPreview placement={previewPlacement} onPlacementChange={setPreviewPlacement} discountCode={promotion.code} offerNote={promotion.code ? `Use code: ${promotion.code}` : "Applied automatically at checkout."} value={website} products={previewProducts} endsAt={promotion.endsAt} allowEnlarge={false} />
        <s-button slot="secondary-actions" onClick={() => setIsPreviewOpen(false)}>Close</s-button>
      </ModalOverlay>
      <style>{editorCss}</style>
    </s-page>
  );
}

export function shouldRevalidate({ formAction, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formAction && new URL(formAction, "https://app.example").pathname === "/app/promotion-codes") return false;
  return defaultShouldRevalidate;
}
