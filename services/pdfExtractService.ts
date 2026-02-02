import { createRequire } from "module";
const require = createRequire(import.meta.url);

import fetch from "node-fetch";
import "dotenv/config";

// Type-only import for pdf-parse (no default export assumed)
import type * as PdfParseType from "pdf-parse";

type GeminiMappedResult = {
  model: string;
  specs: Record<string, string>;
  overview: string;
  highlights: string[];
};

/**
 * A single extracted spec with provenance
 */
export type PdfSpec = {
  model: string;
  key: string;
  value: string;
  source?: {
    url: string;
  };
};

export type PdfRawRow = {
  key: string;
  raw: string;
};

/**
 * Result returned to the pipeline
 */
export type PdfExtractionResult = {
  detectedModels: string[];
  specs: PdfSpec[];
  rawRows: PdfRawRow[];
  features: string[];
  rawText: string;
  overviewText?: string;
  sidebarBullets?: string[];
};

/**
 * Download PDF
 */
async function fetchPdfBuffer(url: string): Promise<Buffer> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/pdf,application/octet-stream,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://beaverelectrical.com/"
  };

  let res = await fetch(url, { headers });

  // Fallback for CDN / bot-protected PDFs
  if (res.status === 403) {
    res = await fetch(url, {
      headers: {
        ...headers,
        "Accept": "*/*"
      }
    });
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch PDF: ${url} (status ${res.status})`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Parse PDF text (works with pdf-parse CJS + ESM)
 */
async function parsePdfText(buffer: Buffer): Promise<string> {
  const mod = require("pdf-parse");

  // pdf-parse export normalization (covers all known shapes)
  const pdfParse =
    typeof mod === "function"
      ? mod
      : typeof mod.default === "function"
      ? mod.default
      : null;

  if (!pdfParse) {
    throw new Error(
      `pdf-parse require failed: unexpected export shape (${Object.keys(mod).join(", ")})`
    );
  }

  const data = await pdfParse(buffer);
  return data?.text ?? "";
}

function normalizePdfText(text: string): string {
  return text
    // normalize unicode dashes → ASCII hyphen
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    // normalize non‑breaking spaces
    .replace(/\u00A0/g, " ")
    // collapse excessive whitespace but preserve line intent
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n");
}

function detectModels(text: string): string[] {
  const candidates = new Set<string>();

  // Normalize aggressively for PDF table quirks
  const normalized = text
    .toUpperCase()
    // PDFs often drop table cell separators, producing strings like
    // "Model NumberM1-1120-3". Insert a space between letters and the
    // beginning of a model token (e.g., ...R M1-..., ...R M1 1120 3...).
    .replace(/([A-Z])((?:[A-Z]{1,3}\d?)[-\s]?\d{3,4}[-\s]?\d)/g, "$1 $2")
    // also handle a digit immediately followed by a model prefix (rarer)
    .replace(/(\d)((?:M\d)[-\s]?\d{3,4}[-\s]?\d)/g, "$1 $2")
    // normalize unicode dashes → ASCII hyphen
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    // collapse whitespace AFTER repairs
    .replace(/\s+/g, " ");

  // Pattern 1: Standard hyphenated model numbers (M1-1120-3)
  const hyphenRegex = /\b[A-Z]{1,3}\d?-\d{3,4}-\d\b/g;
  (normalized.match(hyphenRegex) ?? []).forEach(m =>
    candidates.add(m)
  );

  // Pattern 2: Space-separated or column-broken models (M1 1120 3)
  const spacedRegex = /\b([A-Z]{1,3}\d?)\s+(\d{3,4})\s+(\d)\b/g;
  let match;
  while ((match = spacedRegex.exec(normalized)) !== null) {
    candidates.add(`${match[1]}-${match[2]}-${match[3]}`);
  }

  // Pattern 3: Table header style — model appears near "MODEL" or "MODEL NUMBER"
  const tableHeaderRegex =
    /(MODEL\s+NUMBER|MODEL)\s+([A-Z]{1,3}\d?[-\s]\d{3,4}[-\s]\d)/g;

  while ((match = tableHeaderRegex.exec(normalized)) !== null) {
    const raw = match[2].replace(/\s+/g, "-");
    candidates.add(raw);
  }

  return Array.from(candidates).map(m =>
    m.replace(/^[A-Z]+(?=M\d-)/, "")
  );
}

/**
 * Extract table-style specs that belong to detected models
 */
function extractSpecs(
  text: string,
  models: string[],
  pdfUrl: string
): PdfSpec[] {
  let acceptedRows = 0;
  let rejectedRows = 0;

  const repairedText = text
    .replace(/(Model Number)/gi, "$1 ")
    .replace(/(M\d-\d{3,4}-\d)(?=M\d-\d{3,4}-\d)/g, "$1 ")
    .replace(/(\d)(M\d-\d{3,4}-\d)/g, "$1 $2");

  // const specs: PdfSpec[] = [];
  // const rejectedRows: { key: string; raw: string }[] = [];

  const rawRows: PdfRawRow[] = [];
  const overviewLines: string[] = [];
  const sidebarBullets: string[] = [];

  const modelIndexMap = new Map<string, number>();
  models.forEach((m, i) => modelIndexMap.set(m, i));
  const lines = repairedText
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  let tableModels: string[] = [];
  let inSpecTable = false;

  for (const line of lines) {
    // Capture left-sidebar safety / callout bullets
    if (
      !inSpecTable &&
      line.length > 20 &&
      /SPD|SCCR|kAIC|Type\s*1|Type\s*2|SurgePure/i.test(line) &&
      /!$/.test(line)
    ) {
      sidebarBullets.push(line);
      continue;
    }

    if (/^Model Number/i.test(line)) {
      const foundModels = line.match(/M\d-\d{3,4}-\d/g);
      if (foundModels && foundModels.length > 0) {
        tableModels = foundModels;
        inSpecTable = true;
      }
      const modelCount = tableModels.length;
      continue;
    }

    // Capture overview / marketing description text
    if (
      !inSpecTable &&
      line.length > 50 &&
      !/^KEY FEATURES/i.test(line) &&
      !/^FOR MORE INFORMATION/i.test(line) &&
      !/^Model Number/i.test(line) &&
      !/Shipping Weight|Certifications/i.test(line) &&
      /(isolates|downline|upline|surge|SPD|Panels|equipment)/i.test(line)
    ) {
      overviewLines.push(line);
    }

    // Handle numeric-only rows that belong to the previous spec (e.g. VPR ratings)
    if (/^\d{3,4}\/\d{3,4}/.test(line)) {
      rawRows.push({
        key: "VPR Rating UL 1449, 5th Ed L-N/L-L @ 20kA",
        raw: line
      });
      rejectedRows++;
      continue;
    }

    if (inSpecTable && tableModels.length > 0) {
      // Stop table parsing once we hit non-spec sections
      if (
        /^KEY FEATURES/i.test(line) ||
        /^MACH 1 DATA SHEET/i.test(line) ||
        /^FOR IEEE/i.test(line)
      ) {
        inSpecTable = false;
        rejectedRows++;
        continue;
      }

      const rowMatch = line.match(
        /^([A-Za-z][A-Za-z0-9\/\-\s\(\)%]+?)\s*(.+)$/
      );

      // Reject obvious non-spec rows
      if (
        /^KEY FEATURES/i.test(line) ||
        /^MACH 1 DATA SHEET/i.test(line) ||
        /^For IEEE/i.test(line) ||
        /^Listed and Certified/i.test(line)
      ) {
        rejectedRows++;
        continue;
      }

      if (!rowMatch) {
        rejectedRows++;
        continue;
      }

      let key = rowMatch[1].trim().replace(/\s+/g, " ");

      // Repair common PDF-split keys
      key = key
        .replace(/^AC Service$/i, "AC Service Types")
        .replace(/^Nomi$/i, "Nominal AC Line Voltage (VRMS)")
        .replace(/^Freq$/i, "Frequency Range - USA/Euro Std")
        .replace(/^Mult$/i, "Multi Element ME* Protection Modes")
        .replace(/^Lead$/i, "Leads: 36” #14 AWG Stranded Copper")
        .replace(/^Max ME\*/i, "Max ME* Surge Current Per Mode / Per Ø / kA")
        .replace(/^Tota$/i, "Total Surge Capacity (kA @ 8x20 μsec pulse)")
        .replace(/^Max Continuous/i, "Max Continuous Operating Voltage (MCOV)")
        .replace(/^Warr$/i, "Warranty")
        .replace(/^Encl osure Size/i, "Enclosure Size (HxWxD)")
        .replace(/^Encl osure Type/i, "Enclosure Type")
        .replace(/^Over current Protection/i, "Overcurrent Protection")
        .replace(/^Cert$/i, "Certifications")
        .replace(/^Perf$/i, "Performance & Safety Testing Per")
        .replace(/^Prot$/i, "Protection Status Indicators")
        .replace(/^Ship$/i, "Shipping Weight LBS (Approx.)")
        .replace(/^Enclosure$/i, "Enclosure Type")
        .replace(/^c-ETL-us Listed and Certified to the latest$/i, "Certifications")
        .replace(
          /^Max Continuous Operating Voltage \(MCOV\) Operating Voltage \(MCOV\)$/i,
          "Max Continuous Operating Voltage (MCOV)"
        );

      const raw = rowMatch[2].trim();

      // Merge split AC Service row
      if (/^AC Service Types$/i.test(key) && raw.startsWith("Types")) {
        rawRows.push({
          key: "AC Service Types",
          raw: raw.replace(/^Types/, "").trim()
        });
        acceptedRows++;
        continue;
      }

      rawRows.push({ key, raw });
      acceptedRows++;
      continue;
    }

    // Skip obvious non‑spec headers / titles
    if (
      /^Model Number/i.test(line) ||
      /^KEY FEATURES/i.test(line) ||
      /^MACH 1 DATA SHEET/i.test(line) ||
      /^For IEEE/i.test(line)
    ) {
      rejectedRows++;
      continue;
    }

    /*
    // Match "Label    Value"
    const match = line.match(
      /^([A-Za-z0-9\/\-\s\(\)%]+?)\s{2,}([0-9A-Za-z\/\.\-\s]+)$/
    );

    if (!match) continue;

    const key = match[1].trim();
    let value = match[2].trim();

    // Removed tokens and firstValueMatch logic per instructions

    if (key.length < 4 || value.length < 1) continue;

    console.log("[PDF SPEC PARSED]", { key, value });
    specs.push({
      model: "GLOBAL",
      key,
      value,
      source: { url: pdfUrl }
    });
    */
  }

  /*
  console.log("========== PDF REJECTED TABLE ROWS ==========");
  rejectedRows.forEach(r => {
    console.log(`- ${r.key}: ${r.raw}`);
  });
  console.log("========== END REJECTED ROWS ==========");
  */
  // Removed verbose debug logging for production use
  ;(extractSpecs as any).rawRows = rawRows;
  (extractSpecs as any).overviewText = overviewLines.join(" ");
  (extractSpecs as any).sidebarBullets = sidebarBullets;
  return [];
}

/**
 * Extract bullet-style features near the detected model section
 */
function extractFeatures(
  text: string,
  models: string[]
): string[] {
  const features: string[] = [];
  const lines = text.split("\n");

  let inFeatures = false;
  let currentFeature = "";

  for (const raw of lines) {
    const line = raw.trim();

    if (/^KEY FEATURES/i.test(line)) {
      inFeatures = true;
      if (currentFeature) {
        features.push(currentFeature.trim());
        currentFeature = "";
      }
      continue;
    }

    if (/^MACH 1 DATA SHEET|^Certifications/i.test(line)) {
      inFeatures = false;
      if (currentFeature) {
        features.push(currentFeature.trim());
        currentFeature = "";
      }
      continue;
    }

    if (!inFeatures) continue;

    if (line.startsWith("•")) {
      if (currentFeature) {
        features.push(currentFeature.trim());
      }
      currentFeature = line.replace(/^•\s*/, "").trim();
    } else if (currentFeature && (raw.startsWith(" ") || raw.startsWith("\t") || /^[a-z]/.test(line))) {
      currentFeature += " " + line.trim();
    } else if (currentFeature) {
      // If line does not start with bullet or indent or lowercase, close feature
      features.push(currentFeature.trim());
      currentFeature = "";
      // Also check if line starts with bullet again (unlikely here)
      if (line.startsWith("•")) {
        currentFeature = line.replace(/^•\s*/, "").trim();
      }
    }
  }

  if (currentFeature) {
    features.push(currentFeature.trim());
  }

  return Array.from(new Set(features));
}

async function mapWithGemini(input: {
  targetModel: string;
  models: string[];
  rawRows: PdfRawRow[];
  specsOnly?: boolean;
  features?: string[];
  sidebarBullets?: string[];
  overviewText?: string;
}): Promise<GeminiMappedResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const prompt = input.specsOnly
    ? `
Extract structured electrical specs for ONE model.

MODELS (left → right):
${input.models.join(", ")}

TARGET MODEL:
${input.targetModel}

RAW TABLE ROWS:
${JSON.stringify(input.rawRows)}

TASKS:
- Normalize spec names
- Extract ONLY the value for the TARGET MODEL
- Preserve units
- Return null for N/A

RETURN JSON ONLY:

{
  "model": "${input.targetModel}",
  "specs": { "<spec>": "<value|null>" }
}
`
    : `
You are an expert electrical product data extractor.

MODELS:
${input.models.join(", ")}

TARGET MODEL:
${input.targetModel}

RAW TABLE ROWS:
${JSON.stringify(input.rawRows, null, 2)}

FEATURES:
${JSON.stringify(input.features ?? [], null, 2)}

SIDEBAR CALLOUTS:
${JSON.stringify(input.sidebarBullets ?? [], null, 2)}

OVERVIEW TEXT:
${input.overviewText ?? ""}

RETURN STRICT JSON:
{
  "model": "<model>",
  "specs": { "<spec>": "<value|null>" },
  "overview": "<text>",
  "highlights": ["..."]
}
`;

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 }
      })
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status}`);
  }

  const data: any = await res.json();
  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  return JSON.parse(text);
}

export async function extractFromPdf(
  pdfUrl: string,
  targetModel?: string
): Promise<PdfExtractionResult> {
  const buffer = await fetchPdfBuffer(pdfUrl);
  const rawText = await parsePdfText(buffer);
  const text = normalizePdfText(rawText);

  const repairedText = text
    .replace(/(Model Number)/gi, "$1 ")
    .replace(/(M\d-\d{3,4}-\d)(?=M\d-\d{3,4}-\d)/g, "$1 ")
    .replace(/(\d)(M\d-\d{3,4}-\d)/g, "$1 $2");

  const detectedModels = detectModels(repairedText);
  if (detectedModels.length === 0) {
    console.warn("[PDF DEBUG] No models detected.");
    console.warn("[PDF DEBUG] First 1500 chars:");
    console.warn(text.slice(0, 1500));
    console.warn("[PDF DEBUG] Regex sanity check:",
      text.match(/[A-Z]{1,3}\s*\d{3,4}\s*\d/g)
    );
  }

  const specs = extractSpecs(text, detectedModels, pdfUrl);
  const rawRows = (extractSpecs as any).rawRows ?? [];
  if (rawRows.length < 18) {
    console.error("[PDF ERROR] Too few spec rows extracted.");
    console.error("Extracted rows:", rawRows.map(r => r.key));
    throw new Error(
      `Spec table incomplete: expected ~20 rows, got ${rawRows.length}`
    );
  }
  const overviewText = (extractSpecs as any).overviewText ?? "";
  const sidebarBullets = (extractSpecs as any).sidebarBullets ?? [];

  const features = extractFeatures(text, detectedModels);

  // Map specs for ONE target model (explicit or fallback)
  const resolvedTargetModel =
    targetModel && detectedModels.includes(targetModel)
      ? targetModel
      : detectedModels[0];

  const geminiResult = await mapWithGemini({
    targetModel: resolvedTargetModel,
    models: detectedModels,
    rawRows,
    specsOnly: true
  });

  const specsMapped: PdfSpec[] = Object.entries(geminiResult.specs).map(
    ([key, value]) => ({
      model: geminiResult.model,
      key,
      value: value ?? "N/A",
      source: { url: pdfUrl }
    })
  );

  return {
    detectedModels,
    specs: specsMapped,
    rawRows,
    features,
    rawText,
    overviewText: geminiResult.overview,
    sidebarBullets: geminiResult.highlights
  };
}