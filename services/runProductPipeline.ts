import { discoverProductSources } from "./discoveryService.ts";
import { crawlPage } from "./crawlService.ts";
import { extractFromHtml } from "./extractService.ts";
import { normalizeProducts } from "./normalizeProduct.ts";
import { synthesizeProductContent } from "./synthesizeService.ts";
import { buildSynthesisInput } from "./buildSynthesisInput.ts";

export async function runProductPipeline(input: {
  mpn: string;
  manufacturer: string;
}) {
  const { mpn, manufacturer } = input;

  const result: any = {
    mpn,
    manufacturer,
    discovery: null,
    crawl: null,
    extraction: null,
    synthesis: null,
    final: null
  };

  // 1. DISCOVERY
  const discovery = await discoverProductSources(mpn, manufacturer);
  result.discovery = discovery;

  if (!discovery.primaryProductUrl && discovery.backupUrls.length === 0) {
    result.final = {
      usable: false,
      confidence: 0,
      reason: "No discoverable product URLs"
    };
    return result;
  }

  // 2. CRAWL (primary, then backups)
  let crawl;
  const urlsToTry = [
    discovery.primaryProductUrl,
    ...(discovery.backupUrls || [])
  ].filter(Boolean);

  for (const url of urlsToTry.slice(0, 3)) {
    crawl = await crawlPage(url);
    if (crawl?.html) break;
  }

  if (!crawl || !crawl.html) {
    result.final = {
      usable: false,
      confidence: 0,
      reason: "Failed to crawl any product page"
    };
    return result;
  }

  result.crawl = crawl;

  // 3. EXTRACT
  const extraction = extractFromHtml({
    html: crawl.html,
    sourceUrl: crawl.finalUrl || crawl.url,
    mpn,
    manufacturer
  });

  result.extraction = {
    ok: extraction.ok,
    qualityScore: extraction.qualityScore,
    specsCount: extraction.specs?.length || 0,
    imagesCount: extraction.images?.length || 0,
    datasheetsCount: extraction.datasheets?.length || 0,
    images: extraction.images || [],
    datasheets: extraction.datasheets || [],
    sourceUrl: crawl.finalUrl || crawl.url
  };

  if (!extraction.ok || (extraction.qualityScore ?? 0) < 0.3) {
    result.final = {
      usable: false,
      confidence: extraction.qualityScore ?? 0,
      reason: "Extraction quality too low"
    };
    return result;
  }

  // 4. NORMALIZE
  const normalized = normalizeProducts([
    {
      sourceType: "distributor",
      confidence: extraction.qualityScore ?? 0,

      ...extraction,

      images: (extraction.images ?? []).map((img: string) => ({
        url: img
      }))
    }
  ]);

  // 5. SYNTHESIZE
  const synthesisInput = buildSynthesisInput(normalized);
  const synthesis = await synthesizeProductContent(synthesisInput);

  result.synthesis = synthesis;

  // 6. FINAL CONFIDENCE
  const discoveryConfidence =
    discovery.confidence === "high" ? 0.9 :
    discovery.confidence === "medium" ? 0.6 : 0.3;

  const crawlConfidence =
    crawl.usedPlaywright ? 0.6 : 0.85;

  const extractionConfidence = extraction.qualityScore ?? 0;
  const synthesisConfidence = synthesis._confidence ?? 0;

  const finalConfidence =
    0.25 * discoveryConfidence +
    0.20 * crawlConfidence +
    0.30 * extractionConfidence +
    0.25 * synthesisConfidence;

  result.final = {
    usable: finalConfidence >= 0.65,
    confidence: Number(finalConfidence.toFixed(2)),
    images: extraction.images || [],
    datasheets: extraction.datasheets || [],
    sourceUrl: crawl.finalUrl || crawl.url
  };

  return result;
}