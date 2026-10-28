import {
  DEFAULT_EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_INPUT_TOKENS,
  PROVIDER_ID,
} from "./defaults.js";

const MODEL_CACHE_MS = 60_000;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_MS = 500;
const MAX_RETRY_MS = 8000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

let modelCache;

function trimBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function delay(ms, signal) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
      },
      { once: true },
    );
  });
}

function retryDelayMs(attempt, baseDelayMs, response) {
  const retryAfter = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_MS);
  }
  const base = Math.min(baseDelayMs * 2 ** attempt, MAX_RETRY_MS);
  return base + Math.floor(Math.random() * base * 0.2);
}

function createRequestLimiter(limit = MAX_CONCURRENT_REQUESTS) {
  const maximum = Number.isInteger(limit) && limit > 0 ? limit : MAX_CONCURRENT_REQUESTS;
  let active = 0;
  const waiting = [];

  return async (fn) => {
    if (active < maximum) {
      active += 1;
    } else {
      await new Promise((resolve) => waiting.push(resolve));
    }
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

async function fetchWithRetry(options) {
  const { url, init, fetchImpl, signal, limiter, retryBaseDelayMs } = options;
  let lastResponse;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await limiter(() => fetchImpl(url, { ...init, signal }));
    } catch (error) {
      if (signal?.aborted || attempt === MAX_ATTEMPTS - 1) throw error;
      await delay(retryDelayMs(attempt, retryBaseDelayMs), signal);
      continue;
    }

    if (response.ok) return response;
    lastResponse = response;
    if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS - 1) {
      return response;
    }
    await response.text().catch(() => "");
    await delay(retryDelayMs(attempt, retryBaseDelayMs, response), signal);
  }

  return lastResponse;
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

async function fetchModels(options) {
  const { baseUrl, apiKey, fetchImpl, signal, limiter, retryBaseDelayMs } = options;
  const response = await fetchWithRetry({
    url: joinUrl(baseUrl, "models"),
    init: {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
    },
    fetchImpl,
    signal,
    limiter,
    retryBaseDelayMs,
  });

  if (!response.ok) {
    throw new Error(`SoCLaaS model discovery failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload?.data)) return payload.data;
  return Array.isArray(payload) ? payload : [];
}

async function confirmEmbeddingModel(options) {
  const { baseUrl, apiKey, model, fetchImpl, signal, limiter, retryBaseDelayMs } = options;
  const cacheKey = `${baseUrl}\0${model}`;
  const now = Date.now();

  if (
    modelCache?.key === cacheKey &&
    now - modelCache.checkedAt < MODEL_CACHE_MS
  ) {
    return;
  }

  const rows = await fetchModels({
    baseUrl,
    apiKey,
    fetchImpl,
    signal,
    limiter,
    retryBaseDelayMs,
  });
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
  const { baseUrl, apiKey, model, inputs, fetchImpl, signal, limiter, retryBaseDelayMs } = options;
  if (inputs.length === 0) return [];

  const response = await fetchWithRetry({
    url: joinUrl(baseUrl, "embeddings"),
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ model, input: inputs }),
    },
    fetchImpl,
    signal,
    limiter,
    retryBaseDelayMs,
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
    maxConcurrentRequests = MAX_CONCURRENT_REQUESTS,
    retryBaseDelayMs = DEFAULT_RETRY_BASE_MS,
  } = options;

  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error(
      "SoCLaaS embeddings require a SoCLaaS API key. Run `openclaw models auth login --provider soclaas`.",
    );
  }

  const resolvedBaseUrl = trimBaseUrl(baseUrl);
  const resolvedModel = model?.trim() || DEFAULT_EMBEDDING_MODEL_ID;
  const limiter = createRequestLimiter(maxConcurrentRequests);

  await confirmEmbeddingModel({
    baseUrl: resolvedBaseUrl,
    apiKey: apiKey.trim(),
    model: resolvedModel,
    fetchImpl,
    limiter,
    retryBaseDelayMs,
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
        limiter,
        retryBaseDelayMs,
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
        limiter,
        retryBaseDelayMs,
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
