/**
 * Product ID lists for the storefront, packed small. IDs are sorted, stored as the difference from the one before,
 * written in base 36 and joined with commas. A list of 7,000 IDs is about 45 KB instead of about 105 KB.
 * `extensions/promotion-engine/assets/promotion-engine.js` reads the same format: keep the two in step.
 */
export function encodeIds(ids: Iterable<string | number>): string {
  const sorted = [...new Set([...ids].map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
  let previous = 0;
  return sorted.map(id => { const delta = id - previous; previous = id; return delta.toString(36); }).join(",");
}

export function decodeIds(encoded: string): number[] {
  if (!encoded) return [];
  let total = 0;
  return encoded.split(",").map(part => (total += parseInt(part, 36)));
}
