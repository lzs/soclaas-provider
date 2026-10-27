import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth";
import { buildOpenAICompatibleProviderCatalog } from "openclaw/plugin-sdk/provider-catalog-live-runtime";
import { buildAuthMethodOptions } from "./auth-options.js";
import { withCatalogFallback } from "./catalog-fallback.js";
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_MODEL_ID,
  PROVIDER_ID,
} from "./defaults.js";
import { createSoCLaaSEmbeddingProvider } from "./embedding.js";
import { projectSoCLaaSRows } from "./project-rows.js";

const BASE_URL = "https://soclaas-api.comp.nus.edu.sg/v1";

// Cold-start fallback. This keeps the provider resolvable before the first
// successful discovery; live rows replace it once discovery works.
const SEED_MODELS = [
  {
    id: DEFAULT_MODEL_ID,
    name: DEFAULT_MODEL_ID,
    reasoning: false,
    input: ["text"],
    contextWindow: 65536,
    maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
];

// Most recent successful projection, reused when a refresh fails. This is
// process-local and resets when the gateway restarts.
let lastGoodModels;

function cloneModel(model) {
  return {
    ...model,
    input: [...model.input],
    cost: { ...model.cost },
    ...(model.compat ? { compat: { ...model.compat } } : {}),
    ...(model.thinkingLevelMap
      ? { thinkingLevelMap: { ...model.thinkingLevelMap } }
      : {}),
  };
}

// Static catalog: one placeholder row until live discovery runs.
function buildSoCLaaSProvider() {
  return {
    baseUrl: BASE_URL,
    api: "openai-completions",
    models: SEED_MODELS.map(cloneModel),
  };
}

// Use the last successful projection, or the seed on a cold start.
function buildFallbackProvider(apiKey) {
  const models = lastGoodModels?.length ? lastGoodModels : SEED_MODELS;
  return {
    baseUrl: BASE_URL,
    api: "openai-completions",
    ...(apiKey ? { apiKey } : {}),
    models: models.map(cloneModel),
  };
}

// Remember non-empty projections so a failed refresh can reuse them.
function projectRowsWithCache(rows, fallback) {
  const projected = projectSoCLaaSRows(rows, fallback);
  if (projected.length > 0) lastGoodModels = projected.map(cloneModel);
  return projected;
}

export default definePluginEntry({
  id: "soclaas-provider",
  name: "SoCLaaS Provider",
  description: "Registers the SoCLaaS OpenAI-compatible gateway with live model discovery",
  register(api) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "SoCLaaS",
      envVars: ["SOCLAAS_API_KEY"],

      auth: [createProviderApiKeyAuthMethod(buildAuthMethodOptions())],

      catalog: {
        order: "simple",
        run: async (ctx) => {
          const result = await buildOpenAICompatibleProviderCatalog({
            ctx,
            providerId: PROVIDER_ID,
            buildProvider: buildSoCLaaSProvider,
            discoveryMode: "strict",
            allowExplicitBaseUrl: true,
            // BASE_URL already ends in /v1, so this resolves to <baseUrl>/models.
            modelDiscovery: {
              endpointPath: "models",
              // The gateway publishes display names, pricing, and modality
              // support in a vendor block that the generic projector ignores.
              projectRows: projectRowsWithCache,
            },
          });
          // Strict discovery reports failure as an empty provider set. Serve
          // the last known good rows so pinned models stay resolvable. Carry
          // the resolved key so the fallback matches the live shape.
          return withCatalogFallback(result, PROVIDER_ID, () =>
            buildFallbackProvider(ctx.resolveProviderApiKey(PROVIDER_ID)?.apiKey),
          );
        },
      },

      staticCatalog: {
        order: "simple",
        run: async () => ({ provider: buildSoCLaaSProvider() }),
      },
    });

    api.registerEmbeddingProvider({
      id: PROVIDER_ID,
      defaultModel: DEFAULT_EMBEDDING_MODEL_ID,
      transport: "remote",
      authProviderId: PROVIDER_ID,
      create: async (options) => {
        const auth = await api.runtime.modelAuth.resolveApiKeyForProvider({
          provider: PROVIDER_ID,
          cfg: options.config,
        });
        return createSoCLaaSEmbeddingProvider({
          apiKey: auth?.apiKey,
          baseUrl: options.remote?.baseUrl ?? BASE_URL,
          model: options.model ?? DEFAULT_EMBEDDING_MODEL_ID,
        });
      },
    });
  },
});
