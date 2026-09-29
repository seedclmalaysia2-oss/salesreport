// Recorded corrections to the "Sales Analysis by customer" monthly totals.
//
// The Weekly Sales card's "Cust Adj" and the HQ Report both reconcile to the
// customer file's monthly total per salesperson. Occasionally that file is
// itself wrong for a month — e.g. it leaves out part of a credit note that the
// Stock-Detail file carries in full. Each such case is recorded here once, with
// its reason, and applied to the customer totals before either view reconciles,
// so the Weekly board and the HQ Report keep tallying with each other and HQ.
//
// amount: added to that rep's month (negative = deduction).
export const CUST_FILE_CORRECTIONS = [
  {
    year: 2026, month: 6, sp: "Khen", amount: -5552.96,
    note: "CN01885 (9 Jun, −RM 8,309) only partly in the customer file; June = 382,047.71 − 5,552.96 = 376,494.75 (HQ)",
  },
];

// Returns summary rows ({ sp, year, months[12], ... }) with the corrections
// applied. Never mutates the input.
export function applyCustCorrections(summary, corrections = CUST_FILE_CORRECTIONS) {
  if (!Array.isArray(summary) || !summary.length) return summary;
  return summary.map((s) => {
    const hits = corrections.filter((c) => c.year === s.year && c.sp === s.sp);
    if (!hits.length) return s;
    const months = [...(s.months || new Array(12).fill(0))];
    let total = Number(s.total) || 0;
    for (const c of hits) {
      const i = c.month - 1;
      months[i] = Math.round(((Number(months[i]) || 0) + c.amount) * 100) / 100;
      total += c.amount;
    }
    return { ...s, months, total: Math.round(total * 100) / 100 };
  });
}
