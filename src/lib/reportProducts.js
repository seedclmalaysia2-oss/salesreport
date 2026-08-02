// HQ "SEED(M) Sales Summary" report — product model.
//
// The HQ monthly report groups sales into ~31 named products (see REPORT_PRODUCTS),
// but the raw Stock Sales Analysis - Detail export lists ~130+ granular SKU brand
// names (colour/power/toric variants, FOC tie-in goods, samples). brandToProduct()
// folds each SKU name onto its report product so we can build the monthly grid.
//
// FOC ("tie in goods") and SAMPLE lines are free — excluded from sales entirely.
// Anything unrecognised returns null and is reported to the admin as "unmapped"
// so nothing is silently dropped or mis-attributed.
//
// This mapping is first-pass and MUST be reviewed against the HQ report by someone
// who knows the catalogue — the ambiguous cases are flagged in REVIEW_NOTES.

// The report's product rows, in the exact order they appear on the sheet.
export const REPORT_PRODUCTS = [
  "1 DAY PURE",
  "1 DAY PURE SILFA",
  "1 DAY PURE ASTIGMATISM",
  "1 DAY MULSTISTAGE",
  "1 DAYPURE EDOF",
  "1 DAY VIEW SUPPORT",
  "2 WEEK PURE MULTISTAGE",
  "2 WEEK PURE UP TORIC",
  "2 WEEK PURE UP",
  "EYE COFFRET-M",
  "EYE COFFRET-M 10 TORIC",
  "EYE COFFRET-M 30 TORIC",
  "MONTHLY FINE PLUS",
  "MONTHLY PURE3",
  "MONTHLY PURE6",
  "MONTHLY COLOR UV - PEGAVISION",
  "MONTHLY COLOR UV - BLUE",
  "MONTHLY COLOR UV - ORANGE",
  "MONTHLY COLOR UV  II",
  "MINASOFT 1DAY COLOR UV",
  "MINASOFT CARE UV",
  "RGP UV-1 / UV-1 KC",
  "RGP AS-LUNA/O2 NOAH",
  "IRIS LENS",
  "ULTRA VISION",
  "BREATH O CORRECT",
  "BREATH O CORRECT (OVERSEAS)",
  "Wohlk KE RGP",
  "DISOP H2O2 SOLUTION",
  "DISOP ULTRA EYEDROP",
  "ACCESSORIES/OTHERS",
];

// Free-of-charge / sample lines carry quantity but no real revenue. Drop them.
export function isFreeOrSample(name) {
  return /FOC tie in goods|\bSAMPLE\b/i.test(name || "");
}

// Ordered rules — first match wins, so put the most specific patterns first.
// `test` runs against the SKU brand name; `product` is the report row it feeds.
const RULES = [
  // --- Eye Coffret toric (must precede the plain EC*-M make rule) ---
  { test: /^EC\w*10-?M?\s*TORIC|^ECWT10-M/i, product: "EYE COFFRET-M 10 TORIC" },
  { test: /^EC\w*30-?M?\s*TORIC|Toric 30[RW]/i, product: "EYE COFFRET-M 30 TORIC" },
  { test: /^EC[A-Z]*\d*-M\b/i,                 product: "EYE COFFRET-M" },
  { test: /Eye Coffret-M/i,                    product: "EYE COFFRET-M" },
  // Eye Coffret makes & trial lenses without the "-M" suffix (ECB/ECN/ECR, EC10/EC30).
  { test: /^EC(B|N|R|W|D|10|30|WT)/i,          product: "EYE COFFRET-M" },

  // --- 1 Day Pure family ---
  { test: /^1D PURE SILFA/i,                   product: "1 DAY PURE SILFA" },
  { test: /^1D PURE EDOF/i,                    product: "1 DAYPURE EDOF" },
  { test: /^1D PURE (VIEW SUPPORT|VS)\b/i,     product: "1 DAY VIEW SUPPORT" },
  { test: /^1D PURE UP MS/i,                   product: "1 DAY MULSTISTAGE" },      // multistage
  { test: /^1D PURE UP TORIC/i,                product: "1 DAY PURE ASTIGMATISM" }, // UP toric = astigmatism
  { test: /^1DPT[\s-]/i,                        product: "1 DAY PURE ASTIGMATISM" }, // toric = astigmatism
  { test: /^1D PURE UP\b/i,                     product: "1 DAY PURE" },             // plain UP = base
  { test: /^1D PURE\b/i,                        product: "1 DAY PURE" },

  // --- 2 Week Pure family ---
  { test: /^2W\w* PURE UP.*(MS|Multistage)/i,  product: "2 WEEK PURE MULTISTAGE" },
  { test: /^2UWKA/i,                            product: "2 WEEK PURE UP TORIC" },
  { test: /^2W\w* PURE UP/i,                    product: "2 WEEK PURE UP" },

  // --- Monthly Color: MCII- is the "II" line; MC- splits by colour (HQ mapping) ---
  { test: /^MCII-/i,                           product: "MONTHLY COLOR UV  II" },
  { test: /^MC-(COCOA|GOLD|PINK|GRAY|DGRY)/i,  product: "MONTHLY COLOR UV - PEGAVISION" },
  { test: /^MC-(NAT|GLIT|FIRE)/i,              product: "MONTHLY COLOR UV - BLUE" },
  { test: /^MC-(SPARK|JADE|SHINING)/i,         product: "MONTHLY COLOR UV - ORANGE" },
  { test: /MONTHLY FINE/i,                     product: "MONTHLY FINE PLUS" },
  { test: /MONTHLYPURE6/i,                     product: "MONTHLY PURE6" },
  { test: /MONTHLYPURE3/i,                     product: "MONTHLY PURE3" },
  { test: /^MonthlyPure\b/i,                   product: "MONTHLY PURE6" }, // bare "MonthlyPure Trial" → Pure6 (HQ)

  // --- Minasoft: "MINASOFT ..." full names and the "MN-" SKU codes (HQ mapping) ---
  { test: /MINASOFT Care UV|^MN-?\s*Care/i,    product: "MINASOFT CARE UV" },
  { test: /MINASOFT (BlueGray|RoseBrown|VIOLET|MN-VIOLET)|^MN-/i, product: "MINASOFT 1DAY COLOR UV" },

  // --- RGP / specialty ---
  { test: /UV-1( KC)? RGP|^SEED UV-1/i,        product: "RGP UV-1 / UV-1 KC" },
  { test: /AS[\s-]?LUNA|O2 NOAH/i,             product: "RGP AS-LUNA/O2 NOAH" },
  { test: /IRIS/i,                             product: "IRIS LENS" },
  { test: /^UV /i,                             product: "ULTRA VISION" },           // UV AVANTI/DURAWAVE/etc.
  { test: /Glodisa/i,                          product: "BREATH O CORRECT (OVERSEAS)" }, // HQ: Glodisa = overseas
  { test: /BOC|ORTHO-?K/i,                     product: "BREATH O CORRECT" },       // all other Ortho-K = local
  { test: /Wohlk|WHCL/i,                       product: "Wohlk KE RGP" },

  // --- DISOP solutions / drops (HQ: DUAL GEL & ACUAISS are eyedrop; HidroHealth is H2O2) ---
  { test: /DISOP.*(ULTRA|DUAL GEL|ACUAISS)/i,  product: "DISOP ULTRA EYEDROP" },
  { test: /DISOP.*(H2O2|H202|HidroHealth)/i,   product: "DISOP H2O2 SOLUTION" },
  { test: /DISOP/i,                            product: "DISOP H2O2 SOLUTION" },

  // --- Accessories, services & other income (non-lens lines, per HQ) ---
  { test: /\bSEVA\b|Correct Clean|Contact Lens|ACCESSOR|\bACCSD?\b|\bACC\b/i, product: "ACCESSORIES/OTHERS" },
  { test: /COURIER|\bSERVICES?\b/i,            product: "OTHER INCOME" },
];

// 'OTHER INCOME' is an amount-only row in the report (below ACCESSORIES/OTHERS
// in the SALES AMOUNT section) — it never appears in the quantity grid.
export const AMOUNT_ONLY_ROWS = ["OTHER INCOME"];

// Trial units (SKU tag "TR") are counted in PIECES in the export but the report
// wants BOXES. Divide a product's trial pieces by its pack size to convert.
// Genuine FOC product boxes (contact lenses) count as-is; promotional giveaways
// (pens/bags/thermos) are excluded. Pack sizes per HQ (2026-07-31):
export const TRIAL_PCS_PER_BOX = {
  "1 DAY PURE": 32, "1 DAY PURE SILFA": 32, "1 DAY PURE ASTIGMATISM": 32,
  "1 DAY MULSTISTAGE": 32, "1 DAYPURE EDOF": 32, "1 DAY VIEW SUPPORT": 32,
  "MONTHLY COLOR UV - PEGAVISION": 2, "MONTHLY COLOR UV - BLUE": 2,
  "MONTHLY COLOR UV - ORANGE": 2, "MONTHLY COLOR UV  II": 2,
  "MINASOFT 1DAY COLOR UV": 10, "MINASOFT CARE UV": 3,
  "MONTHLY PURE6": 6, "MONTHLY FINE PLUS": 3,
  "EYE COFFRET-M": 10, "EYE COFFRET-M 10 TORIC": 10, "EYE COFFRET-M 30 TORIC": 10,
};

export function brandToProduct(name) {
  if (!name || typeof name !== "string") return null;
  if (isFreeOrSample(name)) return null;
  const s = name.trim();
  if (/^NA$/i.test(s)) return null;
  for (const r of RULES) if (r.test.test(s)) return r.product;
  return null; // unmapped — surfaced to the admin, never silently counted
}

// Roll Stock-Detail lines up into the HQ monthly grid.
// `rows` are parsed Stock-Detail rows: { date:"YYYY-MM-DD", brand, qty, amount, sp }.
// Returns { products, unmapped, months } where products[name] = { qty:[12], amount:[12] }
// (calendar-month index 0=Jan) and `unmapped` lists brand → totals that matched no
// report row, so the admin can see (and we can fix) anything falling through.
export function aggregateProductMonthly(rows, year) {
  const products = {};
  const unmapped = {};
  for (const r of rows || []) {
    if (!r || !r.date) continue;
    const [y, m] = r.date.split("-").map(Number);
    if (y !== year || !(m >= 1 && m <= 12)) continue;
    const i = m - 1;
    const name = r.brand;
    if (!name) continue;
    // Promotional giveaways (pens/bags/thermos) are never counted. Evaluation
    // SAMPLE lines are dropped too — EXCEPT DISOP solution samples, which HQ
    // counts as distributed product (quantity only; revenue is 0). Within DISOP
    // the 60ml H2O2 sample is the one that stays excluded.
    if (/Promotion Use/i.test(name)) continue;
    const isDisop = /DISOP/i.test(name);
    if (/\bSAMPLE\b/i.test(name)) {
      if (!isDisop) continue;
      if (/\b60\s*ML\b/i.test(name)) continue;
    }
    // Classify by the underlying product: strip the FOC tie-in and SAMPLE tags.
    const clean = name
      .replace(/\[?\s*FOC tie in goods\s*\]?.*$/i, "")
      .replace(/\bSAMPLE\b/ig, "")
      .trim();
    const product = brandToProduct(clean);
    const amount = Number(r.amount) || 0;
    let qty = Number(r.qty) || 0;
    if (!product) {
      const u = unmapped[r.brand] || (unmapped[r.brand] = { qty: 0, amount: 0 });
      u.qty += qty; u.amount += amount;
      continue;
    }
    // Report quantity is in BOXES/BOTTLES. Trial-lens lines (SKU code "TR" /
    // "Trial") are counted in PIECES — convert to boxes by pack size. DISOP is
    // counted in bottles, and its vial lines (UOM=PCS) are 20 vials = 1 bottle.
    // Everything else is already in boxes/bottles and counts as-is.
    if (/\btrial\b/i.test(name) && TRIAL_PCS_PER_BOX[product]) qty = qty / TRIAL_PCS_PER_BOX[product];
    else if (isDisop && /^(PCS|PCE|PIECE|PC\b)/i.test(String(r.uom || "").trim())) qty = qty / 20;
    const p = products[product] ||
      (products[product] = { qty: new Array(12).fill(0), amount: new Array(12).fill(0) });
    p.qty[i] += qty;
    p.amount[i] += amount;
  }
  // round to 2dp so floating error doesn't leak into the export
  for (const p of Object.values(products)) {
    p.qty = p.qty.map(v => Math.round(v * 100) / 100);
    p.amount = p.amount.map(v => Math.round(v * 100) / 100);
  }
  return { products, unmapped };
}

// Remaining items to watch (confirmed rules above are per HQ 2026-07-31).
export const REVIEW_NOTES = [
  "BREATH O CORRECT (OVERSEAS) has no rule yet — stays 0 until HQ sends the overseas file.",
  "Pegavision colours beyond Cocoa (Gold/Pink Brown, Gray) aren't in the sample file — rules will catch them by name if they appear.",
  "MINASOFT colour SKUs (BlueGray/RoseBrown/Violet) map to 'MINASOFT 1DAY COLOR UV' — confirm vs CARE UV once seen in a report.",
  "ACC/ACCSD accessory rule matches the brand name; if accessories are coded elsewhere in the export we'll revisit during aggregation.",
];
