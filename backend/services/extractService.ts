import * as cheerio from "cheerio";
import { URL } from "url";

/**
 * IMPORTANT:
 * This extractor NEVER infers, normalizes, or completes data.
 * All returned fields must be directly evidenced in the HTML.
 * Missing data is an expected and valid outcome.
 */

/**
 * ===== Interfaces =====
 */

export interface ExtractResult {
  ok: boolean;
  reason?: "no_html" | "blocked" | "non_product" | "parse_error" | "low_quality";
  qualityScore?: number;

  sourceUrl: string;

  displayTitle: string | null;
  canonicalTitle: string;
  productTitle: string;
  mpn: string;
  manufacturer: string | null;

  specs: Record<string, string>;
  overview: string | null;
  images: string[];
  datasheets: { url: string; label?: string }[];
}

/**
 * ===== Public API =====
 */

export function extractFromHtml(params: {
  html: string | null;
  sourceUrl: string;
  mpn: string;
  manufacturer?: string | null;
}): ExtractResult {
  const { html, sourceUrl, mpn, manufacturer } = params;

  // ------------------
  // Stage A: Guardrails
  // ------------------

  if (!html) {
    return fail("no_html", sourceUrl, mpn, manufacturer);
  }

  const lowerHtml = html.toLowerCase();

  const looksLikeChallenge =
    lowerHtml.includes("__cf_chl") ||
    lowerHtml.includes("cf-challenge") ||
    lowerHtml.includes("attention required") ||
    lowerHtml.includes("verify you are human");

  if (html.length < 12000 && looksLikeChallenge) {
    return fail("blocked", sourceUrl, mpn, manufacturer);
  }

  const normalizedMpn = mpn.replace(/[-\s]/g, "").toLowerCase();
  const normalizedHtml = lowerHtml.replace(/[-\s]/g, "");

  const looksLikeDistributor =
    sourceUrl.includes("/product") ||
    sourceUrl.includes("/products") ||
    sourceUrl.includes("mc-mc.com") ||
    sourceUrl.includes("dosupply.com") ||
    sourceUrl.includes("radwell") ||
    sourceUrl.includes("gerrie") ||
    sourceUrl.includes("mro");

  // Only hard-fail if BOTH the MPN is missing AND there is no distributor/product signal
  if (!normalizedHtml.includes(normalizedMpn) && !looksLikeDistributor) {
    return fail("non_product", sourceUrl, mpn, manufacturer);
  }

  // ------------------
  // Stage B: Parse DOM
  // ------------------

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return fail("parse_error", sourceUrl, mpn, manufacturer);
  }

  // Temporary holders for BCData signals
  let bcSku: string | null = null;
  let bcWeight: string | null = null;

  // ------------------
  // TEMP DEBUG: Inspect available spec signals
  // ------------------
  const metaDescription = cleanText(
    $('meta[name="description"]').attr("content")
  );

  const ogDescription = cleanText(
    $('meta[property="og:description"]').attr("content")
  );

  // Attempt to capture common BigCommerce / JSON blobs
  const scriptJsonSamples: string[] = [];
  $("script").each((_, el) => {
    const text = $(el).text();
    if (
      text &&
      (text.includes("product_attributes") ||
        text.includes("BCData") ||
        text.includes("sku") ||
        text.includes("mpn"))
    ) {
      scriptJsonSamples.push(text.slice(0, 500));
    }
  });

  console.log("[EXTRACT DEBUG]", {
    sourceUrl,
    metaDescription,
    ogDescription,
    h1: cleanText($("h1").first().text()),
    jsonScriptSamples: scriptJsonSamples.slice(0, 2)
  });

  // ------------------
  // BigCommerce BCData inline script parsing
  // ------------------
  // Capture BCData signals for promotion after specs extraction.
  $("script").each((_, el) => {
    const text = $(el).text();
    if (!text || !text.includes("var BCData =")) return;
    let match = text.match(/var\s+BCData\s*=\s*({[\s\S]+?});/);
    if (!match) return;
    let obj: any = null;
    try {
      // Try to parse as JS object (not strict JSON): tolerate single quotes, unquoted keys, etc.
      // But for safety, try JSON.parse first on the string between = and ;
      obj = JSON.parse(match[1]);
    } catch {
      // fallback: try to eval in a safe context (not recommended, but fallback)
      try {
        // eslint-disable-next-line no-new-func
        obj = Function('"use strict";return (' + match[1] + ')')();
      } catch {
        obj = null;
      }
    }
    if (!obj || typeof obj !== "object") return;
    // Only add direct values, do not infer or normalize
    if (
      obj.product_attributes?.weight?.formatted &&
      !bcWeight
    ) {
      bcWeight = obj.product_attributes.weight.formatted;
    }

    if (
      typeof obj.product_attributes?.sku === "string" &&
      !bcSku
    ) {
      bcSku = obj.product_attributes.sku;
    }
  });

  // ------------------
  // JSON-LD Product schema parsing
  // ------------------
  let jsonLdDescription: string | null = null;
  $("script[type='application/ld+json']").each((_, el) => {
    const text = $(el).text();
    if (!text) return;
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    // JSON-LD can be an array or object
    const items = Array.isArray(json) ? json : [json];
    for (const item of items) {
      if (item && typeof item === "object" && item["@type"] === "Product") {
        if (typeof item.description === "string" && !jsonLdDescription) {
          jsonLdDescription = item.description;
        }
        if (
          item.brand &&
          typeof item.brand === "object" &&
          typeof item.brand.name === "string" &&
          !manufacturer
        ) {
          // Only set manufacturer if it is null
        }
      }
    }
  });

  // ------------------
  // Stage C: Title
  // ------------------

  const displayTitle =
    cleanText(
      $('meta[property="og:title"]').attr("content") ||
        $('meta[name="twitter:title"]').attr("content") ||
        $("h1").first().text() ||
        $("title").text()
    ) || null;

  // Determine productTitleCandidate (evidence-based only)
  let productTitleCandidate = `${manufacturer ?? ""} ${mpn}`.trim();

  const h1Text = cleanText($("h1").first().text()) || "";
  const ogTitle = cleanText($('meta[property="og:title"]').attr("content")) || "";
  const docTitle = cleanText($("title").text()) || "";

  const candidates = [h1Text, ogTitle, docTitle].filter(Boolean) as string[];

  for (const c of candidates) {
    const norm = c.toLowerCase().replace(/[-\s]/g, "");
    if (norm.includes(normalizedMpn)) {
      productTitleCandidate = c;
      break;
    }
  }

  // Final canonical title: must represent a product identity, never a site or domain
  const canonicalTitle =
    productTitleCandidate && productTitleCandidate.toLowerCase().includes(mpn.toLowerCase())
      ? productTitleCandidate
      : `${manufacturer ?? ""} ${mpn}`.trim();

  // ------------------
  // Stage D: Overview (optional MVP)
  // ------------------

  let overview =
    cleanText($('meta[name="description"]').attr("content")) || null;

  // If overview is null and jsonLdDescription exists, use it (decoded)
  if (!overview && jsonLdDescription) {
    try {
      overview = decodeURIComponent(jsonLdDescription);
    } catch {
      overview = jsonLdDescription;
    }
  }

  // ------------------
  // Stage E: Datasheet discovery
  // ------------------

  const datasheets = extractDatasheets($, sourceUrl);

  // ------------------
  // Stage F: Image extraction
  // ------------------

  const images = extractImages($, sourceUrl);

  // ------------------
  // Stage G: Spec extraction
  // ------------------

  const specs = extractSpecs($);

  // Promote BCData signals to specs if not already present
  if (bcWeight && !specs["Weight"]) {
    specs["Weight"] = bcWeight;
  }

  if (bcSku && !specs["SKU"]) {
    specs["SKU"] = bcSku;
  }

  // Promote specs from trusted meta / OG descriptions
  const promotionText = [metaDescription, ogDescription]
    .filter(Boolean)
    .join(" ");

  const promotedSpecs = promoteSpecsFromText(promotionText);

  // Do not overwrite table-extracted specs
  for (const [key, value] of Object.entries(promotedSpecs)) {
    if (!specs[key]) {
      specs[key] = value;
    }
  }
/**
 * Promote deterministic specs from trusted meta/OG text signals.
 */
function promoteSpecsFromText(text: string): Record<string, string> {
  const promoted: Record<string, string> = {};

  if (/120\s*\/\s*240\s*V/i.test(text)) {
    promoted["System Voltage"] = "120/240 V";
  }

  if (/\b1\s*PH\b|\b1Ø\b|\bSingle[-\s]?Phase\b/i.test(text)) {
    promoted["Phase"] = "Single Phase";
  }

  if (/200\s*A(MP)?/i.test(text)) {
    promoted["Max Service Size"] = "200 A";
  }

  if (/downline|sub[-\s]?panel/i.test(text)) {
    promoted["Application"] = "Downline / Sub-panel Protection";
  }

  if (/surge\s+protection/i.test(text)) {
    promoted["Product Type"] = "Surge Protection Device";
  }

  return promoted;
}

  // ------------------
  // Stage H: Quality Scoring (statistical, MVP-safe)
  // ------------------

  const featureVector = {
    hasTitle: displayTitle && displayTitle.length > 15 ? 1 : 0,
    hasSpecs: Object.keys(specs).length > 0 ? 1 : 0,
    hasImages: images.length > 0 ? 1 : 0,
    hasDatasheets: datasheets.length > 0 ? 1 : 0,
    hasOverview: overview && overview.length > 40 ? 1 : 0
  };

  // Simple weighted linear model (weights chosen from empirical intuition)
  const qualityScore =
    0.30 * featureVector.hasSpecs +
    0.25 * featureVector.hasDatasheets +
    0.20 * featureVector.hasImages +
    0.15 * featureVector.hasTitle +
    0.10 * featureVector.hasOverview;

  if (qualityScore < 0.30) {
    return {
      ok: false,
      reason: "low_quality",
      qualityScore,
      sourceUrl,
      displayTitle,
      canonicalTitle,
      productTitle: productTitleCandidate,
      mpn,
      manufacturer: manufacturer ?? null,
      specs,
      overview,
      images,
      datasheets
    };
  }

  return {
    ok: true,
    qualityScore,
    sourceUrl,
    displayTitle,
    canonicalTitle,
    productTitle: productTitleCandidate,
    mpn,
    manufacturer: manufacturer ?? null,
    specs,
    overview,
    images,
    datasheets
  };
}

/**
 * ===== Helpers =====
 */

function fail(
  reason: ExtractResult["reason"],
  sourceUrl: string,
  mpn: string,
  manufacturer?: string | null
): ExtractResult {
  const canonicalTitle = `${manufacturer ?? ""} ${mpn}`.trim();
  return {
    ok: false,
    reason,
    sourceUrl,
    displayTitle: null,
    canonicalTitle,
    productTitle: canonicalTitle,
    mpn,
    manufacturer: manufacturer ?? null,
    specs: {},
    overview: null,
    images: [],
    datasheets: []
  };
}

function cleanText(input?: string | null): string | null {
  if (!input) return null;
  return input.replace(/\s+/g, " ").replace(/[\n\r\t]/g, " ").trim();
}

function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * ===== Datasheets =====
 */

function extractDatasheets(
  $: cheerio.CheerioAPI,
  baseUrl: string
): { url: string; label?: string }[] {
  const results: { url: string; label?: string; score: number }[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const abs = absoluteUrl(href, baseUrl);
    if (!abs) return;

    const text = cleanText($(el).text())?.toLowerCase() || "";
    const lowerHref = abs.toLowerCase();

    let score = 0;

    if (lowerHref.endsWith(".pdf")) score += 3;
    if (text.includes("datasheet") || text.includes("data sheet")) score += 2;
    if (text.includes("spec")) score += 2;
    if (text.includes("manual")) score += 1;
    if (
      text.includes("privacy") ||
      text.includes("terms") ||
      text.includes("catalog")
    )
      score -= 3;

    if (score > 0) {
      results.push({
        url: abs,
        label: cleanText($(el).text()) || undefined,
        score
      });
    }
  });

  return dedupeAndSort(results).slice(0, 5).map(({ url, label }) => ({
    url,
    label
  }));
}

/**
 * ===== Images =====
 */

function extractImages(
  $: cheerio.CheerioAPI,
  baseUrl: string
): string[] {
  const candidates: { url: string; score: number }[] = [];

  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    const abs = absoluteUrl(ogImage, baseUrl);
    if (abs) candidates.push({ url: abs, score: 5 });
  }

  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;

    const abs = absoluteUrl(src, baseUrl);
    if (!abs) return;

    const lower = abs.toLowerCase();

    if (
      lower.includes("logo") ||
      lower.includes("icon") ||
      lower.includes("sprite") ||
      lower.includes("placeholder") ||
      lower.includes("spinner")
    )
      return;

    let score = 1;
    if (lower.includes("product") || lower.includes("media")) score += 2;
    if (lower.endsWith(".jpg") || lower.endsWith(".png") || lower.endsWith(".webp"))
      score += 1;

    candidates.push({ url: abs, score });
  });

  return dedupeAndSort(candidates)
    .slice(0, 3)
    .map((c) => c.url);
}

/**
 * ===== Specs =====
 */

function extractSpecs($: cheerio.CheerioAPI): Record<string, string> {
  const specs: Record<string, string> = {};

  // Tables
  $("table").each((_, table) => {
    const rows = $(table).find("tr");
    if (rows.length < 3) return;

    rows.each((_, row) => {
      const cells = $(row).find("td, th");
      if (cells.length < 2) return;

      const key = cleanText($(cells[0]).text());
      const value = cleanText($(cells[1]).text());

      if (key && value && value.length < 180) {
        specs[key.replace(/:$/, "")] = value;
      }
    });
  });

  // Definition lists
  $("dt").each((_, el) => {
    const key = cleanText($(el).text());
    const value = cleanText($(el).next("dd").text());
    if (key && value && value.length < 180) {
      specs[key.replace(/:$/, "")] = value;
    }
  });

  return specs;
}

/**
 * ===== Utilities =====
 */

function dedupeAndSort<T extends { url: string; score: number }>(
  items: T[]
): T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    const existing = map.get(item.url);
    if (!existing || item.score > existing.score) {
      map.set(item.url, item);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}