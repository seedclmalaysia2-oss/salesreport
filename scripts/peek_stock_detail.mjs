import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const path = process.argv[2];
const wb = XLSX.read(readFileSync(path), { type: "buffer" });
const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });

// Discover doc-no prefixes and salesman variants.
const prefixes = new Map();
const salesmen = new Map();
const brandRowCount = { count: 0 };
let dataRows = 0;
let totalNetSales = 0;
const bySp = {};
for (let i = 3; i < grid.length; i++) {
  const r = grid[i]; if (!r) continue;
  const label = r[1];
  if (label === "Brand") { brandRowCount.count += 1; continue; }
  const doc = r[2];
  const sp  = r[3];
  const netSales = r[15];
  if (typeof doc === "string" && sp) {
    const prefix = (doc.match(/^[A-Za-z]+/) || [""])[0];
    prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
    salesmen.set(sp, (salesmen.get(sp) || 0) + 1);
    if (typeof netSales === "number") {
      totalNetSales += netSales;
      bySp[sp] = (bySp[sp] || 0) + netSales;
    }
    dataRows += 1;
  }
}

console.log(`Brand header rows: ${brandRowCount.count}`);
console.log(`Data rows: ${dataRows}`);
console.log(`Total net sales (col 15): RM ${totalNetSales.toLocaleString("en-MY", { minimumFractionDigits: 2 })}\n`);

console.log("Document-number prefixes seen:");
for (const [p, c] of [...prefixes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${p.padEnd(10)} ${c} rows`);
}

console.log("\nSalesman totals (net sales):");
for (const [sp, count] of [...salesmen.entries()].sort()) {
  const total = bySp[sp] || 0;
  console.log(`  ${sp.padEnd(24)} ${String(count).padStart(5)} rows   RM ${total.toLocaleString("en-MY", { minimumFractionDigits: 2 }).padStart(14)}`);
}
