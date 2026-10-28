# Changelog

All notable changes to this project are documented in this file.

## [0.1.4] - 2026-10-27

### Fixed

- Limit concurrent embedding requests and retry rate-limited or transient
  upstream failures to keep memory indexing stable under load.

## [0.1.3] - 2026-10-27

### Added

- Register `bge-m3` as a memory-search embedding provider.
- Verify the embedding model is present in `/v1/models` and advertises the
  `embeddings` capability before use.

## [0.1.2] - 2026-10-27

### Fixed

- Project SoCLaaS `reasoning.supported_efforts` into OpenClaw model compatibility
  metadata. Unsupported thinking levels are hidden, `off` maps to the gateway's
  `none`, and advanced levels such as `xhigh` and `max` are exposed only when
  advertised.

### Changed

- Documented ClawHub capability consent, fresh-install model defaults
  (`soclaas/default`), and troubleshooting for plugin-backed model resolution.

## [0.1.1] - 2026-10-26

### Fixed

- Retried publication with a fresh ClawHub release after the `0.1.0` attempt
  remained stuck in `pending_checks` despite a clean security scan.

## [0.1.0] - 2026-10-26

### Added

- Initial public release.
- SoCLaaS OpenAI-compatible provider registration.
- Live model discovery from `GET /v1/models` with a 60-second cache.
- Vendor metadata projection for display names, context limits, pricing, input
  modalities, and reasoning support.
- Last-known-good catalog fallback and a cold-start seed model.
- Automatic `soclaas/default` selection during authentication when no primary
  model is configured.
- Gateway `default` alias support with all other aliases filtered out.

### Notes

- Thinking is inherited. `soclaas/default` currently advertises no reasoning
  support, so thinking remains off for that model.
- No runtime dependencies and no build step.
