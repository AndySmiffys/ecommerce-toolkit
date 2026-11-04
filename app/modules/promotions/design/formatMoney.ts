/** An amount in minor units (pence) as money in the shop's currency, for example 123456 as £1,234.56. */
export function formatMoney(cents: number | null, currency: string): string {
  if (cents === null) return "–";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}
