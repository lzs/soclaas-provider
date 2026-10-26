import test from "node:test";
import assert from "node:assert/strict";
import { projectSoCLaaSRows } from "../project-rows.js";

const noFallback = { models: [] };

test("drops aliases, non-chat rows, invalid ids, and duplicate ids", () => {
  const rows = [
    { id: "chat", soclaas: { capabilities: ["chat"] } },
    { id: "alias", soclaas: { capabilities: ["chat"], alias_of: "chat" } },
    { id: "embedding", soclaas: { capabilities: ["embeddings"] } },
    { id: "bad id", soclaas: { capabilities: ["chat"] } },
    { id: "chat", soclaas: { capabilities: ["chat"] } },
  ];

  const ids = projectSoCLaaSRows(rows, noFallback).map((model) => model.id);
  assert.deepEqual(ids, ["chat"]);
});

test("keeps the gateway default alias", () => {
  const [model] = projectSoCLaaSRows(
    [
      {
        id: "default",
        context_window: 262144,
        soclaas: {
          display_name: "Qwen 3.6 35B A3B",
          capabilities: ["chat"],
          alias_of: "qwen3.6:35b",
          input_modalities: ["text", "vision"],
          input_microdollars_per_million_tokens: 411810,
          output_microdollars_per_million_tokens: 1456571,
        },
      },
      {
        id: "coder",
        soclaas: { capabilities: ["chat"], alias_of: "qwen3.8:27b" },
      },
    ],
    noFallback,
  );

  assert.equal(model.id, "default");
  assert.equal(model.name, "Qwen 3.6 35B A3B");
  assert.equal(model.contextWindow, 262144);
  assert.deepEqual(model.input, ["text", "image"]);
  assert.equal(model.reasoning, false);
  assert.deepEqual(model.cost, {
    input: 0.41181,
    output: 1.456571,
    cacheRead: 0,
    cacheWrite: 0,
  });
});

test("maps vendor metadata to the OpenClaw model shape", () => {
  const [model] = projectSoCLaaSRows(
    [
      {
        id: "vision-model",
        context_window: 128000,
        max_completion_tokens: 8192,
        soclaas: {
          display_name: "Vision Model",
          capabilities: ["chat"],
          input_modalities: ["text", "image", "pdf"],
          input_microdollars_per_million_tokens: 1000000,
          output_microdollars_per_million_tokens: 2000000,
          cache_read_microdollars_per_million_tokens: 500000,
          cache_write_microdollars_per_million_tokens: 250000,
        },
      },
    ],
    noFallback,
  );

  assert.equal(model.name, "Vision Model");
  assert.equal(model.contextWindow, 128000);
  assert.equal(model.maxTokens, 8192);
  assert.deepEqual(model.input, ["text", "image", "document"]);
  assert.deepEqual(model.cost, {
    input: 1,
    output: 2,
    cacheRead: 0.5,
    cacheWrite: 0.25,
  });
});

test("keeps text first and deduplicates input modalities", () => {
  const [model] = projectSoCLaaSRows(
    [
      {
        id: "image-model",
        soclaas: {
          capabilities: ["chat"],
          input_modalities: ["image", "text", "vision"],
        },
      },
    ],
    noFallback,
  );

  assert.deepEqual(model.input, ["text", "image"]);
});

test("uses fallback metadata for known models", () => {
  const fallback = {
    models: [
      {
        id: "known",
        name: "Known Model",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  };

  const [model] = projectSoCLaaSRows([{ id: "known" }], fallback);

  assert.equal(model.name, "Known Model");
  assert.equal(model.contextWindow, 200000);
  assert.equal(model.maxTokens, 4096);
  assert.deepEqual(model.input, ["text", "image"]);
  assert.equal(model.reasoning, true);
});

test("uses conservative defaults for unknown models", () => {
  const [model] = projectSoCLaaSRows([{ id: "plain-chat" }], noFallback);

  assert.equal(model.reasoning, false);
  assert.equal(model.contextWindow, 65536);
  assert.equal(model.maxTokens, 16384);
});

test("sorts models by id", () => {
  const ids = projectSoCLaaSRows(
    [{ id: "c" }, { id: "a" }, { id: "b" }],
    noFallback,
  ).map((model) => model.id);

  assert.deepEqual(ids, ["a", "b", "c"]);
});
