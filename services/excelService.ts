
import * as XLSX from 'xlsx';
import { RawComponentData, EnrichedComponentData } from '../types';

export const parseExcelFile = async (file: File): Promise<RawComponentData[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        const mappedData = jsonData.map((row) => {
          const mpnKey = Object.keys(row).find(k => 
            ['mpn', 'part number', 'sku', 'mfg part number'].includes(k.toLowerCase().trim())
          ) || Object.keys(row)[0];
          
          const mfgKey = Object.keys(row).find(k => 
            ['manufacturer', 'mfg', 'brand'].includes(k.toLowerCase().trim())
          ) || Object.keys(row)[1];

          return {
            mpn: String(row[mpnKey] || '').trim(),
            manufacturer: String(row[mfgKey] || '').trim()
          };
        }).filter(item => item.mpn !== '');

        resolve(mappedData);
      } catch (err) {
        reject(new Error("Failed to parse Excel file."));
      }
    };
    reader.onerror = () => reject(new Error("File reading error"));
    reader.readAsArrayBuffer(file);
  });
};

const convertToHTML = (item: EnrichedComponentData) => {
  let html = '<div class="product-enrichment">\n';

  // Section 1: Features
  if (item.features && item.features.length > 0) {
    html += '  <h2 style="font-size: 1.25rem; font-weight: bold; margin-bottom: 1rem;">Features</h2>\n';
    html += '  <ul style="list-style-type: disc; margin-left: 1.5rem; margin-bottom: 2rem;">\n';
    item.features.forEach(f => {
      html += `    <li style="margin-bottom: 0.5rem;">${f}</li>\n`;
    });
    html += '  </ul>\n';
  }

  // Section 2: Overview
  if (item.description) {
    html += '  <h2 style="font-size: 1.25rem; font-weight: bold; margin-bottom: 1rem;">Overview</h2>\n';
    item.description.split('\n').forEach(p => {
      if (p.trim()) {
        html += `  <p style="margin-bottom: 1.5rem; line-height: 1.6;">${p.trim()}</p>\n`;
      }
    });
  }

  // Section 3: Specs
  if (item.specTable && item.specTable.length > 0) {
    html += '<h2 style="font-size: 1.25rem; font-weight: bold; margin-top: 2rem; margin-bottom: 1rem;">Technical Specifications</h2>\n';
    html += '<table style="width: 100%; border-collapse: collapse; margin-bottom: 1rem;">\n';
    html += '  <thead><tr style="background: #f4f4f5;"><th style="border: 1px solid #e4e4e7; padding: 8px; text-align: left;">Attribute</th><th style="border: 1px solid #e4e4e7; padding: 8px; text-align: left;">Value</th><th style="border: 1px solid #e4e4e7; padding: 8px; text-align: left;">Unit</th></tr></thead>\n';
    html += '  <tbody>\n';
    item.specTable.forEach(s => {
      html += `    <tr><td style="border: 1px solid #e4e4e7; padding: 8px;">${s.attribute}</td><td style="border: 1px solid #e4e4e7; padding: 8px;">${s.value}</td><td style="border: 1px solid #e4e4e7; padding: 8px;">${s.unit}</td></tr>\n`;
    });
    html += '  </tbody></table>\n';
  }

  html += '</div>';
  return html;
};

export const exportToExcel = (data: EnrichedComponentData[]) => {
  const exportData = data.map(item => {
    const specStr = (item.specTable || []).map(s => `${s.attribute}: ${s.value} ${s.unit}`).join('; ');
    const featuresStr = (item.features || []).map(f => `• ${f}`).join('\n');
    return {
      "MPN": item.mpn,
      "Manufacturer": item.manufacturer,
      "Features": featuresStr,
      "Overview": item.description,
      "Technical Specs": specStr,
      "Description (HTML)": convertToHTML(item),
      "Image Link": item.imageUrl || 'none',
      "Datasheet Link": item.datasheetUrl || 'none'
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Enriched Parts");
  
  const now = new Date();
  const timestamp = now.toISOString().replace('T', '_').slice(0, 16).replace(/:/g, '-');
  const filename = `SurgePure_Enrichment_${timestamp}.xlsx`;
  
  XLSX.writeFile(workbook, filename);
};
