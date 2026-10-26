import { DEFAULT_MODEL_REF, PROVIDER_ID } from "./defaults.js";

export function resolveAuthDefaultModel(config) {
  const existing = config?.agents?.defaults?.model?.primary;
  return existing ? undefined : DEFAULT_MODEL_REF;
}

export function buildAuthMethodOptions() {
  return {
    providerId: PROVIDER_ID,
    methodId: "api-key",
    label: "SoCLaaS API key",
    hint: "NUS School of Computing LLM gateway",
    optionKey: "soclaasApiKey",
    flagName: "--soclaas-api-key",
    envVar: "SOCLAAS_API_KEY",
    promptMessage: "Enter SoCLaaS API key",
    defaultModel: DEFAULT_MODEL_REF,
    preserveExistingPrimary: true,
    resolveDefaultModel: async ({ config }) => resolveAuthDefaultModel(config),
    noteTitle: "SoCLaaS default model",
    noteMessage:
      "Sets soclaas/default when no primary model is configured. " +
      "Thinking is inherited; soclaas/default currently advertises no reasoning support.",
  };
}
