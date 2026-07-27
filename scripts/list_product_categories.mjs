import { readFileSync } from "fs";
import { categoryForBrand, CATEGORY_ORDER } from "../src/lib/productCategories.js";

const data = JSON.parse(readFileSync("./src/data.json", "utf8"));
const brands = [...new Set(data.brandSales.map(r => r.brand))].sort();
const buckets = Object.fromEntries(CATEGORY_ORDER.map(c => [c, []]));
for (const b of brands) buckets[categoryForBrand(b)].push(b);
for (const cat of CATEGORY_ORDER) {
  const list = buckets[cat];
  console.log(`=== ${cat}  (${list.length} brands) ===`);
  console.log(list.join(", "));
  console.log();
}
