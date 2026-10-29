# SoCLaaS Provider for OpenClaw

Registers the [SoCLaaS](https://soclaas.comp.nus.edu.sg) OpenAI-compatible gateway as an OpenClaw model provider.
Models are discovered from `GET /v1/models` at runtime, so gateway additions and
metadata changes do not require config edits.

## Features

- Registers the `soclaas` provider with the SoCLaaS base URL.
- Registers `bge-m3` for memory-search embeddings after confirming it is
  advertised by `/v1/models`.
- Discovers chat models on demand and caches the result for 60 seconds.
- Publishes display names, context limits, pricing, reasoning support, and input
  modalities from the gateway's vendor metadata.
- Keeps the gateway's stable `default` alias while filtering other aliases,
  embedding endpoints, and audio endpoints.
- Selects `soclaas/default` during authentication when no primary model is
  already configured.
- Reuses the last successful model list when a refresh fails.
- Keeps the provider resolvable on a cold start with a single placeholder model.
- Has no runtime dependencies and no build step.

## Requirements

- OpenClaw `>= 2026.10.7`.
- A SoCLaaS API key.
- Node.js `>= 24.22.1 < 25` or `>= 26.12.1`.

## Install

### From ClawHub

```bash
openclaw plugins install clawhub:@lzs/soclaas-provider --accept-capabilities
openclaw plugins enable soclaas-provider --accept-capabilities
```

The package name is `@lzs/soclaas-provider`; the plugin id remains
`soclaas-provider`. Installing a plugin does not enable it, so both commands are
required. `--accept-capabilities` approves the plugin's declared capability
surface (here, the `soclaas` text-inference provider) and is required for
noninteractive installs. Interactive installs prompt for the same consent.

### From GitHub

Install directly from the public repository:

```bash
openclaw plugins install git:github.com/lzs/soclaas-provider@v0.1.4 \
  --force --accept-capabilities
openclaw plugins enable soclaas-provider --accept-capabilities
```

Replace `v0.1.4` with the release tag or commit SHA you want to run. Pinning to
a tag or commit keeps installs reproducible; `@main` follows the latest source
but can change without warning. Git sources are outside ClawHub review, so
noninteractive installs require `--force`. The plugin id remains
`soclaas-provider`. To update a git install, reinstall with the new ref:

```bash
openclaw plugins install git:github.com/lzs/soclaas-provider@<new-ref> \
  --force --accept-capabilities
```

### From a local checkout

```bash
mkdir -p ~/.openclaw/plugins
cp -R ./soclaas-provider ~/.openclaw/plugins/soclaas-provider

openclaw plugins install --link ~/.openclaw/plugins/soclaas-provider \
  --force --accept-capabilities
openclaw plugins enable soclaas-provider --accept-capabilities
```

`--force` acknowledges that the source is outside ClawHub review. The managed
install records capability acceptance. As an alternative, add the directory to
`plugins.load.paths` in `~/.openclaw/openclaw.json`.

## Remove existing provider config

If you previously declared the SoCLaaS provider by hand, remove that block so the
plugin owns the catalog:

```bash
openclaw config unset models.providers.soclaas
```

A provider-level `baseUrl` that differs from the plugin endpoint can hide
discovered models without an error. The API key is stored in an auth profile,
not in this block, so removing the block does not remove the credential.

## Authenticate

```bash
# Interactive prompt
openclaw models auth login --provider soclaas

# Non-interactive
openclaw onboard --soclaas-api-key <key>
```

The plugin declares `SOCLAAS_API_KEY`, so an existing secret with that name is
picked up automatically. Confirm the stored credential with:

```bash
openclaw models auth list
```

### Default model

When neither a primary model nor an explicit model selection exists, the plugin
sets `soclaas/default` as the primary model. It will not replace an existing
primary.

`soclaas/default` is a stable gateway alias for the model SoCLaaS currently
serves as its default. The gateway's live metadata determines its display name,
context window, pricing, and input modes.

Thinking is inherited: the plugin does not set a thinking level. The current
`default` metadata advertises no reasoning support, so thinking remains off for
that model. Use a discovered reasoning model if you need thinking controls.

This behavior is applied by `models auth login` and `onboard`.
`openclaw models auth paste-api-key` bypasses the provider auth method and does
not apply the default.

On a fresh install, `soclaas/default` is the recommended primary and image
model. The plugin sets it as primary during authentication when no primary is
configured, but it does not set `agents.defaults.imageModel`. To configure both
explicitly:

```bash
openclaw models set soclaas/default
openclaw config set agents.defaults.imageModel.primary soclaas/default
```

If you do not need a separate image model, leave `agents.defaults.imageModel`
unset; OpenClaw inherits the primary where applicable.

### Memory search

The plugin registers `bge-m3` for OpenClaw memory embeddings. Before creating
the provider, it confirms that `bge-m3` is present in `/v1/models` and advertises
the `embeddings` capability.

```json5
{
  memory: {
    search: {
      provider: "soclaas",
      model: "bge-m3",
    },
  },
}
```

The embedding provider reuses the existing SoCLaaS auth profile, limits
concurrent requests, and retries transient upstream failures. After switching
embedding providers or models, rebuild the memory index:

```bash
openclaw memory status --index --agent main
```

## Use

```bash
openclaw models list --provider soclaas --refresh

# Stable default alias
openclaw models set soclaas/default

# Or a specific discovered model
openclaw models set soclaas/<model-id>
```

If model restrictions are enabled, allow the provider wildcard:

```json5
{
  agents: {
    defaults: {
      modelPolicy: {
        allow: ["soclaas/*"],
      },
    },
  },
}
```

## How discovery works

OpenClaw requests the catalog on model runs, picker refreshes, and `models.list`.
The plugin:

1. Fetches `GET <baseUrl>/models` and caches the result for 60 seconds.
2. Projects chat-capable rows into the OpenClaw model shape.
3. Keeps the gateway's `default` alias and filters all other aliases.
4. Replaces the cached list only after a successful, non-empty refresh.
5. Uses the previous list if a refresh fails, and the static seed if discovery
   has never succeeded in the current process.

The static seed is a single `default` model. It keeps the provider resolvable
before the first successful discovery. The live gateway metadata replaces it
once discovery works.

Upstream changes appear on the next successful discovery after the cache
expires. An idle gateway does not refresh on a timer. To force a gateway-side
refresh:

```bash
openclaw gateway call models.list --params '{"refresh":true}'
openclaw plugins reload soclaas-provider
```

`openclaw models list --refresh` refreshes only the CLI process. Use it to see
what the gateway currently advertises, not to update the running Gateway.

## Configuration

The plugin does not need a `models.providers.soclaas` block. Provider settings
live in the plugin source:

- `BASE_URL` and `SEED_MODELS` in `index.js`
- `DEFAULT_MODEL_ID` and `DEFAULT_MODEL_REF` in `defaults.js`
- Auth default-model behavior in `auth-options.js`
- Embedding provider and `bge-m3` verification in `embedding.js`
- Model filtering and metadata mapping in `project-rows.js`
- Last-known-good fallback behavior in `catalog-fallback.js`

After changing the plugin, reload it:

```bash
openclaw plugins reload soclaas-provider
```

## Troubleshooting

### Zero models after install

Enable the plugin. Installing and enabling are separate steps.

```bash
openclaw plugins enable soclaas-provider --accept-capabilities
```

### `Install cancelled; rerun with --force`

Add `--force` after reviewing the source. The plugin runs inside the Gateway
process.

### Names show `(Custom Provider)` or only the seed row appears

A hand-written provider block is overriding the plugin:

```bash
openclaw config get models.providers.soclaas
openclaw config unset models.providers.soclaas
openclaw models list --provider soclaas --refresh
```

### `Unknown model: soclaas/...` with a `models.providers` hint

This is OpenClaw's generic fallback hint when a model is missing from the
runtime catalog. It does not mean the plugin needs a static provider block. Do
not add `models.providers.soclaas`; it competes with the plugin-owned catalog.

Confirm the plugin is loaded in the same Gateway that serves the request, then
refresh and reload:

```bash
openclaw plugins inspect soclaas-provider --runtime
openclaw models list --provider soclaas --refresh
openclaw gateway call models.list --params '{"refresh":true}'
openclaw plugins reload soclaas-provider
```

If the CLI sees the model but the Control UI does not, use the picker Refresh
action.

### `Plugin not found: soclaas-provider`

The plugin is not installed or is outside the directories OpenClaw scans.

```bash
openclaw plugins list
```

### `provenance-invalid` warning after install

This is expected for a community-channel ClawHub package or a git install. It
means OpenClaw cannot treat the install as trusted-official; it does not block
provider registration, authentication, or model discovery. Trusted-only runtime
capabilities would require the official channel.

### `openclaw plugins validate` mention of missing tool metadata

This validator targets tool and feature plugins. A provider-only plugin
registers models and auth, so the warning is expected.

### Discovery works in the CLI but the Control UI is stale

Use the Refresh action in the model picker. Picker content is cached on the
client, so reloading the plugin does not update an already-open picker.

## Development

```bash
npm run check
npm test
npm run release:check
```

The tests use `node:test` and require no dependencies. The plugin runs inside the
Gateway process, so review changes before reloading.

## Publishing

```bash
clawhub package validate .
clawhub package publish . \
  --family code-plugin \
  --owner lzs \
  --topics "soclaas,nus,llm,model-provider" \
  --dry-run
```

Remove `--dry-run` to publish. Releases remain pending until ClawHub security
checks pass. ClawHub serves the README and package contents from the published
artifact, so documentation changes become visible on the listing only after
publishing a new version. Bump the `package.json` version before publishing.

## Files

```text
soclaas-provider/
├── openclaw.plugin.json   # Plugin manifest
├── package.json           # Package metadata and scripts
├── index.js               # Plugin entry point and provider registration
├── defaults.js            # Provider and default-model constants
├── auth-options.js        # Auth method options and default-model selection
├── catalog-fallback.js    # Fallback for failed live discovery
├── embedding.js           # bge-m3 memory embedding provider
├── project-rows.js        # Vendor metadata projection
├── test/                  # Unit tests
├── CHANGELOG.md
├── SECURITY.md
└── LICENSE
```

## Security

See [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

MIT. See [LICENSE](LICENSE).
