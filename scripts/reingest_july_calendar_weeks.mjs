// Re-bucket the archived July Stock Sales Detail file into the new
// calendar-week boundaries (1-7, 8-14, 15-21, 22-28, 29-end). Reads the
// rows_json off the existing data_files row and rewrites weekly_sales in
// place — no re-parse from disk needed.

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

// Same calendar-week logic that now lives in src/lib/weekly.js.
function weekBounds(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const wIdx = Math.floor((d - 1) / 7);
  const startDay = wIdx * 7 + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const endDay = Math.min(startDay + 6, lastDay);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    start: `${y}-${pad(m)}-${pad(startDay)}`,
    end:   `${y}-${pad(m)}-${pad(endDay)}`,
  };
}

// Pull every invoice-kind file's parsed rows.
console.log("Loading invoice-kind data_files rows…");
const { data: files, error: fErr } = await supabase
  .from("data_files")
  .select("id,name,rows_json")
  .eq("kind", "invoice")
  .is("deleted_at", null);
if (fErr) { console.error(fErr.message); process.exit(1); }
console.log(`  ${files.length} file(s).`);

// Aggregate into calendar-week buckets, deduped by invoice number the way
// syncWeeklyFromFiles does.
const invoiceSums = new Map(); // key -> { date, sp, amount, fileTs }
for (const f of files) {
  const rows = f.rows_json || [];
  const inFileSums = new Map();
  for (const r of rows) {
    if (!r || !r.date || !r.sp) continue;
    const amt = Number(r.amount);
    if (!Number.isFinite(amt)) continue;
    // Per-invoice net within this file first (CN + INV with same doc -> net).
    const key = r.invoice
      ? `inv|${r.invoice}`
      : `raw|${r.date}|${r.sp}|${r.customer || ""}|${amt}`;
    const cur = inFileSums.get(key);
    if (cur) cur.amount += amt;
    else inFileSums.set(key, { date: r.date, sp: r.sp, amount: amt });
  }
  // Fold this file into the global units; newest file wins per invoice.
  for (const [k, u] of inFileSums) invoiceSums.set(k, u);
}
console.log(`  Deduped to ${invoiceSums.size} invoice units.`);

const buckets = new Map();
for (const [, u] of invoiceSums) {
  const { start, end } = weekBounds(u.date);
  const key = `${start}|${end}|${u.sp}`;
  buckets.set(key, (buckets.get(key) || 0) + u.amount);
}

const payload = [];
for (const [key, amt] of buckets) {
  const [ps, pe, sp] = key.split("|");
  const rounded = Math.round(amt * 100) / 100;
  if (rounded === 0) continue;
  payload.push({ period_start: ps, period_end: pe, sp, amount: rounded });
}
console.log(`  ${payload.length} weekly rows produced.`);

// Wipe existing weekly_sales rows in the affected date span so the new
// calendar-week layout replaces the old Mon-Sun one cleanly.
const starts = payload.map(p => p.period_start).sort();
const ends = payload.map(p => p.period_end).sort();
const spanFrom = starts[0], spanTo = ends[ends.length - 1];
console.log(`  Clearing existing weekly_sales rows in ${spanFrom} .. ${spanTo} …`);
const { error: dErr } = await supabase
  .from("weekly_sales")
  .delete()
  .gte("period_end", spanFrom)
  .lte("period_start", spanTo);
if (dErr) { console.error(dErr.message); process.exit(1); }

// Upsert.
const { error: upErr } = await supabase
  .from("weekly_sales")
  .upsert(payload, { onConflict: "period_start,period_end,sp" });
if (upErr) { console.error(upErr.message); process.exit(1); }
console.log(`  ✓ upserted ${payload.length} rows.`);

// Report.
const weeks = [...new Set(payload.map(p => `${p.period_start} → ${p.period_end}`))].sort();
console.log("\nNew calendar-week buckets:");
for (const wk of weeks) {
  const t = payload.filter(p => `${p.period_start} → ${p.period_end}` === wk).reduce((s, p) => s + p.amount, 0);
  console.log(`  ${wk}  RM ${t.toLocaleString("en-MY", { minimumFractionDigits: 2 }).padStart(14)}`);
}
const total = payload.reduce((s, p) => s + p.amount, 0);
console.log(`  ${"---".padEnd(29)}  ${"-".repeat(14)}`);
console.log(`  ${"Total".padEnd(29)}  RM ${total.toLocaleString("en-MY", { minimumFractionDigits: 2 }).padStart(14)}`);
