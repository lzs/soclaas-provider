import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_REF,
  PROVIDER_ID,
} from "../defaults.js";

test("exposes the gateway default model reference", () => {
  assert.equal(PROVIDER_ID, "soclaas");
  assert.equal(DEFAULT_MODEL_ID, "default");
  assert.equal(DEFAULT_MODEL_REF, "soclaas/default");
});
