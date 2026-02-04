// tests/extract.scenarios.ts
import "dotenv/config";
import { crawlPage } from "../services/crawlService.js";
import { extractFromHtml } from "../services/extractService.js";

const TEST_CASES = [
  {
    mpn: "1756-IB16",
    manufacturer: "Allen-Bradley",
    url: "https://www.rockwellautomation.com/en-us/products/details.1756-ib16.html"
  },
  {
    mpn: "1756-IB16",
    manufacturer: "Allen-Bradley",
    url: "https://www.mc-mc.com/Product/allen-bradley-1756-ib16"
  },
  {
    mpn: "6SL3210-5BB21-5UV1",
    manufacturer: "Siemens",
    url: "https://www.icdcspares.com/product/siemens-6sl3210-5bb21-5uv1-drivers-icdc-037312/"
  },
  {
    mpn: "M1-1480-3",
    manufacturer: "SurgePure",
    url: "https://beaverelectrical.com/products/m1-1480-3"
  }
];

(async () => {
  for (const test of TEST_CASES) {
    console.log("\n==============================");
    console.log("EXTRACT TEST:", test.mpn, "|", test.url);

    const crawl = await crawlPage(test.url);

    const result = extractFromHtml({
      html: crawl.html,
      sourceUrl: crawl.finalUrl,
      mpn: test.mpn,
      manufacturer: test.manufacturer
    });

    console.log({
      ok: result.ok,
      reason: result.reason,
      displayTitle: result.displayTitle,
      canonicalTitle: result.canonicalTitle,
      specCount: Object.keys(result.specs).length,
      imageCount: result.images.length,
      datasheetCount: result.datasheets.length
    });
  }
})();