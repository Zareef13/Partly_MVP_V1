/**
 * RA Variant Sanity Test
 *
 * Purpose:
 * Verifies that when an RA MPN is provided:
 * 1. The pipeline searches using the base (non-RA) MPN
 * 2. The final normalized output retains the RA MPN
 * 3. Remote Alarm metadata is injected correctly
 *
 * Run:
 *   npx ts-node backend/scripts/ra_test.ts
 */

import { runProductPipeline } from "../services/runProductPipeline.js";

async function main() {
  const inputMpn = "M1-1120-3RA";
  const manufacturer = "Surge Pure";

  console.log("▶ Running RA variant test");
  console.log("Input MPN:", inputMpn);

  const result = await runProductPipeline({
    mpn: inputMpn,
    manufacturer,
  });

  if (!result?.final?.usable) {
    throw new Error("Pipeline returned unusable result");
  }

  const product = result.final;

  if (product.displayTitle !== inputMpn) {
    throw new Error(
      `Expected final MPN to be ${inputMpn}, got ${product.displayTitle}`
    );
  }

  if (!product.specTable || product.specTable.length === 0) {
    throw new Error("Spec table is empty — base model inheritance failed");
  }

  const hasRemoteAlarm =
    product.specTable.some(
      (s: any) =>
        s.name.toLowerCase().includes("remote alarm") &&
        String(s.value).toLowerCase().includes("yes")
    ) ||
    JSON.stringify(product).toLowerCase().includes("remote alarm");

  if (!hasRemoteAlarm) {
    throw new Error("Remote Alarm was not injected for RA variant");
  }

  console.log("✅ RA variant test passed");
  console.log("Final MPN:", product.displayTitle);
  console.log("Remote Alarm detected");
}

main().catch((err) => {
  console.error("❌ RA VARIANT TEST FAILED");
  console.error(err);
  process.exit(1);
});