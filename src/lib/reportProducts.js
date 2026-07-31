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

  // --- 1 Day Pure family ---
  { test: /^1D PURE SILFA/i,                   product: "1 DAY PURE SILFA" },
  { test: /^1D PURE EDOF/i,                    product: "1 DAYPURE EDOF" },
  { test: /^1D PURE (VIEW SUPPORT|VS)\b/i,     product: "1 DAY VIEW SUPPORT" },
  { test: /^1D PURE UP MS/i,                   product: "1 DAY MULSTISTAGE" },      // review: multistage
  { test: /^1DPT[\s-]/i,                        product: "1 DAY PURE ASTIGMATISM" }, // toric = astigmatism
  { test: /^1D PURE UP\b/i,                     product: "1 DAY PURE" },             // review: UP vs base
  { test: /^1D PURE\b/i,                        product: "1 DAY PURE" },

  // --- 2 Week Pure family ---
  { test: /^2W\w* PURE UP.*(MS|Multistage)/i,  product: "2 WEEK PURE MULTISTAGE" },
  { test: /^2UWKA/i,                            product: "2 WEEK PURE UP TORIC" },
  { test: /^2W\w* PURE UP/i,                    product: "2 WEEK PURE UP" },

  // --- Monthly ---
  { test: /^MCII-/i,                           product: "MONTHLY COLOR UV  II" },
  { test: /^MC-/i,                             product: "MONTHLY COLOR UV - BLUE" }, // REVIEW: colour→sub-line unknown
  { test: /MONTHLY FINE/i,                     product: "MONTHLY FINE PLUS" },
  { test: /MONTHLYPURE6/i,                     product: "MONTHLY PURE6" },
  { test: /MONTHLYPURE3/i,                     product: "MONTHLY PURE3" },

  // --- Minasoft ---
  { test: /MINASOFT Care UV/i,                 product: "MINASOFT CARE UV" },
  { test: /MINASOFT (BlueGray|RoseBrown|VIOLET|MN-VIOLET)/i, product: "MINASOFT 1DAY COLOR UV" }, // review

  // --- RGP / specialty ---
  { test: /UV-1( KC)? RGP|^SEED UV-1/i,        product: "RGP UV-1 / UV-1 KC" },
  { test: /AS[\s-]?LUNA|O2 NOAH/i,             product: "RGP AS-LUNA/O2 NOAH" },
  { test: /IRIS/i,                             product: "IRIS LENS" },
  { test: /^UV /i,                             product: "ULTRA VISION" },           // UV AVANTI/DURAWAVE/etc.
  { test: /BOC|ORTHO-?K/i,                     product: "BREATH O CORRECT" },       // review: overseas split
  { test: /Wohlk|WHCL/i,                       product: "Wohlk KE RGP" },

  // --- Solutions / drops ---
  { test: /DISOP.*(H2O2|H202)/i,               product: "DISOP H2O2 SOLUTION" },
  { test: /DISOP.*(ULTRA|ACUAISS ULTRA)/i,     product: "DISOP ULTRA EYEDROP" },
  { test: /DISOP/i,                            product: "DISOP H2O2 SOLUTION" },    // REVIEW: DUAL GEL / HidroHealth
];

export function brandToProduct(name) {
  if (!name || typeof name !== "string") return null;
  if (isFreeOrSample(name)) return null;
  const s = name.trim();
  if (/^NA$/i.test(s)) return null;
  for (const r of RULES) if (r.test.test(s)) return r.product;
  return null; // unmapped — surfaced to the admin, never silently counted
}

// SKUs whose mapping is a guess and needs a human's eye (shown in the review UI).
export const REVIEW_NOTES = [
  "MC-* colours currently all map to 'MONTHLY COLOR UV - BLUE' — the PEGAVISION/BLUE/ORANGE split is unknown.",
  "MINASOFT colour SKUs (BlueGray/RoseBrown/Violet) map to 'MINASOFT 1DAY COLOR UV' — confirm vs CARE UV.",
  "DISOP DUAL GEL / AQUA GEL / HidroHealth fall through to 'DISOP H2O2 SOLUTION' — confirm the right row.",
  "'1D PURE UP' and '1D PURE UP MS' — confirm 1 DAY PURE vs MULTISTAGE.",
  "BREATH O CORRECT overseas split not detected — all Ortho-K maps to the domestic row.",
];
