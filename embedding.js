import {
  DEFAULT_EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_INPUT_TOKENS,
  PROVIDER_ID,
} from "./defaults.js";

const MODEL_CACHE_MS = 60_000;

let modelCache;

function trimBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function joinUrl(baseUrl, path) {
  return `${trimBaseUrl(baseUrl)}/${path.replace(/^\/+/, "")}`;
}

function embeddingText(input) {
  if (typeof input === "string") return input;
  return typeof input?.text === "string" ? input.text : "";
}

function isEmbeddingCapable(row) {
  const capabilities = row?.soclaas?.capabilities;
  if (!Array.isArray(capabilities) || capabilities.length === 0) return true;
  return capabilities.includes("embeddings");
}

async function fetchModels({ baseUrl, apiKey, fetchImpl, signal }) {
  const response = await fetchImpl(joinUrl(baseUrl, "models"), {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`SoCLaaS model discovery failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload?.data)) return payload.data;
  return Array.isArray(payload) ? payload : [];
}

async function confirmEmbeddingModel(options) {
  const { baseUrl, apiKey, model, fetchImpl, signal } = options;
  const cacheKey = `${baseUrl}\0${model}`;
  const now = Date.now();

  if (
    modelCache?.key === cacheKey &&
    now - modelCache.checkedAt < MODEL_CACHE_MS
  ) {
    return;
  }

  const rows = await fetchModels({ baseUrl, apiKey, fetchImpl, signal });
  const row = rows.find((entry) => entry?.id === model);
  if (!row) {
    throw new Error(
      `SoCLaaS embedding model "${model}" was not found in /v1/models.`,
    );
  }
  if (!isEmbeddingCapable(row)) {
    throw new Error(
      `SoCLaaS model "${model}" is not advertised as an embeddings endpoint.`,
    );
  }

  modelCache = { key: cacheKey, checkedAt: now };
}

async function requestEmbeddings(options) {
  const { baseUrl, apiKey, model, inputs, fetchImpl, signal } = options;
  if (inputs.length === 0) return [];

  const response = await fetchImpl(joinUrl(baseUrl, "embeddings"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ model, input: inputs }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `SoCLaaS embeddings failed: HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const payload = await response.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  if (data.length !== inputs.length) {
    throw new Error(
      `SoCLaaS embeddings returned ${data.length} vectors for ${inputs.length} inputs.`,
    );
  }

  const ordered = data.every((entry) => Number.isInteger(entry?.index))
    ? [...data].sort((a, b) => a.index - b.index)
    : data;

  return ordered.map((entry, index) => {
    const embedding = entry?.embedding;
    if (
      !Array.isArray(embedding) ||
      embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error(
        `SoCLaaS embeddings returned an invalid vector at index ${index}.`,
      );
    }
    return embedding;
  });
}

export async function createSoCLaaSEmbeddingProvider(options = {}) {
  const {
    apiKey,
    baseUrl,
    model = DEFAULT_EMBEDDING_MODEL_ID,
    fetchImpl = fetch,
  } = options;

  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error(
      "SoCLaaS embeddings require a SoCLaaS API key. Run `openclaw models auth login --provider soclaas`.",
    );
  }

  const resolvedBaseUrl = trimBaseUrl(baseUrl);
  const resolvedModel = model?.trim() || DEFAULT_EMBEDDING_MODEL_ID;

  await confirmEmbeddingModel({
    baseUrl: resolvedBaseUrl,
    apiKey: apiKey.trim(),
    model: resolvedModel,
    fetchImpl,
  });

  const provider = {
    id: PROVIDER_ID,
    model: resolvedModel,
    dimensions: EMBEDDING_DIMENSIONS,
    maxInputTokens: EMBEDDING_MAX_INPUT_TOKENS,
    embed: async (input, callOptions) => {
      const [vector] = await requestEmbeddings({
        baseUrl: resolvedBaseUrl,
        apiKey: apiKey.trim(),
        model: resolvedModel,
        inputs: [embeddingText(input)],
        fetchImpl,
        signal: callOptions?.signal,
      });
      return vector ?? [];
    },
    embedBatch: async (inputs, callOptions) =>
      await requestEmbeddings({
        baseUrl: resolvedBaseUrl,
        apiKey: apiKey.trim(),
        model: resolvedModel,
        inputs: inputs.map(embeddingText),
        fetchImpl,
        signal: callOptions?.signal,
      }),
  };

  return {
    provider,
    runtime: {
      id: PROVIDER_ID,
      cacheKeyData: {
        provider: PROVIDER_ID,
        baseUrl: resolvedBaseUrl,
        model: resolvedModel,
      },
    },
  };
}
