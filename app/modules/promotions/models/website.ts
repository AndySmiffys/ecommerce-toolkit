export type PromotionWebsiteSettings = {
  websiteEnabled: boolean;

  showProductPage: boolean;
  showCollectionPage: boolean;
  showProductBadge: boolean;
  showCountdown: boolean;
  showHeaderBanner: boolean;

  headline: string | null;
  body: string | null;
  badgeText: string | null;
  countdownText: string | null;
  buttonText: string | null;
  buttonUrl: string | null;

  backgroundColour: string | null;
  textColour: string | null;
  badgeColour: string | null;

  designJson?: string | null;

  priority: number;

  lastSyncedAt: string | null;
  lastSyncError: string | null;
};
