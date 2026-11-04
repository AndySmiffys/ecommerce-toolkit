/** Badge tone for a Shopify discount status, shared by every page that shows one. */
export function getStatusTone(status: string | undefined) {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "SCHEDULED":
      return "info";
    case "EXPIRED":
      return "critical";
    default:
      return "neutral";
  }
}
