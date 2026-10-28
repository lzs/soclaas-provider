import test from "node:test";
import assert from "node:assert/strict";
import { createSoCLaaSEmbeddingProvider } from "../embedding.js";

function jsonResponse(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function modelResponse(id = "bge-m3", capabilities = ["embeddings"]) {
  return jsonResponse({
    data: [{ id, soclaas: { capabilities } }],
  });
}

test("confirms bge-m3 and embeds single and batch inputs", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/models")) return modelResponse();
    if (url.endsWith("/embeddings")) {
      const body = JSON.parse(init.body);
      return jsonResponse({
        data: body.input.map((_, index) => ({
          index,
          embedding: [index, 1, 2],
        })),
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const result = await createSoCLaaSEmbeddingProvider({
    apiKey: "test-key",
    baseUrl: "https://embedding.test/one/v1",
    fetchImpl,
  });

  assert.equal(result.provider.id, "soclaas");
  assert.equal(result.provider.model, "bge-m3");
  assert.equal(result.provider.dimensions, 1024);
  assert.deepEqual(await result.provider.embed("hello"), [0, 1, 2]);
  assert.deepEqual(await result.provider.embedBatch(["a", "b"]), [
    [0, 1, 2],
    [1, 1, 2],
  ]);

  assert.equal(calls[0].url, "https://embedding.test/one/v1/models");
  assert.equal(
    calls[0].init.headers.authorization,
    "Bearer test-key",
  );
  assert.equal(calls[1].url, "https://embedding.test/one/v1/embeddings");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    model: "bge-m3",
    input: ["hello"],
  });
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    model: "bge-m3",
    input: ["a", "b"],
  });
});

test("orders vectors by their response index", async () => {
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/models")) return modelResponse();
    const body = JSON.parse(init.body);
    return jsonResponse({
      data: body.input
        .map((_, index) => ({
          index,
          embedding: [index],
        }))
        .reverse(),
    });
  };

  const result = await createSoCLaaSEmbeddingProvider({
    apiKey: "test-key",
    baseUrl: "https://embedding.test/order/v1",
    fetchImpl,
  });

  assert.deepEqual(await result.provider.embedBatch(["a", "b"]), [[0], [1]]);
});

test("rejects when the embedding model is missing from /v1/models", async () => {
  const fetchImpl = async () => modelResponse("other-model");

  await assert.rejects(
    () =>
      createSoCLaaSEmbeddingProvider({
        apiKey: "test-key",
        baseUrl: "https://embedding.test/missing/v1",
        fetchImpl,
      }),
    /was not found in \/v1\/models/,
  );
});

test("rejects models that are not advertised as embeddings", async () => {
  const fetchImpl = async () => modelResponse("bge-m3", ["chat"]);

  await assert.rejects(
    () =>
      createSoCLaaSEmbeddingProvider({
        apiKey: "test-key",
        baseUrl: "https://embedding.test/not-embeddings/v1",
        fetchImpl,
      }),
    /not advertised as an embeddings endpoint/,
  );
});

test("rejects a missing API key before making requests", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return modelResponse();
  };

  await assert.rejects(
    () =>
      createSoCLaaSEmbeddingProvider({
        apiKey: "",
        baseUrl: "https://embedding.test/no-key/v1",
        fetchImpl,
      }),
    /require a SoCLaaS API key/,
  );
  assert.equal(called, false);
});

test("rejects a vector count mismatch", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/models")) return modelResponse();
    return jsonResponse({
      data: [{ index: 0, embedding: [1, 2, 3] }],
    });
  };

  const result = await createSoCLaaSEmbeddingProvider({
    apiKey: "test-key",
    baseUrl: "https://embedding.test/count/v1",
    fetchImpl,
  });

  await assert.rejects(
    () => result.provider.embedBatch(["a", "b"]),
    /returned 1 vectors for 2 inputs/,
  );
});

test("retries rate-limited embedding requests", async () => {
  let attempts = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/models")) return modelResponse();
    attempts += 1;
    if (attempts === 1) {
      return jsonResponse({ error: "rate limit exceeded" }, 429);
    }
    const body = JSON.parse(init.body);
    return jsonResponse({
      data: body.input.map((_, index) => ({ index, embedding: [1] })),
    });
  };

  const result = await createSoCLaaSEmbeddingProvider({
    apiKey: "test-key",
    baseUrl: "https://embedding.test/retry/v1",
    fetchImpl,
    retryBaseDelayMs: 1,
  });

  assert.deepEqual(await result.provider.embed("hello"), [1]);
  assert.equal(attempts, 2);
});

test("limits concurrent embedding requests", async () => {
  let active = 0;
  let maxActive = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/models")) return modelResponse();
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    const body = JSON.parse(init.body);
    return jsonResponse({
      data: body.input.map((_, index) => ({ index, embedding: [1] })),
    });
  };

  const result = await createSoCLaaSEmbeddingProvider({
    apiKey: "test-key",
    baseUrl: "https://embedding.test/concurrency/v1",
    fetchImpl,
    maxConcurrentRequests: 2,
    retryBaseDelayMs: 1,
  });

  await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      result.provider.embed(`input-${index}`),
    ),
  );

  assert.equal(maxActive, 2);
});
