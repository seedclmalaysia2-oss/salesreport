// One-shot: overwrite the 2026 per-rep sales targets with the amended
// distribution. Maps the amendment sheet's columns to the sp names the app
// uses:
//   ALAN     -> Alan
//   KHEN     -> Khen
//   DINO     -> Dino
//   Sakinah  -> Sakinah
//   Simon    -> Simon
//   OTH      -> Seed Malaysia   (catchall for reps outside the retail trio)
//
// Wani wasn't in the sheet (blank 'x' column at 0%). Added separately at
// RM 12,000/year (RM 1,000/mo) as the user's fallback — trivially small,
// consistent with her three-customer footprint. Doesn't disturb the team
// total (4,497,067) because we don't recompute team from per-rep sums.

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

const YEAR = 2026;

// Columns: Jan..Dec. Row per rep. Values from the PERSONAL TARGET DISTRIBUTION
// sheet (rounded to whole ringgit; the sheet keeps no cents).
const PER_REP = {
  "Alan":          [ 90339,  76076,  86510,  90535,  81143, 120459,  88247,  79192,  96078, 114236, 120932, 125491],
  "Khen":          [ 97288,  81928,  93165,  97499,  87385, 129725,  95035,  85283, 103468, 123023, 130235, 135145],
  "Dino":          [ 69491,  58520,  66546,  69642,  62418,  92661,  67882,  60917,  73906,  87874,  93025,  96532],
  "Sakinah":       [ 10424,   8778,   9982,  10446,   9363,  13899,  10182,   9137,  11086,  13181,  13954,  14480],
  "Simon":         [ 41695,  35112,  39928,  41785,  37451,  55596,  40729,  36550,  44344,  52724,  55815,  57919],
  "Seed Malaysia": [ 38220,  32186,  36600,  38303,  34330,  50963,  37335,  33504,  40648,  48330,  51164,  53092], // 'OTH' column
  "Wani":          [  1000,   1000,   1000,   1000,   1000,   1000,   1000,   1000,   1000,   1000,   1000,   1000], // 12K/year fallback
};

// Show what we're about to write.
console.log(`Upserting ${YEAR} per-rep sales targets:`);
for (const [sp, months] of Object.entries(PER_REP)) {
  const total = months.reduce((a, b) => a + b, 0);
  console.log(`  ${sp.padEnd(16)} annual RM ${total.toLocaleString("en-MY").padStart(12)}`);
}

const payload = [];
for (const [sp, months] of Object.entries(PER_REP)) {
  months.forEach((amt, i) => {
    payload.push({ year: YEAR, month: i + 1, sp, target_amt: amt });
  });
}
console.log(`\nTotal payload: ${payload.length} rows`);

const { data, error } = await supabase
  .from("sales_targets")
  .upsert(payload, { onConflict: "year,month,sp" })
  .select();
if (error) { console.error("Upsert failed:", error.message); process.exit(1); }
console.log(`✓ ${data.length} rows written`);

// Verify: sum by rep for the year, to confirm what's now stored.
console.log("\nVerifying stored annual totals:");
const { data: check } = await supabase
  .from("sales_targets")
  .select("sp, month, target_amt")
  .eq("year", YEAR)
  .neq("sp", "_TEAM")
  .order("sp");
const byRep = {};
for (const r of check || []) {
  byRep[r.sp] = (byRep[r.sp] || 0) + Number(r.target_amt);
}
for (const sp of Object.keys(byRep).sort()) {
  console.log(`  ${sp.padEnd(16)} RM ${byRep[sp].toLocaleString("en-MY").padStart(12)}`);
}
const grand = Object.values(byRep).reduce((a, b) => a + b, 0);
console.log(`  ${"---".padEnd(16)}`);
console.log(`  ${"Sum".padEnd(16)} RM ${grand.toLocaleString("en-MY").padStart(12)}`);
