import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stepForIssue } from "../app/modules/promotions/design/saveIssueStep";

test("save problems point at the step of the form that needs fixing", () => {
  const expected: Array<[string, string | null]> = [
    ["Enter a discount code (up to 255 characters).", "type"],
    ["Enter a discount title (up to 255 characters).", "type"],
    ["Enter a name for the code list (up to 255 characters).", "type"],
    ["Enter a whole number of codes from 1 to 10,000.", "type"],
    ["Prefixes and suffixes can contain up to 32 letters, numbers, hyphens or underscores each.", "type"],
    ["Enter a valid discount value.", "value"],
    ["The percentage must be 100 or less.", "value"],
    ["Select products for the discount.", "value"],
    ["Select collections for the discount.", "value"],
    ["Select at least one product variant.", "value"],
    ["Enter a valid purchase quantity.", "value"],
    ["Enter a valid reward amount.", "value"],
    ["Enter a valid uses per order.", "value"],
    ["Select at least one country.", "value"],
    ["Enter two-letter country codes, separated by commas.", "value"],
    ["Enter a maximum shipping rate.", "value"],
    ["Select the eligible customers or segments.", "who"],
    ["Invalid Customer selection.", "who"],
    ["The end must be after the promotion start.", "schedule"],
    ["Choose an end date and time, or turn off the end date.", "schedule"],
    ["Enter a valid minimum amount.", "advanced"],
    ["Enter a valid minimum quantity.", "advanced"],
    ["Enter a valid usage limit.", "advanced"],
    ["Select combination tags for discounts on the same product.", "advanced"],
    ["Network error", null],
  ];
  for (const [message, step] of expected) assert.equal(stepForIssue(message), step, message);
});

test("every message the discount checks can raise belongs to a step", () => {
  const messages = new Set<string>();
  for (const file of ["app/modules/promotions/design/discountMutation.ts", "app/modules/promotions/design/codeGeneration.ts"]) {
    for (const match of readFileSync(file, "utf8").matchAll(/new Error\(\s*(?:[^"`'()]*\?\s*)?"([^"]+)"(?:\s*:\s*"([^"]+)")?/g)) {
      messages.add(match[1]);
      if (match[2]) messages.add(match[2]);
    }
  }
  assert.ok(messages.size > 15, "the messages were found");
  for (const message of messages) assert.notEqual(stepForIssue(message), null, `No step for: ${message}`);
});
