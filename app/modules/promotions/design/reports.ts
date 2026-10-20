// The Reports page counts how many times each discount has been used, whoever created it, and totals them in groups the
// merchant defines by a pattern in the code or title. Every discount that has been used lands in exactly one group, or
// in "Other discounts", so the groups always add up to the total. It also totals by the app that created each
// discount, which needs no set-up: a new app's discounts appear on their own.

/** One discount that has been used, as it was at one moment. */
export type UsageRow = { id: string; title: string; code: string; kind: "code" | "automatic"; createdBy: string; uses: number };

export const matchOptions = ["code", "title", "either"] as const;
export const matchTypes = ["starts_with", "contains", "ends_with"] as const;
export type MatchOn = (typeof matchOptions)[number];
export type MatchType = (typeof matchTypes)[number];
export type GroupDef = { id: number; name: string; matchOn: MatchOn; matchType: MatchType; pattern: string };

export const matchOnLabels: Record<MatchOn, string> = { code: "Code", title: "Title", either: "Code or title" };
export const matchTypeLabels: Record<MatchType, string> = { starts_with: "starts with", contains: "contains", ends_with: "ends with" };
export const maxGroups = 20;
export const otherKey = "other";

export function describeGroup(group: Pick<GroupDef, "matchOn" | "matchType" | "pattern">): string {
  return `${matchOnLabels[group.matchOn]} ${matchTypeLabels[group.matchType]} “${group.pattern}”`;
}

/** Whether a discount belongs to a group. Not case sensitive; an empty pattern matches nothing. */
export function matchesGroup(group: Pick<GroupDef, "matchOn" | "matchType" | "pattern">, row: Pick<UsageRow, "title" | "code">): boolean {
  const pattern = group.pattern.trim().toLowerCase();
  if (!pattern) return false;
  const test = (value: string) => {
    const text = value.toLowerCase();
    return group.matchType === "starts_with" ? text.startsWith(pattern) : group.matchType === "ends_with" ? text.endsWith(pattern) : text.includes(pattern);
  };
  return (group.matchOn !== "title" && test(row.code)) || (group.matchOn !== "code" && test(row.title));
}

/** Checks what the merchant typed for a group. Throws a plain message, or returns the cleaned values. */
export function validateGroup(input: { name?: unknown; matchOn?: unknown; matchType?: unknown; pattern?: unknown }): Omit<GroupDef, "id"> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const pattern = typeof input.pattern === "string" ? input.pattern.trim() : "";
  if (!name) throw new Error("Give the group a name.");
  if (name.length > 60) throw new Error("The group name can be up to 60 characters.");
  if (!pattern) throw new Error("Enter the text to look for in the code or title.");
  if (pattern.length > 60) throw new Error("The text to look for can be up to 60 characters.");
  if (!(matchOptions as readonly unknown[]).includes(input.matchOn)) throw new Error("Choose whether to look in the code, the title or either.");
  if (!(matchTypes as readonly unknown[]).includes(input.matchType)) throw new Error("Choose how the text should match.");
  return { name, pattern, matchOn: input.matchOn as MatchOn, matchType: input.matchType as MatchType };
}

/**
 * The campaign prefix of a generated code shaped PREFIX-UNIQUE-UNIQUE, like the single-use codes Dotdigital makes
 * (WELCOME-1A2B3C4D-9XY8ZQ is WELCOME). Anything not shaped that way has no prefix.
 */
export function codePrefix(code: string): string | null {
  return /^([A-Za-z0-9_]+)-[A-Za-z0-9]{4,}-[A-Za-z0-9]{4,}$/.exec(code.trim())?.[1].toUpperCase() ?? null;
}

export type ReportLine = { key: string; name: string; description: string; discounts: number; redemptions: number; allTime: number };
export type ReportDiscount = { id: string; title: string; code: string; createdBy: string; redemptions: number; allTime: number };
export type Report = {
  /** The merchant's groups in order, then "Other discounts". */
  groups: ReportLine[];
  /** The same redemptions grouped by the app that created the discount, biggest first. */
  creators: ReportLine[];
  /** Redemptions of generated codes (PREFIX-UNIQUE-UNIQUE) by their prefix, biggest first. Needs no set-up. */
  prefixes: ReportLine[];
  /** The used discounts that are in no group, biggest first, so the merchant can see what a new group would catch. */
  unmatched: ReportDiscount[];
  totals: { discounts: number; redemptions: number; allTime: number };
};

/**
 * Totals the discounts. With `earlier` (an older snapshot) the redemptions are those since then: each discount's uses
 * now less its uses then, so a discount made since counts in full. Without it, redemptions are the lifetime totals.
 */
export function buildReport(groups: GroupDef[], current: UsageRow[], earlier: UsageRow[] | null): Report {
  const before = new Map((earlier ?? []).map(row => [row.id, row.uses]));
  const lines = new Map<string, ReportLine>(groups.map(group => [`group-${group.id}`, { key: `group-${group.id}`, name: group.name, description: describeGroup(group), discounts: 0, redemptions: 0, allTime: 0 }]));
  lines.set(otherKey, { key: otherKey, name: "Other discounts", description: "Used discounts that are in none of the groups above", discounts: 0, redemptions: 0, allTime: 0 });
  const creators = new Map<string, ReportLine>();
  const prefixes = new Map<string, ReportLine>();
  const unmatched: ReportDiscount[] = [];
  const totals = { discounts: 0, redemptions: 0, allTime: 0 };
  for (const row of current) {
    const redemptions = earlier ? Math.max(0, row.uses - (before.get(row.id) ?? 0)) : row.uses;
    const key = (() => { const hit = groups.find(group => matchesGroup(group, row)); return hit ? `group-${hit.id}` : otherKey; })();
    const add = (line: ReportLine) => { line.allTime += row.uses; line.redemptions += redemptions; if (redemptions > 0) line.discounts++; };
    add(lines.get(key)!);
    const creator = row.createdBy || "Unknown";
    add(creators.get(creator) ?? (creators.set(creator, { key: creator, name: creator, description: "Created by this app or person in Shopify", discounts: 0, redemptions: 0, allTime: 0 }), creators.get(creator)!));
    const prefix = codePrefix(row.code);
    if (prefix) add(prefixes.get(prefix) ?? (prefixes.set(prefix, { key: prefix, name: `${prefix}-`, description: `Codes shaped ${prefix}-…-…, such as the single-use codes another app generates`, discounts: 0, redemptions: 0, allTime: 0 }), prefixes.get(prefix)!));
    totals.allTime += row.uses; totals.redemptions += redemptions; if (redemptions > 0) totals.discounts++;
    if (key === otherKey) unmatched.push({ id: row.id, title: row.title, code: row.code, createdBy: creator, redemptions, allTime: row.uses });
  }
  unmatched.sort((a, b) => b.redemptions - a.redemptions || b.allTime - a.allTime);
  return {
    groups: [...lines.values()],
    creators: [...creators.values()].sort((a, b) => b.redemptions - a.redemptions || b.allTime - a.allTime),
    prefixes: [...prefixes.values()].sort((a, b) => b.redemptions - a.redemptions || b.allTime - a.allTime),
    unmatched: unmatched.filter(row => row.redemptions > 0 || !earlier).slice(0, 25),
    totals,
  };
}

/** The short names for the periods the page offers. "all" is the lifetime totals. */
export const reportPeriods = [{ value: "all", label: "All time", days: null }, { value: "7", label: "Last 7 days", days: 7 }, { value: "30", label: "Last 30 days", days: 30 }, { value: "90", label: "Last 90 days", days: 90 }] as const;
export function periodDays(value: string | null): number | null {
  return reportPeriods.find(period => period.value === value)?.days ?? null;
}
