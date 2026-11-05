// A contract draft: what the editor holds and how it is derived from the
// dashboard's customer rows. Kept apart from the UI so the rules (what is
// suggested, what a change re-computes) can be tested.
//
// draft = {
//   id?, kind: "ecp" | "group" | "prospect", title, baseYear, contractYear, status,
//   customerNames: [dashboard customer names it is built from],
//   groupChains: [chain keys offered in a group], customerLegal,
//   supplier, supplierSignatory, customerSignatory, startDate, endDate, issued,
//   growth (fraction or null), target (RM), quarters (4 amounts, or null = follow the season),
//   tiers: [{ at, pct }], clauses: [{ id, title, body }], docs: { proposal, contract },
//   notes, touched (a person has set the numbers by hand)
// }

import {
  analyse, baseAmount, suggestGrowth, targetFromGrowth, growthFromTarget, prospectBenchmark,
  quarterShares, splitQuarters, suggestTiers, tierWarnings, rollupByChain, monthsFor,
} from "./contractPlan.js";
import { CHAINS, chainBranches } from "./chains.js";
import { GROUP_NAME } from "./chains.js";

export const SUPPLIER_DEFAULT = "Seed Malaysia";

const iso = (d) => d.toISOString().slice(0, 10);

// Customers with sales in the base year or the year before, summed across
// salespeople: name -> { name, cur, prev, reps }.
export function activeCustomers(rows, baseYear) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r?.customer || (r.year !== baseYear && r.year !== baseYear - 1)) continue;
    const e = map.get(r.customer) || { name: r.customer, cur: 0, prev: 0, reps: new Set() };
    const t = Number(r.total) || 0;
    if (r.year === baseYear) { e.cur += t; if (t > 0 && r.sp) e.reps.add(r.sp); } else e.prev += t;
    map.set(r.customer, e);
  }
  for (const [k, e] of map) if (!(e.cur > 0 || e.prev > 0)) map.delete(k);
  return map;
}

// The branches a group would start with: every active branch we are sure about.
export function defaultBranches(rows, baseYear, chainKeys) {
  const active = activeCustomers(rows, baseYear);
  return chainBranches([...active.keys()], chainKeys).filter((b) => b.sure).map((b) => b.name);
}

export function newDraft({ kind, name = "", rows, baseYear, clauses, supplier = SUPPLIER_DEFAULT, today = new Date() }) {
  const contractYear = baseYear + 1;
  const groupChains = CHAINS.map((c) => c.key);
  const draft = {
    kind,
    title: kind === "group" ? GROUP_NAME : name,
    baseYear,
    contractYear,
    status: "draft",
    customerNames: kind === "ecp" ? [name] : kind === "group" ? defaultBranches(rows, baseYear, groupChains) : [],
    groupChains: kind === "group" ? groupChains : [],
    customerLegal: "",
    supplier,
    supplierSignatory: "",
    customerSignatory: "",
    startDate: `${contractYear}-01-01`,
    endDate: `${contractYear}-12-31`,
    issued: iso(today),
    growth: null,
    target: 0,
    quarters: null,
    tiers: [],
    clauses: clauses || [],
    docs: { proposal: true, contract: true },
    notes: "",
    touched: false,
  };
  return applySuggestions(draft, rows);
}

// Everything derived from the draft plus the dashboard's rows.
export function computeCalc(draft, rows) {
  const names = draft.customerNames || [];
  const analysis = names.length ? analyse(rows, names, draft.baseYear) : null;
  const base = baseAmount(analysis);
  const growthSuggestion = analysis ? suggestGrowth(analysis) : null;
  const benchmark = !analysis || !analysis.hasHistory ? prospectBenchmark(rows, draft.baseYear) : null;
  const season = quarterShares(rows, names, draft.baseYear - 1);
  const quarters = Array.isArray(draft.quarters) && draft.quarters.length === 4 ? draft.quarters : splitQuarters(draft.target, season.shares);
  const quarterTotal = quarters.reduce((a, b) => a + (Number(b) || 0), 0);
  return {
    analysis,
    base,
    growthSuggestion,
    benchmark,
    season,
    quarters,
    quarterGap: Math.round(((Number(draft.target) || 0) - quarterTotal) * 100) / 100,
    tierSuggestion: suggestTiers(draft.target),
    tierWarnings: tierWarnings(draft.tiers),
    chains: draft.kind === "group" && analysis ? rollupByChain(analysis.branches) : [],
    prevMonths: analysis ? monthsFor(rows, names, draft.baseYear - 1) : new Array(12).fill(0),
  };
}

// Set growth, target, quarters and the rebate ladder from the analysis. This is
// what a new draft starts with, and what "Use suggestion" does.
export function applySuggestions(draft, rows) {
  const calc = computeCalc(draft, rows);
  let { growth, target } = draft;
  if (calc.growthSuggestion) {
    growth = calc.growthSuggestion.growth;
    target = targetFromGrowth(calc.base, growth);
  } else if (calc.benchmark) {
    growth = null;
    target = calc.benchmark.median;
  } else {
    growth = null;
    target = 0;
  }
  return { ...draft, growth, target, quarters: null, tiers: suggestTiers(target).tiers, touched: false };
}

// The set of customers or the base year changed. An untouched draft follows the
// new suggestions; one a person has tuned keeps its target and re-derives the
// growth against the new base.
export function rebase(draft, rows) {
  if (!draft.touched) return applySuggestions(draft, rows);
  const calc = computeCalc(draft, rows);
  return { ...draft, growth: calc.base > 0 ? growthFromTarget(calc.base, draft.target) : null };
}

// Edits that keep growth and target consistent with each other.
export function setGrowth(draft, rows, growth) {
  const base = computeCalc(draft, rows).base;
  const g = Number.isFinite(growth) ? growth : null;
  return { ...draft, growth: g, target: g != null && base > 0 ? targetFromGrowth(base, g) : draft.target, touched: true };
}
export function setTarget(draft, rows, target) {
  const base = computeCalc(draft, rows).base;
  const t = Math.max(0, Number(target) || 0);
  return { ...draft, target: t, growth: base > 0 ? growthFromTarget(base, t) : null, touched: true };
}

// Saved form <-> draft. The row holds the headline fields; the payload holds the rest.
export function recordFromDraft(draft) {
  const { id, ...payload } = draft;
  return { id, title: draft.title || "Untitled contract", kind: draft.kind, baseYear: draft.baseYear, contractYear: draft.contractYear, status: draft.status, payload };
}
export function draftFromRecord(rec) {
  return { ...rec.payload, id: rec.id, kind: rec.kind, title: rec.title, baseYear: rec.baseYear, contractYear: rec.contractYear, status: rec.status };
}
