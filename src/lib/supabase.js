import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
    "Copy .env.example to .env and fill in your values."
  );
}

export const supabase = createClient(url || "", anonKey || "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Fetch all rows from a table. Past the 1000-row cap, fires every page in
// parallel after a head-only count query, so 22 sequential round-trips
// become 1 + (22 in parallel) ≈ 2 round-trips.
export async function fetchAll(table, columns = "*") {
  const PAGE = 1000;

  // 1) cheap head-only request to learn the row count
  const { count, error: countErr } = await supabase
    .from(table)
    .select(columns, { count: "exact", head: true });
  if (countErr) throw countErr;
  if (!count) return [];

  // 2) build page ranges
  const ranges = [];
  for (let from = 0; from < count; from += PAGE) {
    ranges.push([from, Math.min(from + PAGE - 1, count - 1)]);
  }

  // 3) fire all pages concurrently
  const results = await Promise.all(
    ranges.map(([from, to]) =>
      supabase
        .from(table)
        .select(columns)
        .range(from, to)
        .then((r) => {
          if (r.error) throw r.error;
          return r.data || [];
        })
    )
  );

  return results.flat();
}

// Aggregate raw customer + brand rows into the same shape as src/data.json
// so the existing dashboard can consume it without changes.
export function aggregateFromRaw(customers, brandSales) {
  const sumMap = new Map();
  for (const r of customers) {
    const key = `${r.sp}|${r.year}`;
    let s = sumMap.get(key);
    if (!s) {
      s = { sp: r.sp, year: r.year, total: 0, customers: 0, months: new Array(12).fill(0) };
      sumMap.set(key, s);
    }
    const total = Number(r.total);
    s.total += total;
    if (total > 0) s.customers += 1;
    for (let i = 0; i < 12; i++) s.months[i] += Number(r.months[i]) || 0;
  }
  const summary = [...sumMap.values()].map(s => ({
    ...s,
    total: Math.round(s.total * 100) / 100,
    months: s.months.map(m => Math.round(m * 100) / 100),
  }));
  summary.sort((a, b) => (a.sp < b.sp ? -1 : a.sp > b.sp ? 1 : a.year - b.year));

  const custTotals = new Map();
  for (const r of customers) {
    const t = Number(r.total);
    custTotals.set(r.customer, (custTotals.get(r.customer) || 0) + t);
  }
  const topCustomers = [...custTotals.entries()]
    .map(([customer, total]) => ({ customer, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  return {
    salespeople: [...new Set(customers.map(r => r.sp))].sort(),
    years: [...new Set(customers.map(r => r.year))].sort(),
    brands: [...new Set(brandSales.map(r => r.brand))].sort(),
    summary,
    topCustomers,
    customers: customers.map(r => ({
      sp: r.sp,
      year: r.year,
      customer: r.customer,
      months: r.months.map(Number),
      total: Number(r.total),
    })),
    brandSales: brandSales.map(r => ({
      sp: r.sp,
      year: r.year,
      customer: r.customer,
      brand: r.brand,
      amt: Number(r.amt),
      qty: Number(r.qty || 0),
    })),
  };
}
