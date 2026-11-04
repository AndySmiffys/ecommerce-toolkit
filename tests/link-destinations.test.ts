import test from "node:test";
import assert from "node:assert/strict";
import { destinationSearch, isDestinationType, searchLinkDestinations } from "../app/modules/promotions/services/linkDestinations.server";

function client(response: unknown, calls: Array<{ query: string; variables?: Record<string, unknown> }> = []) {
  return { graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => { calls.push({ query, variables: options?.variables }); return Response.json(response); } };
}

test("each destination type queries its own resource and returns shop-relative links", async () => {
  const cases = [["collection", "collections"], ["product", "products"], ["page", "pages"], ["blog", "blogs"]] as const;
  for (const [type, field] of cases) {
    const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
    const result = await searchLinkDestinations(client({ data: { [field]: { nodes: [{ id: `gid://shopify/X/1`, title: "Halloween", handle: "halloween" }] } } }, calls), type, "");
    assert.ok(calls[0].query.includes(`${field}(first: 25`), calls[0].query);
    assert.equal(calls[0].variables?.query, null);
    assert.deepEqual(result, { items: [{ id: "gid://shopify/X/1", title: "Halloween", url: `/${field}/halloween` }], error: null });
  }
});

test("search text is limited to title terms and cannot add its own filters", () => {
  assert.equal(destinationSearch("  "), "");
  assert.equal(destinationSearch("witch hat"), "title:*witch* AND title:*hat*");
  assert.equal(destinationSearch('x" OR status:active'), "title:*x* AND title:*OR* AND title:*status* AND title:*active*");
  assert.equal(destinationSearch("a".repeat(200)).length, "title:**".length + 80);
  assert.ok(isDestinationType("page") && !isDestinationType("article") && !isDestinationType(undefined));
});

test("a missing pages permission explains what to approve, while other errors are passed through", async () => {
  const denied = await searchLinkDestinations(client({ errors: [{ message: "Access denied for pages field.", extensions: { code: "ACCESS_DENIED" } }] }), "page", "");
  assert.deepEqual(denied.items, []);
  assert.match(denied.error!, /read_online_store_pages/);
  const other = await searchLinkDestinations(client({ errors: [{ message: "Throttled" }] }), "blog", "");
  assert.equal(other.error, "Throttled");
  const products = await searchLinkDestinations(client({ errors: [{ message: "Access denied for products field.", extensions: { code: "ACCESS_DENIED" } }] }), "product", "");
  assert.doesNotMatch(products.error!, /read_online_store_pages/);
});
