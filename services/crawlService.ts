// services/crawlService.ts
import fetch from "node-fetch";
import { chromium } from "playwright";

const FETCH_TIMEOUT_MS = 10_000;


export interface CrawlResult {
  finalUrl: string;
  html: string | null;
  usedPlaywright: boolean;
  contentType?: string | null;
  fallbackReason?: "fetch_failed" | "invalid_html" | "non_product" | "captcha_or_js";
  crawlConfidence?: "high" | "medium" | "low";
}

async function tryFetchOnce(url: string): Promise<{ html: string; finalUrl: string; contentType: string | null } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PartlyBot/1.0; +https://partly.ai)"
      }
    });

    const contentType = res.headers.get("content-type");

    if (res.ok) {
      const html = await res.text();
      if (isValidHtml(html)) {
        return { html, finalUrl: res.url, contentType };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function crawlPage(url: string): Promise<CrawlResult> {
  // Try fast fetch twice for the original URL only
  let fallbackReason: CrawlResult["fallbackReason"] | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const tryResult = await tryFetchOnce(url);
    if (!tryResult) {
      fallbackReason = "fetch_failed";
      continue;
    }
    if (!looksLikeProductPage(tryResult.html)) {
      fallbackReason = "non_product";
      continue;
    }
    if (!hasUsableProductSignals(tryResult.html)) {
      fallbackReason = "non_product";
      continue;
    }
    // All checks passed, return success
    return {
      finalUrl: tryResult.finalUrl,
      html: tryResult.html,
      usedPlaywright: false,
      contentType: tryResult.contentType,
      crawlConfidence: "high"
    };
  }

  // Playwright fallback after fast fetch is incomplete
  return await crawlWithPlaywright(url, fallbackReason);
}

function isValidHtml(html: string): boolean {
  if (!html) return false;
  if (html.length < 1000) return false;
  if (html.toLowerCase().includes("enable javascript")) return false;
  if (html.toLowerCase().includes("captcha")) return false;
  return true;
}

function isHomepageLike(html: string): boolean {
  const lower = html.toLowerCase();

  const navHeavy =
    (lower.match(/<nav/g)?.length ?? 0) >= 2 ||
    (lower.match(/class="nav/g)?.length ?? 0) >= 2;

  const productGridSignals =
    lower.includes("featured products") ||
    lower.includes("categories") ||
    lower.includes("shop by") ||
    lower.includes("our products");

  const multipleCards =
    (lower.match(/product-card/g)?.length ?? 0) >= 3;

  return navHeavy && (productGridSignals || multipleCards);
}

function looksLikeProductPage(html: string): boolean {
  if (isHomepageLike(html)) return false;

  const lower = html.toLowerCase();

  const hasTitle =
    /<h1[^>]*>/.test(lower) || /<title>/.test(lower);

  const hasSpecs =
    lower.includes("specification") ||
    lower.includes("technical data") ||
    lower.includes("<table") ||
    lower.includes("<dl");

  const hasDatasheet =
    lower.includes(".pdf") &&
    (lower.includes("datasheet") || lower.includes("download"));

  return hasTitle && (hasSpecs || hasDatasheet);
}

function hasUsableProductSignals(html: string): boolean {
  if (!html) return false;
  const lower = html.toLowerCase();

  const textDensityOk = html.length > 8000;

  const hasSpecTable =
    lower.includes("<table") || lower.includes("<dl");

  const hasDatasheet =
    lower.includes(".pdf") &&
    (lower.includes("datasheet") || lower.includes("manual"));

  const repeatedMpn =
    (lower.match(/\b[0-9a-z\-]{6,}\b/g)?.length ?? 0) >= 5;

  const strongSignal = hasSpecTable || hasDatasheet || repeatedMpn;

  return textDensityOk && strongSignal;
}

async function crawlWithPlaywright(
  url: string,
  fallbackReason?: CrawlResult["fallbackReason"]
): Promise<CrawlResult> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });

    const html = await page.content();
    const finalUrl = page.url();

    // If JS rendered but still no usable product signals, treat as low confidence
    if (!hasUsableProductSignals(html)) {
      return {
        finalUrl,
        html,
        usedPlaywright: true,
        contentType: "text/html",
        fallbackReason: "non_product",
        crawlConfidence: "low"
      };
    }

    return {
      finalUrl,
      html,
      usedPlaywright: true,
      contentType: "text/html",
      fallbackReason,
      crawlConfidence: hasUsableProductSignals(html) ? "medium" : "low"
    };
  } catch {
    return {
      finalUrl: url,
      html: null,
      usedPlaywright: true,
      contentType: null,
      fallbackReason: fallbackReason ?? "captcha_or_js",
      crawlConfidence: "low"
    };
  } finally {
    await browser.close();
  }
}