// Generate an xlsx listing every brand code, its current guessed category,
// and an empty 'Corrected Category' column with a dropdown of the five valid
// values. Total revenue + quantity per brand are included so the reviewer can
// prioritise the codes that actually move the numbers.
//
// Outputs to  scripts/out/brand_categories_review.xlsx  so it's easy to
// download and edit; the file is small (~15 KB, one sheet).

import * as XLSX from "xlsx";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { categoryForBrand, CATEGORY_ORDER } from "../src/lib/productCategories.js";

const data = JSON.parse(readFileSync("./src/data.json", "utf8"));

// Sum per brand across every year in the seed dataset.
const totals = new Map();
for (const r of data.brandSales) {
  if (!r?.brand) continue;
  const cur = totals.get(r.brand) || { amt: 0, qty: 0, years: new Set() };
  cur.amt += Number(r.amt) || 0;
  cur.qty += Number(r.qty) || 0;
  if (r.year) cur.years.add(r.year);
  totals.set(r.brand, cur);
}

const brands = [...totals.keys()].sort();

// Rows: [Brand Code, Current Category, Corrected Category, Total Revenue (RM),
//        Total Quantity (units), Years With Sales]
const header = [
  "Brand Code",
  "Current Category",
  "Corrected Category  (edit me)",
  "Total Revenue (RM)",
  "Total Quantity (units)",
  "Years With Sales",
];
const rows = [header];
for (const b of brands) {
  const t = totals.get(b);
  rows.push([
    b,
    categoryForBrand(b),
    "", // reviewer fills this; anything left blank means "keep current"
    Math.round(t.amt * 100) / 100,
    t.qty,
    [...t.years].sort().join(", "),
  ]);
}

const ws = XLSX.utils.aoa_to_sheet(rows);

// Column widths so the reviewer isn't fighting the default 8-char columns.
ws["!cols"] = [
  { wch: 26 }, // Brand Code
  { wch: 22 }, // Current
  { wch: 30 }, // Corrected
  { wch: 16 }, // Revenue
  { wch: 16 }, // Quantity
  { wch: 22 }, // Years
];

// Freeze header row.
ws["!freeze"] = { xSplit: 0, ySplit: 1 };
ws["!views"] = [{ state: "frozen", ySplit: 1 }];

// Autofilter across the header.
ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: header.length - 1, r: rows.length - 1 } }) };

// Data validation dropdown for the 'Corrected Category' column (C2:C{n+1}).
// SheetJS ('xlsx' community edition) preserves dataValidations on write, so
// Excel/LibreOffice will show a dropdown arrow on each cell.
const lastRow = rows.length;
ws["!dataValidation"] = [{
  sqref: `C2:C${lastRow}`,
  type: "list",
  allowBlank: true,
  showDropDown: false,
  formula1: `"${CATEGORY_ORDER.join(",")}"`,
}];

// Format the money and qty columns as numbers with thousands separators.
for (let r = 2; r <= lastRow; r++) {
  const amtCell = ws[`D${r}`];
  const qtyCell = ws[`E${r}`];
  if (amtCell) amtCell.z = '#,##0.00';
  if (qtyCell) qtyCell.z = '#,##0';
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Brand Categories");

// Second sheet: quick reference on the five categories + current per-category
// totals, so the reviewer sees the shape of the data before editing.
const catRows = [
  ["Category", "Brands", "Total Revenue (RM)", "Total Quantity (units)"],
];
for (const cat of CATEGORY_ORDER) {
  let brandCount = 0, amt = 0, qty = 0;
  for (const b of brands) {
    if (categoryForBrand(b) === cat) {
      brandCount += 1;
      amt += totals.get(b).amt;
      qty += totals.get(b).qty;
    }
  }
  catRows.push([cat, brandCount, Math.round(amt * 100) / 100, qty]);
}
const catWs = XLSX.utils.aoa_to_sheet(catRows);
catWs["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 20 }, { wch: 20 }];
for (let r = 2; r <= catRows.length; r++) {
  if (catWs[`C${r}`]) catWs[`C${r}`].z = '#,##0.00';
  if (catWs[`D${r}`]) catWs[`D${r}`].z = '#,##0';
}
XLSX.utils.book_append_sheet(wb, catWs, "Category Totals");

// Write.
mkdirSync("scripts/out", { recursive: true });
const outPath = "scripts/out/brand_categories_review.xlsx";
XLSX.writeFile(wb, outPath);
console.log(`✓ Wrote ${outPath}`);
console.log(`  ${brands.length} brands · ${CATEGORY_ORDER.length} categories`);
