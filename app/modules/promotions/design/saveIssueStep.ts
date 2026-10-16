export type StepId = "type" | "value" | "who" | "schedule" | "advanced" | "website";

// The form's checks report a message, not a field. These rules say which step of the
// form a message belongs to, so the editor can point at the step that needs fixing.
// Order matters: the first matching rule wins.
const rules: Array<[RegExp, StepId]> = [
  [/end date|end must|start/i, "schedule"],
  [/customer|segment/i, "who"],
  [/combination tags|usage limit|minimum/i, "advanced"],
  [/uses per order|countr|shipping|reward|purchase|discount value|value type|percentage|variant|product|collection|resource type/i, "value"],
  [/discount type and method|discount code|discount title|code list|codes|prefix|suffix|shared code/i, "type"],
];

/** The step a save problem belongs to, or null when the message is not recognised. */
export function stepForIssue(message: string): StepId | null {
  return rules.find(([pattern]) => pattern.test(message))?.[1] ?? null;
}
