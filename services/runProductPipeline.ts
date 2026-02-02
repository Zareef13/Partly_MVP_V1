import { discoverProductSources } from "./discoveryService.js";
import { crawlPage } from "./crawlService.js";
import { extractFromHtml } from "./extractService.js";
import { normalizeProducts } from "./normalizeProduct.js";
import { synthesizeProductContent } from "./synthesizeService.js";
import { buildSynthesisInput } from "./buildSynthesisInput.js";

export async function runProductPipeline(input: {
  mpn: string;
  manufacturer: string;
}) {
  const { mpn, manufacturer } = input;
  const canonicalMpn = mpn.replace(/[–—\s]+/g, "-").toUpperCase();

  const result: any = {
    mpn: canonicalMpn,
    manufacturer,
    discovery: null,
    crawl: null,
    extraction: null,
    synthesis: null,
    final: null
  };

  // 1. DISCOVERY
  const discovery = await discoverProductSources(canonicalMpn, manufacturer);
  result.discovery = discovery;

  if (!discovery.primaryProductUrl && discovery.backupUrls.length === 0) {
    result.final = {
      usable: false,
      confidence: 0,
      failureReason: "NO_PRODUCT_URLS"
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
      failureReason: "CRAWL_FAILED"
    };
    return result;
  }

  result.crawl = crawl;

  // 3. EXTRACT
  const extraction = extractFromHtml({
    html: crawl.html,
    sourceUrl: crawl.finalUrl,
    mpn: canonicalMpn,
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
    sourceUrl: crawl.finalUrl 
  };

  if (!extraction.ok || (extraction.qualityScore ?? 0) < 0.3) {
    result.final = {
      usable: false,
      confidence: extraction.qualityScore ?? 0,
      failureReason: "LOW_EXTRACTION_QUALITY"
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


  const specTable =
  synthesis?.keyFeatures?.map((f: string) => {
    const idx = f.indexOf(":");
    if (idx === -1) return null;

    return {
      name: f.slice(0, idx).trim(),
      value: f.slice(idx + 1).trim()
    };
  }).filter(Boolean) ?? [];

  result.final = {
    ...synthesis,
    specTable,
    confidenceBreakdown: {
      discovery: discoveryConfidence,
      crawl: crawlConfidence,
      extraction: extractionConfidence,
      synthesis: synthesisConfidence
    },
    productType: (() => {
      if (!synthesis) return null;
      const text = `${synthesis.displayTitle ?? ""} ${synthesis.overview ?? ""}`.toLowerCase();
      if (text.includes("surge")) return "Surge Protection Device";
      if (text.includes("power supply")) return "Power Supply";
      if (text.includes("battery")) return "Battery";
      if (text.includes("relay")) return "Relay";
      return null;
    })(),
    usable: finalConfidence >= 0.65,
    confidence: Number(finalConfidence.toFixed(2)),
    images: extraction.images || [],
    datasheets: extraction.datasheets || [],
    sourceUrl: crawl.finalUrl
  };

  return result;
}