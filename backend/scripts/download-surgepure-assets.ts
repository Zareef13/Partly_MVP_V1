import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import XLSX from "xlsx";

const EXCEL_PATH =
  "SurgePure NPI New Products Template 2026-01-19 (1).xlsx";

const OUT_PDFS = "data/surgepure/pdfs";
const OUT_IMAGES = "data/surgepure/images";
const MANIFEST_PATH = "data/surgepure/manifest/index.json";

fs.mkdirSync(OUT_PDFS, { recursive: true });
fs.mkdirSync(OUT_IMAGES, { recursive: true });

function sanitizeMPN(mpn: string) {
  return mpn.replace(/[^A-Za-z0-9\-_.]/g, "_");
}

async function downloadFile(url: string, outPath: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    }
  });

  if (!res.ok) {
    throw new Error(`Failed ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
}

async function main() {
  const workbook = XLSX.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(sheet);

  const manifest: any[] = [];

  for (const row of rows) {
    const mpn =
      row["Manufacturer's P/N (30 Characters Max)"] ||
      row["Manufacturer Part Number"] ||
      row["MPN"];

    const datasheetUrl = row["Datasheet URL"];
    const imageUrl = row["Image URL"];

    if (!mpn || typeof mpn !== "string") continue;

    const cleanMPN = sanitizeMPN(String(mpn));

    const entry: any = {
      mpn: cleanMPN,
      datasheetUrl,
      imageUrl,
      pdfPath: null,
      imagePath: null
    };

    try {
      if (datasheetUrl) {
        const pdfPath = path.join(OUT_PDFS, `${cleanMPN}.pdf`);
        await downloadFile(datasheetUrl, pdfPath);
        entry.pdfPath = pdfPath;
      }
    } catch (e) {
      console.error(`PDF failed for ${cleanMPN}`);
    }

    try {
      if (imageUrl) {
        const ext = imageUrl.split(".").pop()?.split("?")[0] || "jpg";
        const imagePath = path.join(
          OUT_IMAGES,
          `${cleanMPN}.${ext}`
        );
        await downloadFile(imageUrl, imagePath);
        entry.imagePath = imagePath;
      }
    } catch (e) {
      console.error(`Image failed for ${cleanMPN}`);
    }

    manifest.push(entry);
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`✅ Done. Saved ${manifest.length} entries`);
}

main();