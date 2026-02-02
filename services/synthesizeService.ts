import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY not set in environment");
}

const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const GEMINI_MODEL = process.env.GEMINI_MODEL || "models/gemini-2.5-flash";

function extractJson(text: string): any {
  const raw = (text ?? "").trim();
  if (!raw) {
    throw new Error("Empty Gemini response text");
  }

  const cleaned = raw.replace(/^\uFEFF/, "").trim();

  if (cleaned.startsWith("```")) {
    const lines = cleaned.split("\n");
    if (lines.length >= 3) {
      // Remove the first line (``` or ```json) and the last line (```)
      const stripped = lines.slice(1, -1).join("\n").trim();
      try {
        return JSON.parse(stripped);
      } catch {
        // fall through to brace-based extraction below
      }
    }
  }

  // 2) Balanced-brace extraction: find first complete {...} object
  const start = cleaned.indexOf("{");
  if (start === -1) {
    throw new Error("No JSON object start '{' found in Gemini response");
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0 && i > start) {
      const candidate = cleaned.slice(start, i + 1).trim();
      try {
        return JSON.parse(candidate);
      } catch {
        // Attempt array sanitization: remove stray bare-word tokens inside arrays
        const sanitized = candidate.replace(
          /,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=[,\]])/g,
          ""
        );
        try {
          return JSON.parse(sanitized);
        } catch (e: any) {
          throw new Error(
            "Failed to parse Gemini response as JSON after sanitization. " +
              "Error: " +
              (e?.message ?? String(e))
          );
        }
      }
    }
  }

  throw new Error("Unterminated JSON object in Gemini response (no matching '}')");
}


export interface SynthesisInput {
  mpn: string;
  manufacturer: string;
  canonicalTitle: string;
  specs: Record<string, string>;
  images: string[];
  datasheets: { url: string; label?: string }[];
  notes?: string[];
  verbatimDescriptors: string[];
}

export interface SynthesisOutput {
  canonicalTitle: string;
  displayTitle?: string;

  // New: the exact format you want (maps to “Key features” + “Overview”)
  keyFeatures: string[];
  overview: string;

  // Keep existing fields for backwards compatibility / UI flexibility
  shortDescription: string;
  longDescription: string;
  bulletHighlights: string[];
  seoDescription: string;
  disclaimers: string[];

  // Optional confidence score, not part of original export but added internally
  _confidence?: number;
}

function normalizeSynthesisOutput(out: any, canonicalTitle: string): SynthesisOutput {
  if (!out || typeof out !== "object") {
    throw new Error("Gemini returned non-object JSON");
  }

  const keyFeatures = Array.isArray(out.keyFeatures) ? out.keyFeatures.map((s: any) => String(s).trim()).filter(Boolean) : [];
  let overview = String(out.overview ?? "").trim();

  const shortDescriptionRaw = String(out.shortDescription ?? "").trim();
  const longDescription = String(out.longDescription ?? "").trim();

  const bulletHighlights = Array.isArray(out.bulletHighlights)
    ? out.bulletHighlights.map((s: any) => String(s).trim()).filter(Boolean)
    : [];

  let seoDescription = String(out.seoDescription ?? "").trim();
  if (seoDescription.length > 160) {
    seoDescription = seoDescription.slice(0, 160).trim();
  }

  const disclaimers = Array.isArray(out.disclaimers)
    ? out.disclaimers.map((s: any) => String(s).trim()).filter(Boolean)
    : [];

  // If model only filled one of the new/old fields, provide sane fallbacks.
  const finalKeyFeatures = keyFeatures.length ? keyFeatures : bulletHighlights;
  const finalBulletHighlights = bulletHighlights.length ? bulletHighlights : keyFeatures;

  // Generate deterministic overview if empty and keyFeatures >=4
  if (!overview && finalKeyFeatures.length >= 4) {
    overview =
      `The ${canonicalTitle} is a digital input module designed for industrial automation systems. ` +
      `Based on available specifications, it supports ${finalKeyFeatures
        .map(f => f.replace(/^[^:]+:\s*/, ""))
        .join(", ")}.`;
  }

  // Generate shortDescription fallback if empty and keyFeatures > 0
  let shortDescription = shortDescriptionRaw;
  if (!shortDescription && finalKeyFeatures.length > 0) {
    const firstTwo = finalKeyFeatures.slice(0, 2).join(" and ");
    shortDescription =
      `The ${canonicalTitle} is a digital input module featuring ${firstTwo}.`;
  }

  return {
    canonicalTitle, // set externally
    keyFeatures: finalKeyFeatures,
    overview,
    shortDescription,
    longDescription,
    bulletHighlights: finalBulletHighlights,
    seoDescription,
    disclaimers
  };
}

function validateAgainstInput(input: SynthesisInput, output: SynthesisOutput): SynthesisOutput {
  if (
    output.canonicalTitle.includes(".com") ||
    output.canonicalTitle.includes(".net")
  ) {
    output.canonicalTitle = `${input.manufacturer} ${input.mpn}`;
  }

  const inputSpecKeys = new Set(Object.keys(input.specs));
  let keyFeaturesChanged = false;

  const filteredKeyFeatures = output.keyFeatures;

  // Check if any spec value is missing or "Not specified"
  const anySpecMissing = Object.values(input.specs).some(val => !val || val.trim().toLowerCase() === "not specified");

  // Prepare disclaimers set to avoid duplicates
  const disclaimersSet = new Set(output.disclaimers);

  if (anySpecMissing || keyFeaturesChanged) {
    disclaimersSet.add("Some specifications were not provided and are listed as Not specified.");
  }
  disclaimersSet.add("Installation should follow local electrical codes and be performed by qualified personnel.");

  // Source-confidence guard: replaced logic to allow overview construction from specs when 4 or more specs exist
  // Removed original block that blanked overview if !hasDescriptors && specs < 3
  // Now no blanking is done here; overview is preserved or constructed in normalizeSynthesisOutput

  return {
    ...output,
    keyFeatures: filteredKeyFeatures,
    disclaimers: Array.from(disclaimersSet),
  };
}

function computeContentConfidence(input: SynthesisInput, output: SynthesisOutput): number {
  const totalSpecs = Object.keys(input.specs).length;
  if (totalSpecs === 0) return 0;

  // Count how many specs are used in keyFeatures
  const usedSpecsCount = output.keyFeatures.reduce((count, feature) => {
    const colonIndex = feature.indexOf(":");
    if (colonIndex === -1) return count;
    const label = feature.slice(0, colonIndex).trim();
    if (label in input.specs) return count + 1;
    return count;
  }, 0);

  const specFraction = usedSpecsCount / totalSpecs;

  // Bonus for images presence (0 or 0.1)
  const hasImages = Array.isArray(input.images) && input.images.length > 0 ? 0.1 : 0;

  // Bonus for datasheets presence (0 or 0.1)
  const hasDatasheets = Array.isArray(input.datasheets) && input.datasheets.length > 0 ? 0.1 : 0;

  // Confidence capped at 0.85
  const confidence = Math.min(0.85, specFraction + hasImages + hasDatasheets);

  return confidence;
}

export async function synthesizeProductContent(
  input: SynthesisInput
): Promise<SynthesisOutput> {

  const descriptors = Array.isArray(input.verbatimDescriptors)
    ? input.verbatimDescriptors.map(d => String(d).trim()).filter(Boolean)
    : [];

  const resolvedDisplayTitle =
    input.canonicalTitle && input.canonicalTitle.length > 0
      ? input.canonicalTitle
      : `${input.manufacturer} ${input.mpn}`;

  if (!input.specs || Object.keys(input.specs).length === 0) {
    let shortDescriptionFallback = "";
    if (descriptors.length > 0) {
      shortDescriptionFallback = `${input.manufacturer} ${input.mpn} ${descriptors.join(" ")}`;
    }
    return {
      canonicalTitle: input.canonicalTitle,
      displayTitle: resolvedDisplayTitle,
      keyFeatures: [],
      overview: "",
      shortDescription: shortDescriptionFallback,
      longDescription: "",
      bulletHighlights: [],
      seoDescription: "",
      disclaimers: [
        "Insufficient verified product data available to generate content.",
        "Installation should follow local electrical codes and be performed by qualified personnel."
      ],
      _confidence: 0
    };
  }

  const prompt = `
You are generating high-quality industrial product catalog content for an electronics distributor.

THIS IS A FACT-GROUNDED TRANSFORMATION TASK.
You may STRUCTURE, EXPLAIN, and CONTEXTUALIZE facts, but you MUST NOT invent facts.

GROUNDING RULES (STRICT):
- You MUST use ONLY information explicitly present in PRODUCT INPUT.
- You MUST NOT invent specifications, ratings, certifications, dimensions, applications, or limits.
- You MUST NOT introduce new numeric values or standards not present in PRODUCT INPUT.
- You MAY explain, restate, and contextualize facts that ARE present.
- You MAY describe functional intent or usage context IF it is explicitly described in PRODUCT INPUT.notes or PRODUCT INPUT.verbatimDescriptors.
- If information is absent, do NOT guess. Omit it or mark as "Not specified" where appropriate.

ALLOWED EXPANSION (THIS IS IMPORTANT):
- You MAY write multi-paragraph overviews if PRODUCT INPUT.notes contain explanatory text.
- You MAY explain *why* a feature exists IF the explanation is already stated or implied in PRODUCT INPUT.notes.
- You MAY restate specs in sentence form for readability.
- You MAY use neutral industrial language (e.g., "designed for", "intended for") ONLY when supported by input text.
- You MUST NOT add marketing hype, comparative claims, or promises of performance.

TERMINOLOGY RULES:
- You MAY use product category terms (e.g., "surge protective device", "digital input module") ONLY if those terms appear verbatim in:
  - PRODUCT INPUT.canonicalTitle
  - PRODUCT INPUT.verbatimDescriptors
  - PRODUCT INPUT.notes
- If none exist, refer to the product as a "component".

PRODUCT INPUT (JSON):
${JSON.stringify(input, null, 2)}

OUTPUT REQUIREMENTS:
Return STRICT JSON ONLY, matching EXACTLY this schema:

{
  "keyFeatures": string[],           // Structured factual bullets from specs; format "Label: value"
  "overview": string,                // Detailed factual overview; may be multi-paragraph
  "shortDescription": string,         // 1–2 sentence factual summary
  "longDescription": string,          // Expanded description derived from overview and notes
  "bulletHighlights": string[],       // Concise highlights derived ONLY from keyFeatures
  "seoDescription": string,           // <= 160 characters, factual and descriptive
  "disclaimers": string[]             // Include when data is incomplete or safety-relevant
}

KEY FEATURES RULES:
- Use ONLY labels present in PRODUCT INPUT.specs.
- Preserve original wording of labels and values.
- Do NOT merge, rename, or normalize labels.

VERBATIM PRIORITY RULE:
- Content in PRODUCT INPUT.verbatimSections is authoritative.
- You SHOULD preserve its technical intent and level of detail.
- You MAY expand it into multi-paragraph explanations.
- Do NOT overly compress or summarize verbatimSections unless redundant.

DISCLAIMERS RULES:
- If ANY spec value is missing or marked "Not specified", include:
  "Some specifications were not provided and are listed as Not specified."
- Always include:
  "Installation should follow local electrical codes and be performed by qualified personnel."

FAIL-SAFE:
If limited specs exist but PRODUCT INPUT.notes are rich, prioritize explanatory overview content.
If both specs and notes are sparse, produce minimal but accurate output — never fabricate.
`;

  const result = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ]
  });

  const text =
    (result as any)?.text ??
    (result as any)?.response?.text ??
    (result as any)?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ??
    "";

  try {
    const parsed = extractJson(text);
    let normalized = normalizeSynthesisOutput(parsed, input.canonicalTitle);
    normalized = validateAgainstInput(input, normalized);

    const confidence = computeContentConfidence(input, normalized);

    return {
      ...normalized,
      canonicalTitle: input.canonicalTitle,
      displayTitle: resolvedDisplayTitle,
      _confidence: confidence
    };
  } catch (err) {
    throw new Error(
      "Failed to parse Gemini response as JSON. Raw output:\n" + text
    );
  }
}