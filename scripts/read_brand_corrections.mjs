// Compare the classifier in src/lib/productCategories.js against every row of
// the reviewer's xlsx. Reports any brand where the two disagree, so I can tell
// whether the mapping matches the source of truth or still needs work.
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { categoryForBrand, CATEGORY_ORDER } from "../src/lib/productCategories.js";

const path = "C:/Users/Expert/OneDrive/Documents/brand_categories_review_new.xlsx";
const rows = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(path), { type: "buffer" }).Sheets["Brand Categories"], { defval: null });
const cols = Object.keys(rows[0] || {});
const brandCol   = cols.find(c => /brand/i.test(c) && /code/i.test(c));
const currentCol = cols.find(c => /current/i.test(c));
const correctedCol = cols.find(c => /correct/i.test(c));

let disagreements = 0;
const catCounts = Object.fromEntries(CATEGORY_ORDER.map(c => [c, 0]));
for (const r of rows) {
  const brand = r[brandCol]; if (!brand) continue;
  const target = (r[correctedCol] && String(r[correctedCol]).trim())
              || (r[currentCol]   && String(r[currentCol]).trim())
              || null;
  if (!target || !CATEGORY_ORDER.includes(target)) {
    console.log(`  ⚠ ${brand.padEnd(28)} — no valid category in the file ('${target}')`);
    continue;
  }
  const guess = categoryForBrand(brand);
  catCounts[guess] += 1;
  if (guess !== target) {
    disagreements += 1;
    console.log(`  ✗ ${brand.padEnd(28)} classifier: ${guess.padEnd(20)} file: ${target}`);
  }
}
console.log(`\n=== Classifier vs file ===`);
console.log(`${rows.length} rows checked · ${disagreements} disagreement${disagreements === 1 ? "" : "s"}`);
console.log(`\nClassifier's distribution:`);
for (const c of CATEGORY_ORDER) console.log(`  ${c.padEnd(24)} ${catCounts[c]}`);
