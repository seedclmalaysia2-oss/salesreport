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

export const CATEGORY_ORDER = [
  "Japan Product",
  "Ultravision Product",
  "Disop Product",
  "Wohlk Product",
  "Other Product",
];

// Distinct accent per category, used for chart bars and the pill legend.
export const CATEGORY_COLORS = {
  "Japan Product":       "#E8633B", // Signal Orange — Seed's brand accent
  "Ultravision Product": "#3B82F6", // Info Blue
  "Disop Product":       "#34D399", // Ok Green
  "Wohlk Product":       "#A855F7", // Region Purple
  "Other Product":       "#94A3B8", // Neutral slate
};

// Order-preserving prefix rules. Each entry is [prefixOrRegex, category].
// - Prefix strings match case-insensitively at the start of the brand code.
// - RegExp entries are tested as-is (anchor them yourself with ^ if you
//   want a prefix match).
//
// Ordered longest-first so 'SDDSP' wins over 'SD' for the same code.
const PREFIX_RULES = [
  // ---- Japan Product (Seed and Seed-branded lines) --------------------
  // SEED contact lens families: 1-Day Pure, 2-Weekly, Fresh, etc.
  ["SDDSP",   "Japan Product"],
  ["SDEYEDSP","Japan Product"],
  ["SDSOL",   "Japan Product"],
  ["SDBRH",   "Japan Product"],
  ["SDASL",   "Japan Product"],
  ["SDDSCL",  "Japan Product"],
  ["SDIRS",   "Japan Product"],
  ["SDUV",    "Japan Product"],
  ["SD02",    "Japan Product"],
  ["SD",      "Japan Product"], // catch-all for any other SD*
  ["1DPT",    "Japan Product"], // 1-Day Pure Toric (SEED)
  ["1DPE",    "Japan Product"],
  ["1DPR",    "Japan Product"],
  ["1DPS",    "Japan Product"],
  ["1DPV",    "Japan Product"],
  ["1MS",     "Japan Product"], // 1-Month Silicone (SEED line)
  ["2MS",     "Japan Product"],
  ["PRMSD",   "Japan Product"], // Premium SEED SKUs
  ["ACCSDCASE", "Japan Product"],
  ["SEVA",    "Japan Product"],

  // ---- Ultravision Product -------------------------------------------
  ["UV",      "Ultravision Product"], // UVAPS, UVBDSP, UVDW*, UVHYS, UVKR*, UVSPL

  // ---- Wohlk Product -------------------------------------------------
  ["WHK",     "Wohlk Product"],
  ["2UWK",    "Wohlk Product"], // 2-Weekly Wohlk

  // ---- Disop Product -------------------------------------------------
  // Best-guess prefixes for Disop-distributed lines. Rewrite these if any
  // of the EC*/MC*/MHF*/MTP*/MNSF* codes should live elsewhere.
  ["EC",      "Disop Product"],
  ["MC",      "Disop Product"],
  ["MHF",     "Disop Product"],
  ["MTPR",    "Disop Product"],
  ["MNSF",    "Disop Product"],

  // Anything else (JS*, PRM* other than PRMSD, ACC* other than SEED cases,
  // CL, MARKETING, ODOCS) falls through to Other Product.
];

// Normalise the code once so lookups are cheap and case-insensitive.
function normalise(code) {
  return String(code || "").trim().toUpperCase();
}

// Sort rules by prefix length descending so a longer, more specific prefix
// wins over its shorter parent (e.g. 'SDDSP' before 'SD'). Precomputed at
// module load — nothing at render time re-sorts.
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
