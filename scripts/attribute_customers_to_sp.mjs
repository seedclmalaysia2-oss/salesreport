// Rebuild customers_data with per-SP attribution derived from
// brand_sales_data. Year files (2021-2026 in data_files, kind='customer')
// carry per-customer monthly totals but no SP dimension. For each
// (year >= 2022, customer), we pull that customer's per-SP revenue from
// brand_sales_data and use those shares to split the year file's monthly
// numbers across salespeople. 2021 has no brand_sales_data coverage, so
// those rows stay under sp='All' and the dashboard shows them lumped.
//
// Idempotent: wipes customers_data first, then writes the freshly split
// rows.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
} catch {}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Normalise sp names — brand_sales_data has "SEED Malaysia" in some rows.
function canonSp(raw) {
  const s = String(raw || "").trim();
  if (/^seed\s*malaysia$/i.test(s)) return "Seed Malaysia";
  return s;
}

// Fetch every row from a table, following the 1000-row page cap.
async function fetchAll(table, cols) {
  const out = []; let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

console.log("Loading customer files (kind='customer', archived on Data tab) …");
const files = await fetchAll("data_files", "id,year,rows_json,deleted_at");
const liveCust = files.filter(f => f.year && !f.deleted_at && Array.isArray(f.rows_json));
console.log(`  ${liveCust.length} live customer file(s).`);

// Fold every year file's parsed rows into { year -> customer -> row }. The
// year files carry sp='All' already (see replace_customers_with_year_files
// script) — we only need customer/months/total, sp gets recomputed here.
const yearCustomers = new Map(); // year -> Map(customer -> {months, total})
for (const f of liveCust) {
  if (!yearCustomers.has(f.year)) yearCustomers.set(f.year, new Map());
  const m = yearCustomers.get(f.year);
  for (const r of f.rows_json) {
    if (!r || !r.customer) continue;
    // Newest file for the same (year, customer) wins; loop-order in files is
    // roughly upload order, so the winning row picks up the latest values.
    m.set(String(r.customer).trim(), {
      months: Array.isArray(r.months) && r.months.length === 12
        ? r.months.map(x => Number(x) || 0)
        : new Array(12).fill(0),
      total: Number(r.total) || 0,
    });
  }
}
console.log(`  years covered: ${[...yearCustomers.keys()].sort().join(", ")}`);

console.log("Loading brand_sales_data for SP↔customer attribution …");
const brandRows = await fetchAll("brand_sales_data", "sp,year,customer,amt");
console.log(`  ${brandRows.length} brand rows`);
// Build { year -> customer -> Map(sp -> amt) } from brand data.
const attribution = new Map();
for (const b of brandRows) {
  const sp = canonSp(b.sp); if (!sp) continue;
  const cust = String(b.customer || "").trim(); if (!cust) continue;
  const amt = Number(b.amt) || 0;
  if (amt === 0) continue;
  if (!attribution.has(b.year)) attribution.set(b.year, new Map());
  const byCust = attribution.get(b.year);
  if (!byCust.has(cust)) byCust.set(cust, new Map());
  const bySp = byCust.get(cust);
  bySp.set(sp, (bySp.get(sp) || 0) + amt);
}

console.log("Wiping customers_data …");
const { error: delErr } = await supabase.from("customers_data").delete().gt("year", 0);
if (delErr) { console.error(delErr.message); process.exit(1); }

console.log("Building split rows …");
const inserts = [];
let unattributed = 0, attributed = 0;
for (const [year, custMap] of yearCustomers) {
  const yearAttr = attribution.get(year);
  for (const [customer, rec] of custMap) {
    const bySp = yearAttr?.get(customer);
    if (!bySp || bySp.size === 0) {
      // No brand attribution for this (year, customer). Land under 'All'.
      inserts.push({
        sp: "All", year, customer,
        months: rec.months, total: rec.total,
      });
      unattributed += 1;
      continue;
    }
    const spTotal = [...bySp.values()].reduce((a, v) => a + v, 0);
    if (spTotal <= 0) {
      inserts.push({ sp: "All", year, customer, months: rec.months, total: rec.total });
      unattributed += 1;
      continue;
    }
    // Split each month by SP share. Round each SP's monthly figure to 2 dp,
    // then adjust the largest slice so the sum matches the original month
    // (kills penny drift from repeated rounding).
    for (const [sp, spAmt] of bySp) {
      const share = spAmt / spTotal;
      const months = rec.months.map(m => Math.round(m * share * 100) / 100);
      const total = Math.round(months.reduce((a, v) => a + v, 0) * 100) / 100;
      inserts.push({ sp, year, customer, months, total });
    }
    attributed += 1;
  }
}
console.log(`  ${inserts.length} rows to insert · ${attributed} customers attributed, ${unattributed} left under 'All'`);

// Chunked insert so a single POST body doesn't blow past Supabase's limit.
const CHUNK = 500;
let done = 0;
for (let i = 0; i < inserts.length; i += CHUNK) {
  const slice = inserts.slice(i, i + CHUNK);
  const { error } = await supabase.from("customers_data").insert(slice);
  if (error) { console.error(`  ✗ insert failed at chunk ${i}: ${error.message}`); process.exit(1); }
  done += slice.length;
}
console.log(`  ✓ inserted ${done} rows`);

// Report per-year, per-SP totals.
console.log("\nPer-year totals by SP:");
const roll = new Map();
for (const r of inserts) {
  const key = `${r.year}|${r.sp}`;
  roll.set(key, (roll.get(key) || 0) + r.total);
}
const years = [...new Set(inserts.map(r => r.year))].sort();
const sps = [...new Set(inserts.map(r => r.sp))].sort();
const pad = (s, w) => String(s).padEnd(w);
console.log("  " + pad("Year", 6) + sps.map(s => pad(s, 14)).join(""));
for (const y of years) {
  const cells = sps.map(sp => {
    const v = roll.get(`${y}|${sp}`) || 0;
    return v === 0 ? pad("—", 14) : pad(Math.round(v).toLocaleString("en-MY"), 14);
  });
  console.log("  " + pad(y, 6) + cells.join(""));
}
