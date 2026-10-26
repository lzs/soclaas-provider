import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthMethodOptions,
  resolveAuthDefaultModel,
} from "../auth-options.js";

test("selects soclaas/default when no primary model is configured", () => {
  assert.equal(resolveAuthDefaultModel({}), "soclaas/default");
  assert.equal(resolveAuthDefaultModel({ agents: { defaults: {} } }), "soclaas/default");
});

test("preserves an existing primary model", () => {
  assert.equal(
    resolveAuthDefaultModel({
      agents: { defaults: { model: { primary: "openai/gpt-5.4" } } },
    }),
    undefined,
  );
});

test("builds auth options with the default model and preservation", async () => {
  const options = buildAuthMethodOptions();

  assert.equal(options.defaultModel, "soclaas/default");
  assert.equal(options.preserveExistingPrimary, true);
  assert.equal(
    await options.resolveDefaultModel({ config: {} }),
    "soclaas/default",
  );
  assert.equal(
    await options.resolveDefaultModel({
      config: {
        agents: { defaults: { model: { primary: "openai/gpt-5.4" } } },
      },
    }),
    undefined,
  );
});
