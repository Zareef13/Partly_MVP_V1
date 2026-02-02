import { extractFromPdf } from "../services/pdfExtractService.ts";

type PdfScenario = {
  name: string;
  pdfUrl: string;
  expectModel: string;
};

const scenarios: PdfScenario[] = [
  {
    name: "SurgePure Mach 1 datasheet",
    pdfUrl: "https://beaverelectrical.com/content/Mach-1-Data-Sheet.pdf",
    expectModel: "M1-1120-3"
  }
];

async function runScenario(s: PdfScenario) {
  console.log("\n===============================");
  console.log(`PDF SCENARIO: ${s.name}`);
  console.log("===============================");

  const result = await extractFromPdf(s.pdfUrl);

  console.log("\nDetected models:");
  console.log(result.detectedModels);

  console.log(`\nLLM Specs for model ${s.expectModel}:`);

  const modelSpecs = result.specs.filter(
    spec => spec.model === s.expectModel
  );

  modelSpecs.forEach(spec => {
    console.log(`- ${spec.key}: ${spec.value}`);
  });

  if (modelSpecs.length < 18) {
    throw new Error(
      `Expected ~20 spec rows for ${s.expectModel}, got ${modelSpecs.length}`
    );
  }

  // Minimal assertions (manual but effective)
  if (!result.detectedModels.includes(s.expectModel)) {
    throw new Error(
      `Expected model ${s.expectModel} not found in detected models`
    );
  }

  console.log("\n✅ Scenario passed");
}

async function main() {
  for (const scenario of scenarios) {
    await runScenario(scenario);
  }
}

main().catch(err => {
  console.error("\n❌ PDF SCENARIO FAILED");
  console.error(err);
  process.exit(1);
});