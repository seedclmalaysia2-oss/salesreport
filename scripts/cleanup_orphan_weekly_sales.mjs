// Clean up weekly_sales rows that have no backing invoice file anymore.
//
// data_files (kind='invoice') is the source of truth for the weekly board —
// syncWeeklyFromFiles derives the weekly_sales rows from it. Deleting an
// invoice file on the Data tab does NOT cascade to weekly_sales, so old rows
// linger and the Weekly Sales card keeps showing stale numbers.
//
// This script:
//  1) Reads every non-deleted invoice file's parsed rows, computes which
//     (period_start, period_end, sp) triples SHOULD exist right now.
//  2) Diffs against weekly_sales and deletes anything not backed.
//  3) When no invoice files exist at all, wipes weekly_sales entirely so
//     the dashboard reads zero.

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

function weekBounds(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const wIdx = Math.floor((d - 1) / 7);
  const startDay = wIdx * 7 + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const endDay = Math.min(startDay + 6, lastDay);
  const pad = (n) => String(n).padStart(2, "0");
  return { start: `${y}-${pad(m)}-${pad(startDay)}`, end: `${y}-${pad(m)}-${pad(endDay)}` };
}

// 1. What invoice files exist right now?
console.log("=== Current invoice files in data_files ===");
const { data: files, error: fErr } = await supabase
  .from("data_files")
  .select("id,name,rows_json,deleted_at")
  .eq("kind", "invoice");
if (fErr) { console.error(fErr.message); process.exit(1); }
const alive = files.filter(f => !f.deleted_at);
const soft  = files.filter(f =>  f.deleted_at);
console.log(`  Live: ${alive.length}   Trashed: ${soft.length}`);
for (const f of alive) console.log(`    live   · ${f.name}`);
for (const f of soft)  console.log(`    trash  · ${f.name}`);

// 2. What weekly_sales rows exist right now?
const { data: existing, error: wErr } = await supabase
  .from("weekly_sales")
  .select("period_start,period_end,sp,amount");
if (wErr) { console.error(wErr.message); process.exit(1); }
console.log(`\n=== weekly_sales currently holds ${existing.length} rows ===`);

// 3. Compute the set of triples SUPPOSED to exist (from live invoice files).
const validKeys = new Set();
if (alive.length > 0) {
  // Same dedupe-by-invoice logic the app's syncWeeklyFromFiles uses.
  const invoiceSums = new Map();
  for (const f of alive) {
    const inFile = new Map();
    for (const r of f.rows_json || []) {
      if (!r || !r.date || !r.sp) continue;
      const amt = Number(r.amount);
      if (!Number.isFinite(amt)) continue;
      const key = r.invoice ? `inv|${r.invoice}` : `raw|${r.date}|${r.sp}|${r.customer || ""}|${amt}`;
      const cur = inFile.get(key);
      if (cur) cur.amount += amt;
      else inFile.set(key, { date: r.date, sp: r.sp, amount: amt });
    }
    for (const [k, u] of inFile) invoiceSums.set(k, u);
  }
  const buckets = new Map();
  for (const [, u] of invoiceSums) {
    const { start, end } = weekBounds(u.date);
    const k = `${start}|${end}|${u.sp}`;
    buckets.set(k, (buckets.get(k) || 0) + u.amount);
  }
  for (const [k, amt] of buckets) {
    if (Math.round(amt * 100) === 0) continue;
    validKeys.add(k);
  }
}
console.log(`  ${validKeys.size} (period, sp) combos backed by live invoice files.`);

// 4. Delete orphans.
const orphans = existing.filter(r => !validKeys.has(`${r.period_start}|${r.period_end}|${r.sp}`));
console.log(`\n=== Orphans (in weekly_sales but no source file) ===`);
console.log(`  ${orphans.length} row(s):`);
for (const o of orphans) {
  console.log(`    ${o.period_start} → ${o.period_end}  ${o.sp.padEnd(15)}  RM ${Number(o.amount).toLocaleString("en-MY")}`);
}

if (orphans.length === 0) {
  console.log("\n✓ Nothing to clean — every weekly_sales row is backed by a live invoice file.");
  process.exit(0);
}

// Delete each orphan by (period_start, period_end, sp) triple.
console.log("\nDeleting orphan rows…");
let deleted = 0;
for (const o of orphans) {
  const { error } = await supabase.from("weekly_sales").delete()
    .eq("period_start", o.period_start)
    .eq("period_end",   o.period_end)
    .eq("sp",           o.sp);
  if (error) { console.error(`  ✗ ${o.period_start}/${o.sp}: ${error.message}`); continue; }
  deleted += 1;
}
console.log(`✓ Deleted ${deleted}/${orphans.length} orphan rows.`);
console.log(`  weekly_sales now holds ${existing.length - deleted} rows (backed by ${alive.length} invoice file${alive.length===1?"":"s"}).`);
