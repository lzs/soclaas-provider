import test from "node:test";
import assert from "node:assert/strict";
import { withCatalogFallback } from "../catalog-fallback.js";

const fallbackProvider = { models: [{ id: "fallback" }] };

test("leaves a result with models unchanged", () => {
  const result = { provider: { models: [{ id: "live" }] }, outcomes: [] };
  const actual = withCatalogFallback(result, "soclaas", () => fallbackProvider);

  assert.equal(actual, result);
});

test("replaces an empty provider and preserves outcomes", () => {
  const result = { provider: { models: [] }, outcomes: [{ ok: false }] };
  const actual = withCatalogFallback(result, "soclaas", () => fallbackProvider);

  assert.deepEqual(actual.provider, fallbackProvider);
  assert.deepEqual(actual.outcomes, result.outcomes);
});

test("adds a fallback provider to the strict failure shape", () => {
  const result = { providers: {}, outcomes: [] };
  const actual = withCatalogFallback(result, "soclaas", () => fallbackProvider);

  assert.deepEqual(actual.providers.soclaas, fallbackProvider);
});

test("returns the original result when no fallback is available", () => {
  const result = { providers: {}, outcomes: [] };
  const actual = withCatalogFallback(result, "soclaas", () => undefined);

  assert.equal(actual, result);
});

test("ignores non-object results", () => {
  assert.equal(withCatalogFallback(null, "soclaas", () => fallbackProvider), null);
});
