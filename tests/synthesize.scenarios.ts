// tests/synthesize.scenarios.ts
import "dotenv/config";
import { synthesizeProductContent } from "../services/synthesizeService.js";

function safeArray<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}
function safeString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// NOTE: In tests we pass a fully mocked post-extraction object.
// We cast to `any` to avoid coupling tests to internal SynthesisInput typings.
const TEST_CASES = [
  {
    name: "OEM – Mach 1 (PDF-backed, rich)",
    input: {
      mpn: "M1-1120-3",
      manufacturer: "SurgePure",
      canonicalTitle: "SurgePure Mach 1 M1-1120-3",
      displayTitle: "Mach 1 SPD Surge Protection System",

      specs: {
        "System": "1Ø, 120/240 VRMS, 50/60 Hz",
        "Surge Capacity": "240,000 Amps multi-element",
        "Protection Modes": "L-N, L-L, N-G",
        "MCOV": "140/320",
        "Max Service Size": "200 Amps",
        "Enclosure": "NEMA 12 indoor",
        "SCCR": "200kAIC",
        "SPD Type": "Type 1 & Type 2",
        "Warranty": "10-year manufacturer warranty"
      },

      verbatimSections: [
        {
          heading: "Product Description",
          text: "The Mach 1 SPD (Surge Protection Device) system delivers essential secondary-level surge protection specifically designed for sub-distribution panels and secondary locations.",
          source: "pdf"
        },
        {
          text: "Ideal for IEEE Category B installations, Mach 1 provides comprehensive protection for panels rated up to 200 amps, especially effective when paired with primary-level protection systems.",
          source: "pdf"
        },
        {
          heading: "Protect Your Equipment, Secure Your Investment",
          text: "Mach 1 safeguards sensitive downstream equipment from damaging surges caused by switching motor loads and internal disturbances.",
          source: "pdf"
        },
        {
          text: "It enhances your existing surge protection infrastructure by complementing primary-level SurgePure devices, significantly reducing downtime and maximizing your long-term operational savings.",
          source: "pdf"
        },
        {
          heading: "Key Features",
          text: "240,000 Amps Multi-Element Surge Capacity: Robust, reliable secondary-level protection.",
          source: "pdf"
        },
        {
          text: "Unique Fuse-Link Safety: Protects nearby equipment during catastrophic events.",
          source: "pdf"
        },
        {
          text: "Easy Installation: Designed for simple, close-coupled mounting.",
          source: "pdf"
        },
        {
          text: "Continuous 24/7 Protection: Integrates seamlessly into a non-degrading SPD network, ensuring continuous power integrity.",
          source: "pdf"
        }
      ],

      datasheets: [
        {
          url: "https://www.surgepure.com/_files/ugd/866c55_505ec3b165db4529b4fdcebb2a24b8db.pdf",
          title: "Mach 1 SPD Data Sheet"
        }
      ],

      images: [
        {
          url: "https://example.com/mach1-product.jpg",
          alt: "SurgePure Mach 1 SPD device"
        }
      ],

      extractionConfidence: "high"
    }
  }
];

(async () => {
  for (const test of TEST_CASES) {
    console.log("\n==============================");
    console.log("SYNTHESIS TEST:", test.name);

    try {
      const result = await synthesizeProductContent(test.input as any);
      if (!result || typeof result !== "object") {
        throw new Error("Synthesize returned invalid result object");
      }

      console.log("DISPLAY TITLE:");
      console.log(result.displayTitle ?? "(none)");

      console.log("\nCANONICAL TITLE:");
      console.log(result.canonicalTitle ?? "(none)");

      console.log("\nKEY FEATURES:");
      safeArray(result.keyFeatures).forEach((f: string) => console.log("- " + f));

      console.log("\nSHORT DESCRIPTION:");
      console.log(result.shortDescription ?? "(none)");

      console.log("\nOVERVIEW:");
      console.log(result.overview ?? "(none)");

      console.log("\nBULLET HIGHLIGHTS:");
      safeArray(result.bulletHighlights).forEach((b: string) => console.log("- " + b));

      console.log("\nSEO DESCRIPTION:");
      console.log(result.seoDescription ?? "(none)");

      console.log("\nDISCLAIMERS:");
      safeArray(result.disclaimers).forEach((d: string) => console.log("- " + d));

      console.log("\n--- METRICS ---");
      console.log({
        shortDescriptionLength: safeString(result.shortDescription).length,
        keyFeatureCount: safeArray(result.keyFeatures).length,
        bulletCount: safeArray(result.bulletHighlights).length,
        seoLength: safeString(result.seoDescription).length,
        disclaimerCount: safeArray(result.disclaimers).length
      });

    } catch (err) {
      console.error("SYNTHESIS FAILED");
      if (err instanceof Error) {
        console.error(err.stack);
      } else {
        console.error("Non-Error thrown:", JSON.stringify(err, null, 2));
      }
      throw err;
    }
  }
})();