# Changelog

All notable changes to this project are documented in this file.

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
