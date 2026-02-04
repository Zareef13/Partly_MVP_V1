// tests/crawl.scenarios.ts
import "dotenv/config";
import { crawlPage } from "../services/crawlService.js";

const URLS = [
  "https://www.rockwellautomation.com/en-us/products/details.1756-ib16.html",
  "https://www.mc-mc.com/Product/allen-bradley-1756-ib16",
  "https://www.icdcspares.com/product/siemens-6sl3210-5bb21-5uv1-drivers-icdc-037312/",
  "https://beaverelectrical.com/products/m1-1480-3",
  "https://sieportal.siemens.com/en-us/products-services/detail/6SL3210-5BB21-5UV1",
  "https://www.dosupply.com/automation/allen-bradley-plc/controllogix/1756-IB16",
  "https://www.icdcspares.com/"
];

(async () => {
  for (const url of URLS) {
    console.log("\n==============================");
    console.log("CRAWL TEST:", url);

    const result = await crawlPage(url);

    console.log({
      finalUrl: result.finalUrl,
      usedPlaywright: result.usedPlaywright,
      crawlConfidence: result.crawlConfidence,
      fallbackReason: result.fallbackReason ?? null,
      contentType: result.contentType,
      htmlLength: result.html ? result.html.length : 0
    });
    // EXPECTED (manual sanity check):
    // - Rockwell Automation → crawlConfidence: "high", usedPlaywright: false
    // - Mc-Mc → crawlConfidence: "medium", usedPlaywright: true
    // - ICDC product URL → crawlConfidence: "low" or "non_product"
    // - Beaver Electrical → crawlConfidence: "low" or "blocked"
    // - Siemens portal → crawlConfidence: "medium"
    // - DoSupply → crawlConfidence: "high"
    // - ICDC homepage (negative control) → crawlConfidence: "low"
  }
})();