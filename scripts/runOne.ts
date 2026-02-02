import { runProductPipeline } from "../services/runProductPipeline.js";

async function main() {
  const result = await runProductPipeline({
    mpn: "M1-1120-3",
    manufacturer: "Surge Pure"
  });

  console.dir(result, { depth: null });
}

main().catch(console.error);