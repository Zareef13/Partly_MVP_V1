// services/buildSynthesisInput.ts
import type { NormalizedProduct } from "./normalizeProduct.ts";
import type { SynthesisInput } from "./synthesizeService.ts";

/**
 * Adapter between normalization and synthesis.
 * Strips metadata and passes only grounded facts to the LLM.
 */
export function buildSynthesisInput(
  normalized: NormalizedProduct
): SynthesisInput {
  return {
    mpn: normalized.mpn,
    manufacturer: normalized.manufacturer,
    canonicalTitle: normalized.canonicalTitle,

    // IMPORTANT:
    // Synthesis only receives factual strings, no confidence, no sources
    specs: Object.fromEntries(
      Object.entries(normalized.specs).map(([key, spec]) => [
        key,
        spec.value
      ])
    ),

    images: normalized.images.map(img => img.url),

    datasheets: normalized.datasheets.map(ds => ({
      url: ds.url,
      label: ds.label
    })),

    // Verbatim sections help grounding without adding inference
    verbatimDescriptors: normalized.verbatimSections.map(v => v.text)
  };
}