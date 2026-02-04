// services/discoveryService.ts
import "dotenv/config";
import fetch from "node-fetch";


const SERPER_ENDPOINT = "https://google.serper.dev/search";
const SERPER_API_KEY = process.env.SERPER_API_KEY;

if (!SERPER_API_KEY) {
  throw new Error("SERPER_API_KEY not set in environment");
}

/* -----------------------------
   Types
----------------------------- */

export interface DiscoveryResult {
  primaryProductUrl: string | null;
  backupUrls: string[];
  pdfUrls: string[];
  confidence: "high" | "medium" | "low";
}

interface SerperResult {
  link: string;
  title?: string;
  snippet?: string;
}

/* -----------------------------
   Public API
----------------------------- */

export async function discoverProductSources(
  mpn: string,
  manufacturer: string
): Promise<DiscoveryResult> {
  // 1. First (and usually only) query
  const results = await runSerperQuery(`"${mpn}" "${manufacturer}"`);

  const scored = scoreResults(results, mpn, manufacturer);

  // Select the top-scoring result as primary, if any
  const primary = scored.length > 0 ? scored[0] : null;
  const backups = scored
    .filter(r => r.url !== primary?.url)
    .slice(0, 3)
    .map(r => r.url);

  const pdfs = scored
    .filter(r => r.url.toLowerCase().endsWith(".pdf"))
    .map(r => r.url);

  // 2. If we failed to find anything solid, try a PDF fallback
  if (!primary) {
    const pdfResults = await runSerperQuery(`"${mpn}" datasheet pdf`);
    const pdfOnly = scoreResults(pdfResults, mpn, manufacturer)
      .filter(r => r.url.toLowerCase().endsWith(".pdf"))
      .map(r => r.url);

    return {
      primaryProductUrl: null,
      backupUrls: [],
      pdfUrls: pdfOnly.slice(0, 3),
      confidence: pdfOnly.length > 0 ? "medium" : "low"
    };
  }

  return {
    primaryProductUrl: primary.url,
    backupUrls: backups,
    pdfUrls: pdfs.slice(0, 3),
    confidence: (() => {
      const second = scored[1];
      if (!second) return "high";

      const separation = primary.score - second.score;

      // MVP-calibrated confidence mapping
      if (separation > 0.15) return "high";
      if (separation > 0.05) return "medium";
      return "low";
    })()
  };
}

/* -----------------------------
   Serper Query
----------------------------- */

async function runSerperQuery(query: string): Promise<SerperResult[]> {
  const response = await fetch(SERPER_ENDPOINT, {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q: query,
      num: 10
    })
  });

  if (!response.ok) {
    throw new Error(`Serper error: ${response.status}`);
  }

  const data: any = await response.json();

  // Robust parsing: support multiple Serper response shapes
  const organic = Array.isArray(data.organic)
    ? data.organic
    : Array.isArray(data.results)
      ? data.results
      : [];

  return organic.map((r: any) => ({
    link: r.link || r.url || "",
    title: r.title || "",
    snippet: r.snippet || r.description || ""
  }));
}

/* -----------------------------
   Scoring Logic (Deterministic)
----------------------------- */

function scoreResults(
  results: SerperResult[],
  mpn: string,
  manufacturer: string
) {
  const mpnLower = mpn.toLowerCase();
  const mfgLower = manufacturer.toLowerCase();

  // Feature extraction for each result
  const features = results.map(r => {
    const url = r.link.toLowerCase();
    const title = (r.title || "").toLowerCase();
    const snippet = (r.snippet || "").toLowerCase();
    return {
      url: r.link,
      mpnInUrl: url.includes(mpnLower) ? 1 : 0,
      mpnInTitle: title.includes(mpnLower) ? 1 : 0,
      mfgInText: (title.includes(mfgLower) || snippet.includes(mfgLower)) ? 1 : 0,
      productPath: (url.includes("/product") || url.includes("/products/")) ? 1 : 0,
      domainTrust: bootstrapDomainTrust(extractDomain(url)),
      junkPath: (url.includes("/search") || url.includes("?q=") || isBlogOrForum(url)) ? 1 : 0
    };
  });

  // Compute means for standardization
  const means = {
    mpnInUrl: features.reduce((sum, f) => sum + f.mpnInUrl, 0) / (features.length || 1),
    mpnInTitle: features.reduce((sum, f) => sum + f.mpnInTitle, 0) / (features.length || 1),
    mfgInText: features.reduce((sum, f) => sum + f.mfgInText, 0) / (features.length || 1),
    productPath: features.reduce((sum, f) => sum + f.productPath, 0) / (features.length || 1),
    domainTrust: features.reduce((sum, f) => sum + f.domainTrust, 0) / (features.length || 1),
    junkPath: features.reduce((sum, f) => sum + f.junkPath, 0) / (features.length || 1)
  };

  return features
    .map(f => {
      // Standardized features (mean-centering)
      const x = [
        f.mpnInUrl - means.mpnInUrl,
        f.mpnInTitle - means.mpnInTitle,
        f.mfgInText - means.mfgInText,
        f.productPath - means.productPath,
        f.domainTrust - means.domainTrust,
        f.junkPath - means.junkPath
      ];

      // Learned-like weights (can later be trained offline)
      const weights = [4.2, 3.4, 2.6, 2.0, 1.6, -3.8];
      const bias = 0.0;

      // Linear model
      let linear = bias;
      for (let i = 0; i < x.length; i++) {
        linear += weights[i] * x[i];
      }

      // Logistic squashing (scikit-learn–style)
      const score = 1 / (1 + Math.exp(-linear));

      // TODO: log { domain: extractDomain(f.url), score } for domain trust learning

      return { url: f.url, score };
    })
    .sort((a, b) => b.score - a.score);
}

/* -----------------------------
   Domain Helpers
----------------------------- */

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function bootstrapDomainTrust(domain: string): number {
  if (!domain) return 0.0;

  // Strong negatives
  if (domain.includes("forum") || domain.includes("reddit")) return -0.7;
  if (domain.includes("blog")) return -0.6;
  if (domain.includes("viewer")) return -0.4;
  if (domain.includes("datasheet")) return -0.3;

  // Strong positives (major distributors)
  if (domain.includes("digikey")) return 0.9;
  if (domain.includes("mouser")) return 0.9;
  if (domain.includes("tti")) return 0.9;
  if (domain.includes("rs-online") || domain.includes("rs-components")) return 0.9;
  if (domain.includes("farnell") || domain.includes("newark")) return 0.9;

  // Manufacturer-like domains
  if (domain.split(".").length === 2) return 0.4;

  // Neutral default
  return 0.0;
}

function isBlogOrForum(url: string): boolean {
  return (
    url.includes("blog") ||
    url.includes("forum") ||
    url.includes("reddit") ||
    url.includes("stackexchange")
  );
}