// Brand code -> product category mapping for the Product Sales tab.
//
// EDIT ME: If a brand's rows show up in the wrong bucket on the Product Sales
// tab, add or move its prefix here. The classifier matches the LONGEST prefix
// that fits, so more-specific rules win over generic ones. Anything that
// doesn't match any prefix falls into "Other Product" — a design choice, not
// a bug, so a new brand appearing tomorrow can't crash the page.
//
// Categories are rendered in the order defined here — reorder to change the
// column order on the page.
//
// Mapping updated 2026-07-27 from the reviewed brand_categories_review.xlsx:
// Disop was renamed Spain (Disop's parent company is Spanish), Taiwan added
// as a new bucket for the MC/MNSF families, and the old EC/MHF/MTPR/2UWK
// families were reclassified as Japan.

export const CATEGORY_ORDER = [
  "Japan Product",
  "Spain Product",
  "Taiwan Product",
  "Ultravision Product",
  "Wohlk Product",
  "Other Product",
];

// Distinct accent per category, used for chart bars and the pill legend.
export const CATEGORY_COLORS = {
  "Japan Product":       "#E8633B", // Signal Orange — Seed / Japan
  "Spain Product":       "#34D399", // Ok Green — Disop
  "Taiwan Product":      "#EAB308", // Amber — Taiwanese lens maker
  "Ultravision Product": "#3B82F6", // Info Blue — UK
  "Wohlk Product":       "#A855F7", // Region Purple — Germany
  "Other Product":       "#94A3B8", // Neutral slate
};

// Order-preserving prefix rules. Each entry is [prefixOrRegex, category].
// - Prefix strings match case-insensitively at the start of the brand code.
// - RegExp entries are tested as-is (anchor with ^ for a true prefix match).
//
// SORTED_RULES below sorts these longest-first at load time so that e.g.
// 'SDDSPEY' beats 'SDDSP' beats 'SD' for the same code.
const PREFIX_RULES = [
  // ---- Other Product (specific SEED-branded promotional/accessory SKUs
  //      that the reviewer sits under Other, not Japan). These MUST be
  //      declared so the longer-prefix sort catches them before the
  //      generic 'SD*' / 'ACC*' fallthroughs.
  ["PRMSD",      "Other Product"],
  ["ACCSDCASE",  "Other Product"],
  ["SEVA",       "Other Product"],

  // ---- Spain Product (Disop-distributed) -----------------------------
  ["SDDSCL",     "Spain Product"],
  ["SDDSPEY",    "Spain Product"], // more specific than SDDSP
  ["SDDSP",      "Spain Product"],
  ["SDEYEDSP",   "Spain Product"],
  ["SDIRS",      "Spain Product"],
  ["SDSOL",      "Spain Product"],

  // ---- Taiwan Product (MC + MNSF families) ---------------------------
  ["MC",         "Taiwan Product"],
  ["MNSF",       "Taiwan Product"],

  // ---- Ultravision Product (UK) --------------------------------------
  ["UV",         "Ultravision Product"],

  // ---- Wohlk Product (Germany) --- only WHKES survives here after
  //      the reviewer moved the 2UWK family to Japan.
  ["WHK",        "Wohlk Product"],

  // ---- Japan Product (Seed lines + everything the reviewer marked
  //      Japan). Any SD* code not caught by the Spain rules above
  //      falls through to the generic 'SD' below.
  ["SD02",       "Japan Product"],
  ["SDASL",      "Japan Product"],
  ["SDBRH",      "Japan Product"],
  ["SDUV",       "Japan Product"],
  ["SD",         "Japan Product"], // catch-all for any remaining SD*
  ["1DPT",       "Japan Product"], // 1-Day Pure Toric (SEED)
  ["1DPE",       "Japan Product"],
  ["1DPR",       "Japan Product"],
  ["1DPS",       "Japan Product"],
  ["1DPV",       "Japan Product"],
  ["1MS",        "Japan Product"],
  ["2MS",        "Japan Product"],
  ["2UWK",       "Japan Product"], // reclassified from Wohlk
  ["EC",         "Japan Product"], // reclassified from Disop
  ["MHF",        "Japan Product"], // reclassified from Disop
  ["MTPR",       "Japan Product"], // reclassified from Disop

  // Anything else (JS*, PRM* other than PRMSD, ACC* other than the SEED
  // case above, CL, MARKETING, ODOCS) falls through to Other Product.
];

function normalise(code) {
  return String(code || "").trim().toUpperCase();
}

// Precomputed at module load — nothing at render time re-sorts.
const SORTED_RULES = [...PREFIX_RULES]
  .filter(r => typeof r[0] === "string")
  .sort((a, b) => b[0].length - a[0].length)
  .map(([p, c]) => [normalise(p), c]);

const REGEX_RULES = PREFIX_RULES.filter(r => r[0] instanceof RegExp);

export function categoryForBrand(code) {
  const key = normalise(code);
  if (!key) return "Other Product";
  for (const [rx, cat] of REGEX_RULES) {
    if (rx.test(code)) return cat;
  }
  for (const [prefix, cat] of SORTED_RULES) {
    if (key.startsWith(prefix)) return cat;
  }
  return "Other Product";
}

// Given brandSales rows [{sp, year, customer, brand, amt, qty}, …], returns
// an object of the shape:
//   { totalsBySp: { sp -> { category -> { amt, qty } } },
//     totalsByCategory: { category -> { amt, qty } },
//     spOrder: [ordered sp names],
//     categoriesUsed: [ordered categories that actually have data] }
export function aggregateProductSales(rows, { salespeople = [] } = {}) {
  const bySp = new Map();
  const byCat = new Map();
  for (const r of rows || []) {
    if (!r || !r.sp) continue;
    const amt = Number(r.amt) || 0;
    const qty = Number(r.qty) || 0;
    if (amt === 0 && qty === 0) continue;
    const cat = categoryForBrand(r.brand);
    if (!bySp.has(r.sp)) bySp.set(r.sp, new Map());
    const spMap = bySp.get(r.sp);
    const cur = spMap.get(cat) || { amt: 0, qty: 0 };
    cur.amt += amt;
    cur.qty += qty;
    spMap.set(cat, cur);
    const catCur = byCat.get(cat) || { amt: 0, qty: 0 };
    catCur.amt += amt;
    catCur.qty += qty;
    byCat.set(cat, catCur);
  }
  const totalsBySp = {};
  for (const [sp, spMap] of bySp) {
    totalsBySp[sp] = {};
    for (const [cat, v] of spMap) totalsBySp[sp][cat] = v;
  }
  const totalsByCategory = {};
  for (const [cat, v] of byCat) totalsByCategory[cat] = v;
  const spOrder = salespeople.length
    ? [...salespeople].filter(sp => bySp.has(sp))
    : [...bySp.keys()].sort();
  const categoriesUsed = CATEGORY_ORDER.filter(c => byCat.has(c));
  return { totalsBySp, totalsByCategory, spOrder, categoriesUsed };
}
