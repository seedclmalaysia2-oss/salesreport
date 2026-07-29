import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const path = process.argv[2];
const wb = XLSX.read(readFileSync(path), { type: "buffer" });
const sheet = wb.Sheets[wb.SheetNames[0]];
const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

console.log("Header row (all non-null cells):");
grid[4]?.forEach((c, i) => { if (c != null && c !== "") console.log(`  [${i}] = ${JSON.stringify(c)}`); });

console.log("\nFirst data row (all non-null cells):");
grid[5]?.forEach((c, i) => { if (c != null && c !== "") console.log(`  [${i}] = ${JSON.stringify(c)}`); });

console.log("\nDistinct salesman values (guessing last populated col in row 5):");
const lastCol = Math.max(...grid.slice(5, 50).map(r => (r || []).length));
const salesmen = new Set();
for (const row of grid.slice(5, 400)) {
  if (!row) continue;
  const sm = row[lastCol - 1];
  if (typeof sm === "string" && sm.trim()) salesmen.add(sm.trim());
}
console.log(`  last col checked: ${lastCol - 1}`);
console.log(`  distinct salesmen: ${[...salesmen].sort().join(" | ")}`);
