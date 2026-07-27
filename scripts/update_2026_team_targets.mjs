// One-shot: overwrite the 2026 team sales targets with the amended figures.
// The dashboard's Targets tab reads sales_targets rows where sp='_TEAM' for
// year-vs-target comparisons. Upserts on the (year, month, sp) unique key so
// re-running is safe; per-rep targets (rows with sp = 'Alan'/'Dino'/etc.)
// are untouched.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
} catch {}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// New 2026 Jpn Sales Target (team-wide), from the amendment file the user
// shared. Total 4,497,067 across 12 months.
const YEAR = 2026;
const MONTHLY = [
  347457, // Jan
  292601, // Feb
  332731, // Mar
  348211, // Apr
  312090, // May
  463303, // Jun
  339410, // Jul
  304583, // Aug
  369530, // Sep
  439368, // Oct
  465124, // Nov
  482659, // Dec
];
const total = MONTHLY.reduce((a, b) => a + b, 0);

const payload = MONTHLY.map((amt, i) => ({
  year: YEAR, month: i + 1, sp: "_TEAM", target_amt: amt,
}));

console.log(`Upserting ${payload.length} team target rows for ${YEAR} (total RM ${total.toLocaleString("en-MY")})`);

const { data, error } = await supabase
  .from("sales_targets")
  .upsert(payload, { onConflict: "year,month,sp" })
  .select();

if (error) {
  console.error("Upsert failed:", error.message);
  process.exit(1);
}

console.log(`✓ ${data.length} rows written`);
console.log("Verifying…");

const { data: check } = await supabase
  .from("sales_targets")
  .select("month, target_amt")
  .eq("year", YEAR)
  .eq("sp", "_TEAM")
  .order("month");

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
console.log("\nMonth  Target");
for (const r of check || []) {
  console.log(`  ${MONTHS[r.month - 1]}  RM ${Number(r.target_amt).toLocaleString("en-MY")}`);
}
console.log(`  ---`);
console.log(`  Total  RM ${(check || []).reduce((s, r) => s + Number(r.target_amt), 0).toLocaleString("en-MY")}`);
