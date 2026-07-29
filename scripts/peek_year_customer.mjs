import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const path = process.argv[2];
const wb = XLSX.read(readFileSync(path), { type: "buffer" });
console.log("Sheets:", wb.SheetNames);
const sheet = wb.Sheets[wb.SheetNames[0]];
const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
console.log("Total rows:", grid.length);
for (let i = 0; i < Math.min(grid.length, 15); i++) {
  const row = grid[i] || [];
  const nn = row.map((c, j) => c == null || c === "" ? null : `[${j}]=${JSON.stringify(c).slice(0,60)}`).filter(Boolean);
  console.log(`row ${i}: ${nn.slice(0, 10).join(" ")}${nn.length > 10 ? " …("+(nn.length-10)+")" : ""}`);
}
