// Live model projection for SoCLaaS.
//
// The generic OpenClaw projector ignores the gateway's vendor `soclaas` block,
// which contains:
//   - display_name: human-readable model label
//   - *_microdollars_per_million_tokens: per-million-token pricing
//   - input_modalities: text, image, and document support
//
// Applying the projection here also keeps admission rules (no aliases except
// the gateway's stable default alias, no non-chat rows) in one place.
//
// `capabilities` describes endpoints (chat, embeddings, audio-transcription),
// not modalities. Do not treat it as a vision flag; prefer input_modalities
// when present.

import { DEFAULT_MODEL_ID } from "./defaults.js";

const MICRO = 1_000_000;

// OpenClaw's model catalog accepts text / image / document as input modes.
// SoCLaaS may use file/pdf for documents.
const INPUT_ALIASES = new Map([
  ["text", "text"],
  ["image", "image"],
  ["vision", "image"],
  ["document", "document"],
  ["file", "document"],
  ["pdf", "document"],
]);

function num(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function firstString(record, keys) {
  for (const k of keys) {
    const v = record?.[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}

function microToPrice(meta, key) {
  const raw = num(meta?.[key]);
  return raw === undefined ? 0 : raw / MICRO;
}

function isChatCapable(meta) {
  const caps = meta?.capabilities;
  if (!Array.isArray(caps) || caps.length === 0) return true; // fail-open
  return caps.includes("chat");
}

function isAlias(meta) {
  return Boolean(meta?.alias_of);
}

function normalizeInputModalities(value) {
  if (!Array.isArray(value)) return undefined;
  const tokens = value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  // Treat an empty array as "not declared" so the legacy heuristics still run.
  if (tokens.length === 0) return undefined;

  const normalized = [];
  for (const token of tokens) {
    const mapped = INPUT_ALIASES.get(token);
    if (mapped && !normalized.includes(mapped)) normalized.push(mapped);
  }

  // Chat models always accept text; keep it first and deduplicate.
  return ["text", ...normalized.filter((mode) => mode !== "text")];
}

// Vendor-block declaration wins over a top-level one; both snake_case and
// camelCase are accepted so the upstream shape can evolve without breaking us.
function readInputModalities(row, meta) {
  return (
    normalizeInputModalities(meta?.input_modalities) ??
    normalizeInputModalities(meta?.inputModalities) ??
    normalizeInputModalities(row?.input_modalities) ??
    normalizeInputModalities(row?.inputModalities)
  );
}

function projectRow(row, fallback) {
  if (!row || typeof row !== "object") return undefined;

  const meta = row.soclaas && typeof row.soclaas === "object" ? row.soclaas : undefined;

  const id = firstString(row, ["id", "model", "model_name", "modelName"]);
  if (!id) return undefined;

  // The gateway intentionally exposes `default` as a stable alias to whatever
  // model it currently considers its default. Keep that alias while filtering
  // every other alias from the catalog.
  if (isAlias(meta) && id !== DEFAULT_MODEL_ID) return undefined;
  if (!isChatCapable(meta)) return undefined;

  // Reject ids that would break model-ref parsing.
  if (!/^[A-Za-z0-9._:@/-]+$/.test(id)) return undefined;

  const known = fallback.models.find((m) => m.id === id);

  const contextWindow =
    num(row.context_window) ??
    num(row.context_length) ??
    num(row.max_context_length) ??
    num(row.max_model_len) ??
    known?.contextWindow ??
    65536;

  const maxTokens = num(row.max_completion_tokens) ?? known?.maxTokens ?? 16384;

  // display_name is the gateway's human-readable label; fall back to the id.
  const name = firstString(meta, ["display_name", "displayName"]) ?? known?.name ?? id;

  // Prefer the structured declaration. Fall back to the legacy heuristics so
  // older gateways keep working until they emit input_modalities.
  const declaredInput = readInputModalities(row, meta);
  const caps = Array.isArray(meta?.capabilities) ? meta.capabilities : [];
  const vision =
    caps.includes("vision") ||
    /(^|[-:_])vl([:-]|$)/i.test(id) ||
    (known?.input ?? []).includes("image");

  const input = declaredInput ?? (vision ? ["text", "image"] : ["text"]);

  const cost = {
    input: microToPrice(meta, "input_microdollars_per_million_tokens"),
    output: microToPrice(meta, "output_microdollars_per_million_tokens"),
    cacheRead: microToPrice(meta, "cache_read_microdollars_per_million_tokens"),
    cacheWrite: microToPrice(meta, "cache_write_microdollars_per_million_tokens"),
  };

  // Reasoning: prefer what the live row advertises, and only fall back to the
  // seed's hint. This keeps a conservative placeholder seed from suppressing
  // real capability on a discovered row.
  const liveReasoning =
    typeof meta?.reasoning === "boolean" ? meta.reasoning : undefined;
  const featureNames = Array.isArray(row.supported_parameters)
    ? row.supported_parameters
    : [];
  const inferredReasoning = featureNames.some((f) => /reason|think/i.test(String(f)));
  const fallbackReasoning =
    featureNames.length > 0 ? inferredReasoning : known?.reasoning ?? false;

  return {
    id,
    name,
    reasoning: liveReasoning ?? fallbackReasoning,
    input,
    cost,
    contextWindow,
    maxTokens,
    ...known?.compat ? { compat: known.compat } : {},
    ...known?.thinkingLevelMap ? { thinkingLevelMap: known.thinkingLevelMap } : {},
  };
}

export function projectSoCLaaSRows(rows, fallback) {
  if (!Array.isArray(rows)) return [];
  const projected = rows.map((row) => projectRow(row, fallback)).filter(Boolean);
  const deduped = new Map(projected.map((m) => [m.id, m]));
  return [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id));
}
