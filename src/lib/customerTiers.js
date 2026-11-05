// Customer revenue tiers for the Customer drill-down.
//
// A customer lands in the highest band their yearly revenue reaches. Anything
// below the last floor goes in a final "under" band so every ringgit is counted
// and the shares add up to 100%. Customers whose net revenue for the year is
// zero or negative (credit notes only) are not ranked.

export const TIER_FLOORS = [100000, 80000, 60000, 50000, 40000, 30000, 20000, 10000, 6000, 3000];

const k = (v) => `${v / 1000}K`;

// Band labels, top band first: "RM 100K and above", "RM 80K – 100K", … "Under RM 3K".
export const TIERS = [
  ...TIER_FLOORS.map((floor, i) => ({
    floor,
    ceil: i === 0 ? Infinity : TIER_FLOORS[i - 1],
    label: i === 0 ? `RM ${k(floor)} and above` : `RM ${k(floor)} – ${k(TIER_FLOORS[i - 1])}`,
  })),
  { floor: 0, ceil: TIER_FLOORS[TIER_FLOORS.length - 1], label: `Under RM ${k(TIER_FLOORS[TIER_FLOORS.length - 1])}` },
];

export function tierIndex(revenue) {
  for (let i = 0; i < TIER_FLOORS.length; i++) if (revenue >= TIER_FLOORS[i]) return i;
  return TIER_FLOORS.length;
}

const round2 = (v) => Math.round(v * 100) / 100;

// Customer rows { sp, year, customer, months[12], total } -> yearly ranking for
// one scope. `sp` is a salesperson or "All". Returns
//   customers: ranked list { rank, customer, total, months, sps, tier, share, prev }
//   tiers:     one entry per band { idx, label, count, revenue, share, cumulative }
//   total:     revenue of the ranked customers
//   unranked:  customers whose net revenue for the year is zero or negative
export function buildTierRanking(rows, year, sp) {
  const inScope = (r) => sp === "All" || r.sp === sp;
  const byCustomer = new Map();
  const prev = new Map();
  for (const r of rows || []) {
    if (!r || !r.customer || !inScope(r)) continue;
    if (r.year === year) {
      let e = byCustomer.get(r.customer);
      if (!e) {
        e = { customer: r.customer, total: 0, months: new Array(12).fill(0), sps: new Set() };
        byCustomer.set(r.customer, e);
      }
      e.total += Number(r.total) || 0;
      for (let m = 0; m < 12; m++) e.months[m] += Number(r.months?.[m]) || 0;
      if ((Number(r.total) || 0) > 0) e.sps.add(r.sp);
    } else if (r.year === year - 1) {
      prev.set(r.customer, (prev.get(r.customer) || 0) + (Number(r.total) || 0));
    }
  }

  const all = [...byCustomer.values()].map((e) => ({ ...e, total: round2(e.total), sps: [...e.sps] }));
  const ranked = all.filter((e) => e.total > 0).sort((a, b) => b.total - a.total);
  const total = ranked.reduce((a, e) => a + e.total, 0);

  const customers = ranked.map((e, i) => ({
    ...e,
    rank: i + 1,
    tier: tierIndex(e.total),
    share: total > 0 ? e.total / total : 0,
    prev: prev.has(e.customer) ? round2(prev.get(e.customer)) : null,
  }));

  let running = 0;
  const tiers = TIERS.map((t, idx) => {
    const members = customers.filter((c) => c.tier === idx);
    const revenue = members.reduce((a, c) => a + c.total, 0);
    running += revenue;
    return {
      idx,
      label: t.label,
      count: members.length,
      revenue: round2(revenue),
      share: total > 0 ? revenue / total : 0,
      cumulative: total > 0 ? running / total : 0,
    };
  });

  return { customers, tiers, total: round2(total), unranked: all.length - ranked.length };
}
