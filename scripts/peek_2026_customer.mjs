import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const path = process.argv[2] || "Sales & Forecast/Alan 2026 Sales Analysis by customer.xlsx";
const wb = XLSX.read(readFileSync(path), { type: "buffer" });
const sheet = wb.Sheets["Page 1"] || wb.Sheets[wb.SheetNames[0]];
const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

// Full header row (row 7)
console.log("--- Header row 7, all non-null cells ---");
grid[7]?.forEach((c, i) => { if (c != null && c !== "") console.log(`  [${i}] = ${JSON.stringify(c)}`); });

console.log("\n--- First data row (11), all non-null cells ---");
grid[11]?.forEach((c, i) => { if (c != null && c !== "") console.log(`  [${i}] = ${JSON.stringify(c)}`); });

console.log("\n--- Rows 11-14 col 3 (customer name candidate) ---");
for (let i = 11; i < 20; i++) if (grid[i]) console.log(`  row ${i} col3: ${JSON.stringify(grid[i][3])}`);
