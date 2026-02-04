import fs from "fs";
import path from "path";
// services/normalizeProduct.ts

export interface ExtractedProduct {
  mpn: string;
  manufacturer: string;
  sourceUrl: string;
  sourceType: "oem" | "distributor" | "pdf" | "unknown" | "datasheet";
  confidence: number; // 0–1

  canonicalTitle?: string;
  displayTitle?: string;

  specs: Record<string, string>;

  verbatimSections?: {
    heading?: string;
    text: string;
    source?: string;
  }[];

  images?: {
    url: string;
    alt?: string;
  }[];

  datasheets?: {
    url: string;
    label?: string;
  }[];

  rawDatasheet?: any; // raw-first parsed datasheet JSON blocks
}

export interface NormalizedProduct {
  mpn: string;
  manufacturer: string;

  canonicalTitle: string;
  displayTitle?: string;

  specs: Record<string, {
    value: string;
    sources: string[];
    confidence: number;
  }>;

  verbatimSections: {
    heading?: string;
    text: string;
    source: string;
    confidence: number;
  }[];

  images: {
    url: string;
    source: string;
    confidence: number;
  }[];

  datasheets: {
    url: string;
    label?: string;
    source: string;
  }[];

  overallConfidence: number;
}

export function normalizeProducts(
  products: ExtractedProduct[],
  options?: { canonicalMpn?: string }
): NormalizedProduct {
  if (!products || products.length === 0) {
    throw new Error("normalizeProducts called with empty product list");
  }

  // Auto-inject local datasheet JSON from disk if present
  const baseProduct = products[0];
  const mpnForLookup = baseProduct.mpn;

  const datasheetPath = path.join(
    process.cwd(),
    "data",
    "surgepure",
    "products",
    `${mpnForLookup}.json`
  );

  if (!products.some(p => p.sourceType === "datasheet") && fs.existsSync(datasheetPath)) {
    try {
      const rawDatasheet = JSON.parse(fs.readFileSync(datasheetPath, "utf8"));

      const datasheetProduct: ExtractedProduct = {
        mpn: mpnForLookup,
        manufacturer: baseProduct.manufacturer,
        sourceUrl: `datasheet:${mpnForLookup}`,
        sourceType: "datasheet",
        confidence: 0.95,
        specs: {},
        rawDatasheet
      };

      // Put datasheet first so it has precedence, but keep HTML products
      products = [datasheetProduct, ...products];
    } catch (err) {
      throw new Error(`Failed to load datasheet JSON for ${mpnForLookup}: ${String(err)}`);
    }
  }

  // DEBUG: verify product sources after injection
  console.log("[DEBUG normalize] product sources after injection:",
    products.map(p => ({
      sourceType: p.sourceType,
      sourceUrl: p.sourceUrl,
      hasRawDatasheet: !!p.rawDatasheet,
      specsKeys: Object.keys(p.specs ?? {}).length
    }))
  );

  // Preprocess datasheet products to extract specs and verbatim sections
  for (const p of products) {
    if (p.sourceType === "datasheet" && p.rawDatasheet) {
      console.log("[DEBUG normalize] preprocessing datasheet product:", {
        sourceUrl: p.sourceUrl,
        rawKeys: Object.keys(p.rawDatasheet ?? {}),
      });
      // datasheet → deterministic source of truth
      const raw = p.rawDatasheet;

      // Initialize specs if missing
      if (!p.specs) p.specs = {};

      // Map electrical_specs: extract all string-valued fields, normalize keys
      if (raw.electrical_specs) {
        for (const [key, val] of Object.entries(raw.electrical_specs)) {
          if (typeof val === "string" && val.trim()) {
            const specKey = key
              .replace(/_raw$/, "")
              .replace(/_/g, " ")
              .replace(/\b\w/g, c => c.toUpperCase());
            p.specs[specKey] = val.trim();
          }
        }
      }

      // Map mechanical_specs: extract all string-valued fields, normalize keys
      if (raw.mechanical_specs) {
        for (const [key, val] of Object.entries(raw.mechanical_specs)) {
          if (typeof val === "string" && val.trim()) {
            const specKey = key
              .replace(/_raw$/, "")
              .replace(/_/g, " ")
              .replace(/\b\w/g, c => c.toUpperCase());
            p.specs[specKey] = val.trim();
          }
        }
      }

      // Map safety_and_compliance: extract all string-valued fields, normalize keys
      if (raw.safety_and_compliance) {
        for (const [key, val] of Object.entries(raw.safety_and_compliance)) {
          if (typeof val === "string" && val.trim()) {
            const specKey = key
              .replace(/_raw$/, "")
              .replace(/_/g, " ")
              .replace(/\b\w/g, c => c.toUpperCase());
            p.specs[specKey] = val.trim();
          }
        }
      }

      // Set higher default confidence for datasheet specs if p.confidence is undefined
      if (p.confidence === undefined || p.confidence === null) {
        p.confidence = 0.95;
      }

      if (!p.verbatimSections) p.verbatimSections = [];

      // overview marketing text (supports both legacy and nested JSON shapes)
      const overviewText =
        (typeof raw.marketing_overview === "string" && raw.marketing_overview) ||
        (typeof raw.overview?.headline_raw === "string" && raw.overview.headline_raw) ||
        (Array.isArray(raw.overview?.marketing_text_raw) ? raw.overview.marketing_text_raw.join(" ") : "") ||
        (typeof raw.overview?.datasheet_title_raw === "string" ? raw.overview.datasheet_title_raw : "");

      if (typeof overviewText === "string" && overviewText.trim()) {
        p.verbatimSections.push({
          heading: "Overview",
          text: overviewText.trim(),
          source: p.sourceUrl
        });
      }

      // system description (supports both legacy and nested JSON shapes)
      const systemDesc =
        (typeof raw.system_description === "string" && raw.system_description) ||
        (typeof raw.overview?.system_description_raw === "string" && raw.overview.system_description_raw) ||
        (typeof raw.overview?.system_description === "string" && raw.overview.system_description) ||
        (typeof raw.overview?.system_description_text_raw === "string" && raw.overview.system_description_text_raw);

      if (typeof systemDesc === "string" && systemDesc.trim()) {
        p.verbatimSections.push({
          heading: "System Description",
          text: systemDesc.trim(),
          source: p.sourceUrl
        });
      }

      // key feature bullets (supports both legacy and nested JSON shapes)
      const bullets: string[] = Array.isArray(raw.key_features)
        ? raw.key_features
        : Array.isArray(raw.key_features?.raw_bullets)
          ? raw.key_features.raw_bullets
          : Array.isArray(raw.key_features?.bullets)
            ? raw.key_features.bullets
            : Array.isArray(raw.key_features?.items)
              ? raw.key_features.items
              : Array.isArray(raw.key_features?.raw)
                ? raw.key_features.raw
                : [];

      for (const bullet of bullets) {
        if (typeof bullet === "string" && bullet.trim()) {
          p.verbatimSections.push({
            heading: "Key Feature",
            text: bullet.trim(),
            source: p.sourceUrl
          });
        }
      }
    }
  }

  // DEBUG: verify specs after datasheet preprocessing
  console.log("[DEBUG normalize] merged spec keys after preprocessing:",
    products.map(p => ({
      sourceType: p.sourceType,
      specCount: Object.keys(p.specs ?? {}).length
    }))
  );

  const base = products[0];
  const effectiveMpn = options?.canonicalMpn ?? base.mpn;

  const mpn = effectiveMpn;
  const manufacturer = base.manufacturer;

  const isRAVariant = effectiveMpn.endsWith("RA");

  const canonicalTitle =
    products.find(p => p.sourceType === "oem" && p.canonicalTitle)?.canonicalTitle ??
    products.find(p => p.canonicalTitle)?.canonicalTitle ??
    `${manufacturer} ${mpn}`;

  const displayTitle =
    products.find(p => p.sourceType === "oem" && p.displayTitle)?.displayTitle ??
    products.find(p => p.displayTitle)?.displayTitle ??
    canonicalTitle;

  // Canonical spec aliasing to prevent duplicate semantic specs
  const SPEC_ALIASES: Record<string, string> = {
    "System Voltage": "Nominal AC Line Voltage (VRMS)",
    "Voltage": "Nominal AC Line Voltage (VRMS)",
    "Nominal Ac Line Voltage Vrms": "Nominal AC Line Voltage (VRMS)",
    "Nominal Ac Line Voltage (Vrms)": "Nominal AC Line Voltage (VRMS)",
    "Nominal AC Line Voltage Vrms": "Nominal AC Line Voltage (VRMS)",
  };

  const mergedSpecs: NormalizedProduct["specs"] = {};

  for (const p of products) {
    for (let [key, value] of Object.entries(p.specs ?? {})) {
      if (!value) continue;

      // Normalize spec key via alias map
      const canonicalKey = SPEC_ALIASES[key] ?? key;

      if (!mergedSpecs[canonicalKey]) {
        mergedSpecs[canonicalKey] = {
          value,
          sources: [p.sourceUrl],
          confidence: p.confidence
        };
      } else {
        if (p.confidence > mergedSpecs[canonicalKey].confidence) {
          mergedSpecs[canonicalKey].value = value;
          mergedSpecs[canonicalKey].confidence = p.confidence;
        }
        if (!mergedSpecs[canonicalKey].sources.includes(p.sourceUrl)) {
          mergedSpecs[canonicalKey].sources.push(p.sourceUrl);
        }
      }
    }
  }

  const verbatimSections = products.flatMap(p =>
    (p.verbatimSections ?? []).map(v => ({
      heading: v.heading,
      text: v.text,
      source: p.sourceUrl,
      confidence: p.confidence
    }))
  );

  const images = products.flatMap(p =>
    (p.images ?? []).map(img => ({
      url: img.url,
      source: p.sourceUrl,
      confidence: p.confidence
    }))
  );

  const datasheets = products.flatMap(p =>
    (p.datasheets ?? []).map(d => ({
      url: d.url,
      label: d.label,
      source: p.sourceUrl
    }))
  );

  if (isRAVariant) {
    mergedSpecs["Remote Alarm"] = {
      value: "Yes",
      sources: ["variant:RA"],
      confidence: 0.95
    };

    verbatimSections.push({
      heading: "Variant",
      text: "Includes remote alarm for system monitoring.",
      source: "variant:RA",
      confidence: 0.95
    });
  }

  const overallConfidence =
    products.reduce((sum, p) => sum + p.confidence, 0) / products.length;

  return {
    mpn: effectiveMpn,
    manufacturer,
    canonicalTitle,
    displayTitle,
    specs: mergedSpecs,
    verbatimSections,
    images,
    datasheets,
    overallConfidence
  };
}