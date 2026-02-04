import { discoverProductSources } from "../services/discoveryService.js";

const TEST_SKUS = [
  // Clean manufacturer pages
  { mpn: "1756-IB16", manufacturer: "Allen-Bradley" },
  { mpn: "6SL3210-5BB21-5UV1", manufacturer: "Siemens" },
  { mpn: "M1-1480-3", manufacturer: "SurgePure" },

  // Distributor-heavy SKUs
  { mpn: "22F-D013N104", manufacturer: "Allen-Bradley" },
  { mpn: "3RT2026-1BB40", manufacturer: "Siemens" },

  // Viewer / mirror-heavy
  { mpn: "1769-IF8", manufacturer: "Allen-Bradley" },
  { mpn: "6ES7314-6EH04-0AB0", manufacturer: "Siemens" },

  // PDF-first / legacy
  { mpn: "140G-G2C3-C25", manufacturer: "Allen-Bradley" },

  // Garbage / edge cases
  { mpn: "XYZ-NOT-A-REAL-PART", manufacturer: "Siemens" },
  { mpn: "1234-FAKE-MPN", manufacturer: "UnknownCorp" }
];

(async () => {
  for (const test of TEST_SKUS) {
    console.log("\n==============================");
    console.log("TEST:", test);

    try {
      const result = await discoverProductSources(test.mpn, test.manufacturer);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("ERROR:", err);
    }
  }
})();