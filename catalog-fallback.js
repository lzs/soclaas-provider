// Fallback handling for strict live discovery.
//
// In strict mode, a failed refresh is reported as `{ providers: {}, outcomes }`
// and an empty successful refresh as `provider.models: []`. Either case would
// drop models that are not in the static seed, including a session's pinned
// model. This helper keeps the last successful projection in play while
// preserving the original outcome metadata.

/**
 * @param {unknown} result
 * @param {string} providerId
 * @param {() => { models: unknown[] } | undefined} buildFallbackProvider
 * @returns {unknown}
 */
export function withCatalogFallback(result, providerId, buildFallbackProvider) {
  // null means the provider is out of scope or has no usable credential.
  if (!result || typeof result !== "object") return result;

  const provider = result.provider ?? result.providers?.[providerId];
  const hasModels = Array.isArray(provider?.models) && provider.models.length > 0;
  if (hasModels) return result;

  const fallback = buildFallbackProvider();
  if (!Array.isArray(fallback?.models) || fallback.models.length === 0) return result;

  // Successful shape: { provider, outcomes }
  if (result.provider !== undefined) return { ...result, provider: fallback };

  // Strict-failure shape: { providers: {}, outcomes }
  return {
    ...result,
    providers: { ...(result.providers ?? {}), [providerId]: fallback },
  };
}
