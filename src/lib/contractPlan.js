// Analysis behind the Contracts tab: what a customer (or a chain) has achieved,
// where the year is heading, and a suggested next-year target and rebate ladder.
//
// Everything here is a pure function of the dashboard's customer rows
// ({ sp, year, customer, months[12], total }); the tab only presents the result.
// Suggestions always carry a one-line reason so a salesperson can judge them.

import { chainOf } from "./chains.js";

const sum = (a) => a.reduce((s, x) => s + (Number(x) || 0), 0);
const toSet = (names) => (names instanceof Set ? names : new Set(names || []));
const zero12 = () => new Array(12).fill(0);

const pctText = (r) => `${r >= 0 ? "+" : "−"}${Math.round(Math.abs(r) * 100)}%`;
const rm = (v) => `RM ${Math.round(v || 0).toLocaleString("en-MY")}`;
const rmShort = (v) => {
  const n = Math.round(v || 0);
  if (Math.abs(n) >= 1e6) return `RM ${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `RM ${Math.round(n / 1e3)}K`;
  return rm(n);
};
export { rm, rmShort, pctText };

// 12 monthly totals for a set of customer names (all customers when `names` is
// null), summed across salespeople.
export function monthsFor(rows, names, year) {
  const set = names == null ? null : toSet(names);
  const out = zero12();
  for (const r of rows || []) {
    if (!r || r.year !== year || !r.customer) continue;
    if (set && !set.has(r.customer)) continue;
    for (let i = 0; i < 12; i++) out[i] += Number(r.months?.[i]) || 0;
  }
  return out;
}

// How many months of `year` have been reported: the last month in which the
// company as a whole sold anything. Uses the data, not the calendar, because the
// uploads can run weeks behind.
export function reportedMonths(rows, year) {
  const all = monthsFor(rows, null, year);
  for (let i = 11; i >= 0; i--) if (all[i] > 0) return i + 1;
  return 0;
}

// Share of a full year that falls in the first `m` months (0..1), or null.
function shareOfYear(months, m) {
  const total = sum(months);
  if (!(total > 0)) return null;
  return sum(months.slice(0, m)) / total;
}

// Seasonality for the quarter split: the entity's own last full year, then the
// whole company's, then equal quarters.
export function quarterShares(rows, names, refYear) {
  const quarters = (months) => [0, 1, 2, 3].map((q) => sum(months.slice(q * 3, q * 3 + 3)));
  const ownMonths = monthsFor(rows, names, refYear);
  const own = quarters(ownMonths).map((x) => Math.max(0, x));
  // Only a year that sold across the whole year says anything about the season
  // (an account that started in April would otherwise get an empty Q1).
  if (own.every((x) => x > 0) && ownMonths.filter((x) => x > 0).length >= 6) {
    const t = sum(own);
    return { shares: own.map((x) => x / t), method: "own" };
  }
  const company = quarters(monthsFor(rows, null, refYear));
  if (sum(company) > 0) {
    const t = sum(company);
    return { shares: company.map((x) => Math.max(0, x) / t), method: "company" };
  }
  return { shares: [0.25, 0.25, 0.25, 0.25], method: "equal" };
}

// Rounding that keeps small accounts precise and big ones tidy.
export function niceRound(v, reference = v) {
  const step = reference >= 200000 ? 1000 : reference >= 20000 ? 100 : 10;
  return Math.round((Number(v) || 0) / step) * step;
}

// Split an annual target into four quarters by `shares`. Q1–Q3 are rounded; Q4
// takes the remainder so the quarters always add up to the target.
export function splitQuarters(target, shares) {
  const t = Math.max(0, Number(target) || 0);
  const s = shares && shares.length === 4 ? shares : [0.25, 0.25, 0.25, 0.25];
  const q = s.slice(0, 3).map((x) => niceRound(t * x, t));
  q.push(Math.round((t - sum(q)) * 100) / 100);
  return q;
}

// Where this year stands for one customer, or for a set of branches taken
// together. `names` is an array/Set of customer names.
//
//   ytd / ytdPrior   this year so far, and the same months last year
//   lastYear         last full year
//   projected        full-year estimate (see `method`)
//   history          [{ year, total }] for every year up to baseYear
//   branches         per customer name, biggest first
export function analyse(rows, names, baseYear) {
  const set = toSet(names);
  const months = monthsFor(rows, set, baseYear);
  const prev = monthsFor(rows, set, baseYear - 1);
  const m = reportedMonths(rows, baseYear);
  const ytd = sum(months.slice(0, m));
  const ytdPrior = sum(prev.slice(0, m));
  const lastYear = sum(prev);

  let projected = 0;
  let method = "none";
  if (m >= 12) {
    projected = ytd;
    method = "actual";
  } else if (m > 0) {
    const ownShare = shareOfYear(prev, m);
    const activeMonths = prev.filter((x) => x > 0).length;
    const companyShare = shareOfYear(monthsFor(rows, null, baseYear - 1), m);
    if (ownShare != null && ownShare >= 0.15 && activeMonths >= 6) {
      projected = ytd / ownShare;
      method = "own";
    } else if (companyShare != null && companyShare >= 0.15) {
      projected = ytd / companyShare;
      method = "company";
    } else {
      projected = (ytd / m) * 12;
      method = "linear";
    }
    projected = Math.max(projected, ytd);
  }

  const yearsSeen = [...new Set((rows || []).map((r) => r?.year).filter((y) => Number.isFinite(y) && y <= baseYear))].sort((a, b) => a - b);
  const history = yearsSeen.map((year) => ({ year, total: sum(monthsFor(rows, set, year)) }));

  const branches = [...set]
    .map((name) => {
      const own = monthsFor(rows, [name], baseYear);
      const own1 = monthsFor(rows, [name], baseYear - 1);
      return {
        name,
        ytd: sum(own.slice(0, m)),
        ytdPrior: sum(own1.slice(0, m)),
        lastYear: sum(own1),
        months: own,
      };
    })
    .sort((a, b) => b.ytd + b.lastYear - (a.ytd + a.lastYear));

  return {
    baseYear,
    monthsReported: m,
    months,
    ytd,
    ytdPrior,
    lastYear,
    projected,
    method,
    yoyYtd: ytdPrior > 0 ? ytd / ytdPrior - 1 : null,
    history,
    branches,
    hasHistory: sum(history.map((h) => Math.abs(h.total))) > 0,
  };
}

// Chain roll-up for the group contract: one line per chain with its branches.
export function rollupByChain(branches) {
  const map = new Map();
  for (const b of branches || []) {
    const chain = chainOf(b.name) || chainOf(b.name, { loose: true });
    if (!chain) continue;
    const e = map.get(chain.key) || { chain, branches: 0, ytd: 0, ytdPrior: 0, lastYear: 0 };
    e.branches += 1;
    e.ytd += b.ytd;
    e.ytdPrior += b.ytdPrior;
    e.lastYear += b.lastYear;
    map.set(chain.key, e);
  }
  return [...map.values()].sort((a, b) => b.ytd + b.lastYear - (a.ytd + a.lastYear));
}

// The figure next year's growth is applied to: this year's full-year result
// (projected), or last year when nothing has sold yet this year.
export function baseAmount(a) {
  if (!a) return 0;
  return a.projected > 0 ? a.projected : a.lastYear > 0 ? a.lastYear : 0;
}

export const targetFromGrowth = (base, growth) => niceRound((Number(base) || 0) * (1 + (Number(growth) || 0)), base);
export const growthFromTarget = (base, target) => (base > 0 ? (Number(target) || 0) / base - 1 : null);

// Suggested growth for next year, rounded to 5%, with the reason in one line.
// Returns null when there is nothing to base it on.
export function suggestGrowth(a) {
  const base = baseAmount(a);
  if (!(base > 0)) return null;
  const y = a.baseYear;
  const m = a.monthsReported;
  const early = m > 0 && m < 3 ? ` Only ${m} month${m === 1 ? "" : "s"} in, so recheck as the year fills.` : "";

  if (a.lastYear <= 0) {
    return { growth: 0.15, reason: `New this year: no ${y - 1} sales to compare, so the base is the ${m}-month run-rate and the stretch is +15%.${early}` };
  }
  if (!(a.projected > 0)) {
    return { growth: 0, reason: `No sales reported in ${y} yet, so the base is ${y - 1}. Hold flat until the account is buying again.` };
  }
  const r = a.projected / a.lastYear - 1;
  const trend = `${y} is heading for ${rmShort(a.projected)}, ${pctText(r)} on ${y - 1}`;
  let growth;
  let why;
  if (r < -0.1) { growth = 0; why = "so hold the target flat and win the volume back first"; }
  else if (r < 0.03) { growth = 0.05; why = "so a modest stretch keeps it moving"; }
  else if (r < 0.15) { growth = 0.1; why = "so the account can carry a steady stretch"; }
  else { growth = 0.15; why = "so it is ready for a bigger stretch (capped at +15%)"; }
  return { growth, reason: `${trend}, ${why}.${early}` };
}

// What a prospect that settles in typically spends: the median second-year
// spend of ECPs that started buying in the last two eligible years and spent at
// least RM 3K in that second year. Year one is too small to contract against
// (new accounts start part-way through the year, and many never reorder), so the
// benchmark looks at the ones that stayed.
export const SETTLED_FLOOR = 3000;

export function prospectBenchmark(rows, baseYear) {
  const years = (rows || []).map((r) => r?.year).filter(Number.isFinite);
  if (!years.length) return null;
  const firstYearInData = Math.min(...years);
  const byName = new Map();
  for (const r of rows) {
    if (!r?.customer || !Number.isFinite(r.year)) continue;
    if (chainOf(r.customer) || chainOf(r.customer, { loose: true })) continue;
    const e = byName.get(r.customer) || new Map();
    e.set(r.year, (e.get(r.year) || 0) + (Number(r.total) || 0));
    byName.set(r.customer, e);
  }
  const seconds = [];
  for (const perYear of byName.values()) {
    const first = [...perYear.keys()].filter((y) => perYear.get(y) > 0).sort((a, b) => a - b)[0];
    if (first == null || first <= firstYearInData) continue; // already a customer when the data starts
    if (first < baseYear - 3 || first > baseYear - 2) continue; // both years complete
    const second = perYear.get(first + 1) || 0;
    if (second >= SETTLED_FLOOR) seconds.push(second);
  }
  if (seconds.length < 3) return null;
  seconds.sort((a, b) => a - b);
  const at = (p) => {
    const i = (seconds.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return seconds[lo] + (seconds[hi] - seconds[lo]) * (i - lo);
  };
  return {
    n: seconds.length,
    median: niceRound(at(0.5)),
    low: niceRound(at(0.25)),
    high: niceRound(at(0.75)),
    from: baseYear - 3,
    to: baseYear - 2,
    reason: `Median second-year spend of ${seconds.length} new ECPs that started in ${baseYear - 3}–${baseYear - 2} and kept buying (at least ${rmShort(SETTLED_FLOOR)} in year two): ${rmShort(at(0.5))}, middle half ${rmShort(at(0.25))} to ${rmShort(at(0.75))}. Many new accounts stay small, so this is a settled-account target, not a year-one forecast.`,
  };
}

// ----- rebate ladder -----

// Achievement against target ("at", 1 = 100%) and the rebate % earned on all net
// purchases once that point is reached.
export const STANDARD_TIERS = [
  { at: 0.9, pct: 1 },
  { at: 1, pct: 2 },
  { at: 1.1, pct: 3 },
  { at: 1.25, pct: 4 },
];

const roundHalf = (v) => Math.round(v * 2) / 2;

export function suggestTiers(target) {
  const t = Number(target) || 0;
  const factor = t < 30000 ? 0.5 : t < 100000 ? 0.75 : 1;
  const tiers = STANDARD_TIERS.map((x) => ({ at: x.at, pct: roundHalf(x.pct * factor) }));
  const top = tiers[tiers.length - 1];
  return {
    tiers,
    reason: `A starting ladder sized for a ${rmShort(t)} account${factor < 1 ? ` (${Math.round(factor * 100)}% of the full rates)` : ""}: it pays up to ${top.pct}% once ${Math.round(top.at * 100)}% of target is reached. Rates are a commercial call, so adjust freely.`,
  };
}

// What each tier would cost at the point it is reached.
export function tierCosts(target, tiers) {
  const t = Number(target) || 0;
  return (tiers || []).map((x) => {
    const sales = t * (Number(x.at) || 0);
    return { at: Number(x.at) || 0, pct: Number(x.pct) || 0, sales, cost: (sales * (Number(x.pct) || 0)) / 100 };
  });
}

// Problems worth showing next to the ladder: out of order, or a rebate that goes
// down as achievement goes up.
export function tierWarnings(tiers) {
  const out = [];
  const list = tiers || [];
  for (let i = 1; i < list.length; i++) {
    if (!(Number(list[i].at) > Number(list[i - 1].at))) out.push("Tiers should rise in achievement: each row needs a higher % of target than the one above.");
    if (Number(list[i].pct) < Number(list[i - 1].pct)) out.push("A higher tier pays less than the one below it.");
  }
  return [...new Set(out)];
}
