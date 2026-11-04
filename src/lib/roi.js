// Store ROI: what each store sold, what it was given in Sales Trial lenses, and
// what that support returned. Pure functions behind the ROI tab.
//
// Trial lenses go out two ways:
//   Sales Trial (tie in goods)  sent on the invoice, so it is in the sales reports.
//                               This is what every "trial" figure here means.
//   PRM Trial (tie in PRM)      issued on PRM documents, outside sales. Not in the
//                               dashboard's data, so never counted here.
//
// Inputs are data the dashboard already loads:
//   groupRows  { year, customer, sp, group, amount, qty }  customer x Stock-Group
//   customers  { year, customer, sp, months[12] }           for same-months trend
//   costRows   { year, product, cost, cost_qty }            Stock-Detail roll-up
//
// Trial lines are counted in PIECES and carry no revenue. Sold lines are BOXES.
// PRM lines are free BOXES, which are promo goods rather than trial lenses, so
// they are reported on their own and never count towards trial usage.

import { TRIAL_PCS_PER_BOX } from "./reportProducts.js";

export const ROI_CONFIG = {
  // Trial boxes per box sold. Owner's decision 2026-11-04: typical stores run at
  // about 30% and the company average is about 26%, so 30% singles stores out.
  allowance: 0.3,
  reviewMultiple: 1.5,    // usage above allowance x this (45%) is always a Review
  growing: 0.05,          // same-months sales change that counts as growing
  falling: -0.05,         // ...and as falling
  minBoxes: 24,           // fewer boxes sold than this is too small to judge
  minTrialBoxes: 2,       // ...unless this many trial boxes went in regardless
  untappedMinSales: 20000,// a store this big with almost no trial use is untapped
  untappedMaxUsage: 0.05,
  highRoi: 15,            // RM gross profit per RM1 trial (typical store: about 9)
};

export const VERDICTS = {
  review:   { label: "Review",    action: "Sales Trial over allowance without the sales to show for it" },
  coach:    { label: "Coach",     action: "Sales Trial over allowance, but sales are growing" },
  grow:     { label: "Grow",      action: "Within allowance and paying back" },
  untapped: { label: "Untapped",  action: "Big store using almost no Sales Trial" },
  keep:     { label: "Keep",      action: "Within allowance and steady" },
  small:    { label: "Too small", action: "Too few boxes to judge" },
};
export const VERDICT_ORDER = ["review", "coach", "grow", "untapped", "keep", "small"];

// Every lens line with trial or promo activity. `products` are the HQ report
// names that hold its cost (first with a cost wins). A line with no `products`
// has no known cost and is reported as such, never given a guessed one.
const pack = (p) => TRIAL_PCS_PER_BOX[p];
export const LENS_LINES = [
  { key: "1dp",    label: "1 Day Pure",            products: ["1 DAY PURE"],             pack: pack("1 DAY PURE"),             sold: ["1DPR", "1DPRF"], trial: ["1DTR", "1DPRFT"], free: ["1DPRPRM", "1DPRFLPRM"] },
  { key: "1dpt",   label: "1 Day Pure Astigmatism",products: ["1 DAY PURE ASTIGMATISM"], pack: pack("1 DAY PURE ASTIGMATISM"), sold: ["1DPT"], trial: ["1DTT"], free: ["1DPTPRM"] },
  { key: "1dms",   label: "1 Day Multistage",      products: ["1 DAY MULSTISTAGE"],      pack: pack("1 DAY MULSTISTAGE"),      sold: ["1DMS"], trial: ["1MTR"], free: ["1DMSPRM"] },
  { key: "1dpe",   label: "1 Day Pure EDOF",       products: ["1 DAYPURE EDOF"],         pack: pack("1 DAYPURE EDOF"),         sold: ["1DPE"], trial: ["1DPETR"], free: ["1DPEPRM"] },
  { key: "1dps",   label: "1 Day Pure Silfa",      products: ["1 DAY PURE SILFA"],       pack: pack("1 DAY PURE SILFA"),       sold: ["1DPS"], trial: ["1DPSTR"], free: ["1DPSPRM"] },
  { key: "1dvs",   label: "1 Day View Support",    products: ["1 DAY VIEW SUPPORT"],     pack: pack("1 DAY VIEW SUPPORT"),     sold: ["1DPVS"], trial: ["1DTRVS"], free: ["1DPRVSPRM"] },
  { key: "2wup",   label: "2 Week Pure UP",        products: ["2 WEEK PURE UP"],         pack: pack("2 WEEK PURE UP"),         sold: ["2UWK"], trial: [], free: ["2UWKPRM"] },
  { key: "2wt",    label: "2 Week Pure Toric",     products: ["2 WEEK PURE UP TORIC"],   pack: pack("2 WEEK PURE UP TORIC"),   sold: ["2WPT"], trial: ["2UWKAT", "2UWT", "2WKUT"], free: ["2WPTPRM"] },
  { key: "2wms",   label: "2 Week Multistage",     products: ["2 WEEK PURE MULTISTAGE"], pack: pack("2 WEEK PURE MULTISTAGE"), sold: ["2WMS"], trial: [], free: ["2WMSPRM"] },
  { key: "ec",     label: "Eye Coffret-M",         products: ["EYE COFFRET-M"],          pack: pack("EYE COFFRET-M"),          sold: ["EC10-M", "EC10"], trial: ["ECTR", "EC-MT"], free: ["EC10-MPRM", "ECPRM", "ECR30-MPRM"] },
  { key: "ec10t",  label: "Eye Coffret 10 Toric",  products: ["EYE COFFRET-M 10 TORIC"], pack: pack("EYE COFFRET-M 10 TORIC"), sold: ["ECRT10-M", "ECWT10-M"], trial: ["ECRT-MT", "ECWT-MT"], free: ["ECRT10-MPRM"] },
  { key: "ec30t",  label: "Eye Coffret 30 Toric",  products: ["EYE COFFRET-M 30 TORIC"], pack: pack("EYE COFFRET-M 30 TORIC"), sold: ["ECRT30-M", "ECWT30-M"], trial: [], free: ["ECRT30-MPRM", "ECWT30-MPRM"] },
  { key: "mcuv",   label: "Monthly Color UV",      products: ["MONTHLY COLOR UV - BLUE", "MONTHLY COLOR UV - ORANGE", "MONTHLY COLOR UV - PEGAVISION"], pack: pack("MONTHLY COLOR UV - BLUE"), sold: ["MCUV"], trial: ["MCUVT"], free: ["MCUPRM", "PRMMC", "PRMMCKT"] },
  { key: "mcuv2",  label: "Monthly Color UV II",   products: ["MONTHLY COLOR UV  II"],   pack: pack("MONTHLY COLOR UV  II"),   sold: ["MCUV2"], trial: ["MCUV2T"], free: ["MCIIPRM"] },
  { key: "mnsf",   label: "Minasoft 1Day Color",   products: ["MINASOFT 1DAY COLOR UV"], pack: pack("MINASOFT 1DAY COLOR UV"), sold: ["MNSF10"], trial: ["MNSFTR"], free: ["MNSFPRM"] },
  { key: "mnsfc",  label: "Minasoft Care UV",      products: ["MINASOFT CARE UV"],       pack: pack("MINASOFT CARE UV"),       sold: ["MNSFCUV"], trial: ["MNSFCUVTR"], free: ["MNSFCUVPRM"] },
  { key: "mtpr",   label: "Monthly Pure 6",        products: ["MONTHLY PURE6"],          pack: pack("MONTHLY PURE6"),          sold: ["MTPR"], trial: ["MTPRT"], free: ["MTPRPRM"] },
  { key: "mtpr3",  label: "Monthly Pure 3",        products: ["MONTHLY PURE3"],          pack: 3,                              sold: ["MTPR3"], trial: [], free: ["MTPRPRM3"] },
  { key: "mfn",    label: "Monthly Fine Plus",     products: ["MONTHLY FINE PLUS"],      pack: pack("MONTHLY FINE PLUS"),      sold: ["MFN+", "MTFN"], trial: ["MHFT+", "MHFT"], free: ["MHFPRM+", "MHFPRM"] },
  { key: "js",     label: "JS 10",                 products: [],                         pack: 10,                             sold: ["JS10"], trial: ["JSTR"], free: ["JS10PRM"] },
];

const CODE_INDEX = new Map();
for (const line of LENS_LINES) {
  for (const kind of ["sold", "trial", "free"]) {
    for (const code of line[kind]) CODE_INDEX.set(code, { line, kind });
  }
}

// Non-lens groups the page knows about: they add to a store's sales and nothing else.
const NON_LENS = /^(ACC|SD|UV|WOHLK|CL$|COURIER$|DSHHCL$|MARKETING$|SERVICE CHARGE$|PRM)/i;

const nameKey = (s) => String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
const r2 = (v) => Math.round(v * 100) / 100;

// year -> product -> average RM cost per box. A year with no cost for a product
// falls back to that product's most recent year.
export function buildCostIndex(costRows) {
  const byYear = new Map();
  for (const r of costRows || []) {
    const cost = Number(r.cost) || 0;
    const qty = Number(r.cost_qty) || 0;
    if (!cost || !qty) continue;
    if (!byYear.has(r.year)) byYear.set(r.year, new Map());
    const m = byYear.get(r.year);
    const e = m.get(r.product) || { cost: 0, qty: 0 };
    e.cost += cost; e.qty += qty;
    m.set(r.product, e);
  }
  return byYear;
}

export function costPerBox(index, year, line) {
  if (!index || !line?.products?.length) return null;
  const years = [year, ...[...index.keys()].filter(y => y !== year).sort((a, b) => b - a)];
  for (const y of years) {
    const m = index.get(y);
    if (!m) continue;
    let cost = 0, qty = 0;
    for (const p of line.products) {
      const e = m.get(p);
      if (e && e.qty > 0 && e.cost > 0) { cost += e.cost; qty += e.qty; }
    }
    if (qty > 0) return cost / qty;
  }
  return null;
}

// How many calendar months of `year` have any sales: the window a part-year is
// compared over, so January to August 2026 meets January to August 2025.
export function monthsWithSales(customers, year) {
  let last = 0;
  for (const r of customers || []) {
    if (r.year !== year) continue;
    (r.months || []).forEach((v, i) => { if ((Number(v) || 0) !== 0 && i + 1 > last) last = i + 1; });
  }
  return last;
}

function periodSales(customers, year, months, sp) {
  const m = new Map();
  for (const r of customers || []) {
    if (r.year !== year || (sp && r.sp !== sp)) continue;
    const k = nameKey(r.customer);
    const sum = (r.months || []).slice(0, months).reduce((a, v) => a + (Number(v) || 0), 0);
    m.set(k, (m.get(k) || 0) + sum);
  }
  return m;
}

export function verdictFor(s, cfg = ROI_CONFIG) {
  const overReview = s.usage > cfg.allowance * cfg.reviewMultiple;
  const over = s.usage > cfg.allowance;
  if (s.boxes < cfg.minBoxes) {
    return overReview && s.trialBoxes >= cfg.minTrialBoxes ? "review" : "small";
  }
  if (overReview) return "review";
  if (over) {
    // A new store has no last year to compare with, so give it room as Coach.
    if (s.growth == null) return "coach";
    return s.growth >= cfg.growing ? "coach" : "review";
  }
  if (s.sales >= cfg.untappedMinSales && s.usage <= cfg.untappedMaxUsage) return "untapped";
  if (s.growth != null && s.growth >= cfg.growing) return "grow";
  if (s.roi != null && s.roi >= cfg.highRoi && (s.growth == null || s.growth > cfg.falling)) return "grow";
  return "keep";
}

const rm = (v) => `RM ${Math.round(v).toLocaleString("en-MY")}`;
const pc = (v) => `${(v * 100).toFixed(1)}%`;
const allowancePc = (cfg) => `${Math.round(cfg.allowance * 100)}%`;

// One plain-language instruction per store, using that store's own numbers.
export function adviceFor(s, cfg = ROI_CONFIG) {
  const trend = s.growth == null ? "no sales last year to compare" : s.growth >= 0 ? `sales up ${Math.round(s.growth * 100)}%` : `sales down ${Math.round(-s.growth * 100)}%`;
  const overBoxes = Math.round(s.overBoxes);
  const overText = s.overCost != null ? `about ${overBoxes} boxes (${rm(s.overCost)}) over` : `about ${overBoxes} boxes over`;
  switch (s.verdict) {
    case "review":
      return !(s.boxes > 0)
        ? `Sales Trial lenses went in, but returns cancelled out the boxes sold. Stop top-ups until orders pick up again.`
        : s.growth != null && s.growth >= cfg.growing
        ? `Sales are growing, but Sales Trial is well past allowance. Cut back to new fits only: ${pc(s.usage)} against ${allowancePc(cfg)}, ${overText}, ${trend}.`
        : `Pause Sales Trial top-ups and agree a plan: ${pc(s.usage)} against ${allowancePc(cfg)}, ${overText}, ${trend}.`;
    case "coach":
      return `Sales Trial is working but running high. Keep it to new fits only: ${pc(s.usage)}, ${overText}, ${trend}.`;
    case "grow":
      return s.growth != null && s.growth >= cfg.growing
        ? `Give this store more support: ${trend} while Sales Trial sits at ${pc(s.usage)}, within allowance.`
        : `Strong return on Sales Trial at ${pc(s.usage)}. Worth more support to restart growth.`;
    case "untapped":
      return `Offer a trial push: ${rm(s.sales)} in sales with only ${pc(s.usage)} Sales Trial use.`;
    case "keep":
      return s.growth != null && s.growth <= cfg.falling
        ? `Sales Trial use is fine at ${pc(s.usage)}, so look elsewhere for the drop: ${trend}. Plan a visit.`
        : `Keep support as it is: ${pc(s.usage)} Sales Trial use, ${trend}.`;
    default:
      return s.sales >= cfg.untappedMinSales
        ? `Most of ${rm(s.sales)} in sales is not soft lenses, so Sales Trial use doesn't apply here.`
        : `Only ${Math.round(s.boxes)} boxes sold. Too few to judge, so check again next quarter.`;
  }
}

function emptyTotals() {
  return { sales: 0, lensSales: 0, boxes: 0, trialBoxes: 0, trialPieces: 0, freeBoxes: 0, trialCost: 0, grossProfit: 0, overCost: 0, overBoxes: 0 };
}

export function buildStoreRoi({ groupRows, customers, costRows, year, sp = null, cfg = ROI_CONFIG }) {
  const costIndex = buildCostIndex(costRows);
  const costAvailable = costIndex.size > 0;
  const months = monthsWithSales(customers, year);
  const curPeriod = periodSales(customers, year, months, sp);
  const prevPeriod = periodSales(customers, year - 1, months, sp);

  const raw = new Map(); // name key -> store accumulator
  const unknownCodes = new Map();
  for (const r of groupRows || []) {
    if (r.year !== year || (sp && r.sp !== sp)) continue;
    const key = nameKey(r.customer);
    if (!key) continue;
    let s = raw.get(key);
    if (!s) { s = { customer: String(r.customer).trim(), key, sales: 0, bySp: new Map(), lines: new Map() }; raw.set(key, s); }
    const amount = Number(r.amount) || 0;
    const qty = Number(r.qty) || 0;
    s.sales += amount;
    if (r.sp) s.bySp.set(r.sp, (s.bySp.get(r.sp) || 0) + amount);
    const hit = CODE_INDEX.get(String(r.group || "").trim());
    if (!hit) {
      if (!NON_LENS.test(String(r.group || "").trim())) {
        const u = unknownCodes.get(r.group) || { code: r.group, amount: 0, qty: 0 };
        u.amount += amount; u.qty += qty;
        unknownCodes.set(r.group, u);
      }
      continue;
    }
    let l = s.lines.get(hit.line.key);
    if (!l) { l = { line: hit.line, sold: 0, amount: 0, pieces: 0, free: 0 }; s.lines.set(hit.line.key, l); }
    if (hit.kind === "sold") { l.sold += qty; l.amount += amount; }
    else if (hit.kind === "trial") l.pieces += qty;
    else l.free += qty;
  }

  const stores = [];
  for (const s of raw.values()) {
    let boxes = 0, trialBoxes = 0, trialPieces = 0, freeBoxes = 0, lensSales = 0;
    let trialCost = 0, grossProfit = 0, costMissing = false;
    const lines = [];
    for (const l of s.lines.values()) {
      const trial = l.pieces / l.line.pack;
      const unit = costPerBox(costIndex, year, l.line);
      if (unit == null && (trial > 0 || l.sold > 0)) costMissing = true;
      if (unit != null) {
        trialCost += trial * unit;
        grossProfit += l.amount - l.sold * unit;
      }
      boxes += l.sold; trialBoxes += trial; trialPieces += l.pieces; freeBoxes += l.free; lensSales += l.amount;
      lines.push({
        key: l.line.key, label: l.line.label, pack: l.line.pack,
        sold: l.sold, amount: r2(l.amount), pieces: l.pieces, trialBoxes: trial, freeBoxes: l.free,
        usage: l.sold > 0 ? trial / l.sold : (trial > 0 ? Infinity : 0),
        costPerBox: unit, trialCost: unit == null ? null : trial * unit,
      });
    }
    lines.sort((a, b) => b.trialBoxes - a.trialBoxes || b.sold - a.sold);

    const usage = boxes > 0 ? trialBoxes / boxes : (trialBoxes > 0 ? Infinity : 0);
    const overBoxes = Math.max(0, trialBoxes - Math.max(boxes, 0) * cfg.allowance);
    const hasCost = costAvailable && trialCost > 0;
    const cur = curPeriod.get(s.key);
    const prev = prevPeriod.get(s.key);
    const growth = prev > 0 && cur != null ? (cur - prev) / prev : null;

    const store = {
      customer: s.customer,
      sp: [...s.bySp.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      sales: r2(s.sales), lensSales: r2(lensSales),
      boxes, trialBoxes, trialPieces, freeBoxes, usage,
      overBoxes,
      trialCost: hasCost ? trialCost : null,
      overCost: hasCost && trialBoxes > 0 ? (trialCost / trialBoxes) * overBoxes : null,
      grossProfit: hasCost ? grossProfit : null,
      roi: hasCost ? grossProfit / trialCost : null,
      costPartial: hasCost && costMissing,
      growth, periodSales: cur ?? null, prevPeriodSales: prev ?? null,
      lines,
    };
    store.verdict = verdictFor(store, cfg);
    store.advice = adviceFor(store, cfg);
    stores.push(store);
  }

  const totals = emptyTotals();
  const segments = Object.fromEntries(VERDICT_ORDER.map(v => [v, { verdict: v, stores: 0, sales: 0, overCost: 0 }]));
  for (const s of stores) {
    totals.sales += s.sales; totals.lensSales += s.lensSales; totals.boxes += s.boxes;
    totals.trialBoxes += s.trialBoxes; totals.trialPieces += s.trialPieces; totals.freeBoxes += s.freeBoxes;
    totals.overBoxes += s.overBoxes;
    totals.trialCost += s.trialCost || 0; totals.grossProfit += s.grossProfit || 0; totals.overCost += s.overCost || 0;
    const seg = segments[s.verdict];
    seg.stores += 1; seg.sales += s.sales; seg.overCost += s.overCost || 0;
  }
  totals.usage = totals.boxes > 0 ? totals.trialBoxes / totals.boxes : 0;
  totals.roi = totals.trialCost > 0 ? totals.grossProfit / totals.trialCost : null;

  return {
    year, sp, months, costAvailable, stores, totals, segments,
    unknownCodes: [...unknownCodes.values()].sort((a, b) => b.qty - a.qty),
  };
}

// "Needs action first": verdict order, then the money or boxes at stake.
export function sortByPriority(stores) {
  const rank = Object.fromEntries(VERDICT_ORDER.map((v, i) => [v, i]));
  return [...stores].sort((a, b) =>
    rank[a.verdict] - rank[b.verdict] ||
    b.overBoxes - a.overBoxes ||
    b.sales - a.sales);
}
