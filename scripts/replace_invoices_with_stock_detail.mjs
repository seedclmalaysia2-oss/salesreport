// One-shot cleanup + ingest.
//
// Step 1: Delete every archived Customer Invoice Listing (kind='invoice')
//         from data_files + storage bucket. The user flagged these as the
//         wrong source document (invoice-only, misses credit notes and
//         cash sales), so the whole archive gets purged.
// Step 2: Delete every weekly_sales row for 2026-07 so the July board
//         starts empty.
// Step 3: Parse the fresh 'Stock Sales Analysis - Detail 290726.xlsx',
//         bucket every invoice + credit note by Mon-Sun week per rep,
//         and upsert the totals back into weekly_sales.
//
// Runs with SUPABASE_SERVICE_ROLE_KEY from .env (bypasses RLS).

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
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

const BUCKET = "data-files";
const NEW_FILE = "Sales & Forecast/Stock Sales Analysis - Detail 290726.xlsx";

// Reuse the app's rep-name normaliser so ALAN LOH -> Alan etc.
const NAMES = {
  "alan loh": "Alan", "alan": "Alan",
  "dino lim": "Dino", "dino": "Dino",
  "khen tan": "Khen", "khen": "Khen",
  "sakinah": "Sakinah", "nor sakinah ardani": "Sakinah",
  "wani": "Wani", "nurzawani": "Wani",
  "simon low": "Simon", "simon": "Simon",
  "seed malaysia": "Seed Malaysia", "seed": "Seed Malaysia",
};
const canonSp = (raw) => NAMES[String(raw || "").trim().toLowerCase()] || null;

function weekBounds(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7;
  const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - dow + 1);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { start: iso(mon), end: iso(sun) };
}

function parseAutocountDate(s) {
  const m = String(s).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const mm = MON[m[2].toLowerCase()]; if (!mm) return null;
  let yy = parseInt(m[3], 10); if (yy < 100) yy += 2000;
  return `${yy}-${String(mm).padStart(2,"0")}-${String(parseInt(m[1], 10)).padStart(2,"0")}`;
}

// -----------------------------------------------------------------
// Step 1 — purge all invoice-kind data_files + their storage blobs.
// -----------------------------------------------------------------
console.log("=== Step 1: Purge old Customer Invoice Listing files ===");
const { data: oldFiles, error: listErr } = await supabase
  .from("data_files")
  .select("id,name,storage_path")
  .eq("kind", "invoice");
if (listErr) { console.error("list failed:", listErr.message); process.exit(1); }
console.log(`Found ${oldFiles.length} invoice file(s) to delete.`);

if (oldFiles.length) {
  const paths = oldFiles.map(f => f.storage_path).filter(Boolean);
  if (paths.length) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (rmErr) console.warn(`  storage remove warning: ${rmErr.message}`);
    else console.log(`  ✓ removed ${paths.length} storage object(s)`);
  }
  const ids = oldFiles.map(f => f.id);
  const { error: delErr } = await supabase.from("data_files").delete().in("id", ids);
  if (delErr) { console.error("row delete failed:", delErr.message); process.exit(1); }
  console.log(`  ✓ deleted ${ids.length} data_files row(s)`);
}

// -----------------------------------------------------------------
// Step 2 — wipe July 2026 from weekly_sales.
// -----------------------------------------------------------------
console.log("\n=== Step 2: Clear July 2026 weekly_sales rows ===");
// Weeks whose end falls in July, or whose Monday falls in late June (the
// 29 Jun–5 Jul boundary week the app already treats as July).
const { data: existingWeek, error: exErr } = await supabase
  .from("weekly_sales")
  .select("period_start,period_end,sp")
  .gte("period_end", "2026-06-29")
  .lte("period_start", "2026-08-02");
if (exErr) { console.error("weekly_sales query failed:", exErr.message); process.exit(1); }
console.log(`  Found ${existingWeek.length} weekly_sales row(s) overlapping July 2026.`);

if (existingWeek.length) {
  const { error: wDelErr } = await supabase
    .from("weekly_sales")
    .delete()
    .gte("period_end", "2026-06-29")
    .lte("period_start", "2026-08-02");
  if (wDelErr) { console.error("weekly_sales delete failed:", wDelErr.message); process.exit(1); }
  console.log(`  ✓ deleted ${existingWeek.length} rows.`);
}

// -----------------------------------------------------------------
// Step 3 — parse the Stock Sales Analysis - Detail file and ingest.
// -----------------------------------------------------------------
console.log(`\n=== Step 3: Parse ${NEW_FILE} ===`);
const wb = XLSX.read(readFileSync(NEW_FILE), { type: "buffer" });
const sheet = wb.Sheets["Page 1"] || wb.Sheets[wb.SheetNames[0]];
const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

// Bucket by (weekStart|weekEnd|sp) → summed net sales. Credit notes appear as
// negative net_sales rows, so summing naturally nets the returns.
const buckets = new Map();
let dataRows = 0, skipped = 0;
let minDate = null, maxDate = null;
for (let i = 3; i < grid.length; i++) {
  const r = grid[i]; if (!r) continue;
  if (r[1] === "Brand") continue; // brand header row
  const dateStr = r[1];
  const sp = canonSp(r[3]);
  const netSales = r[15];
  if (typeof dateStr !== "string" || !sp || typeof netSales !== "number") { skipped += 1; continue; }
  const iso = parseAutocountDate(dateStr); if (!iso) { skipped += 1; continue; }
  if (!minDate || iso < minDate) minDate = iso;
  if (!maxDate || iso > maxDate) maxDate = iso;
  const { start, end } = weekBounds(iso);
  const key = `${start}|${end}|${sp}`;
  buckets.set(key, (buckets.get(key) || 0) + netSales);
  dataRows += 1;
}
console.log(`  Aggregated ${dataRows} data rows (${skipped} skipped); dates ${minDate} → ${maxDate}`);

const payload = [];
for (const [key, amt] of buckets) {
  const [ps, pe, sp] = key.split("|");
  const rounded = Math.round(amt * 100) / 100;
  if (rounded === 0) continue;
  payload.push({ period_start: ps, period_end: pe, sp, amount: rounded });
}
console.log(`  ${payload.length} weekly_sales rows to upsert.`);

const { error: upErr } = await supabase
  .from("weekly_sales")
  .upsert(payload, { onConflict: "period_start,period_end,sp" });
if (upErr) { console.error("upsert failed:", upErr.message); process.exit(1); }
console.log(`  ✓ upserted ${payload.length} rows.`);

// Summary echo.
console.log("\n=== Summary ===");
const bySp = {};
for (const p of payload) bySp[p.sp] = (bySp[p.sp] || 0) + p.amount;
const spOrder = ["Alan","Dino","Khen","Sakinah","Wani","Simon","Seed Malaysia"];
for (const sp of spOrder) {
  const v = bySp[sp] || 0;
  console.log(`  ${sp.padEnd(16)} RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 2 }).padStart(14)}`);
}
const grand = payload.reduce((s, p) => s + p.amount, 0);
console.log(`  ${"---".padEnd(16)}    ${"-".repeat(14)}`);
console.log(`  ${"Total".padEnd(16)} RM ${grand.toLocaleString("en-MY", { minimumFractionDigits: 2 }).padStart(14)}`);

// Weekly buckets
console.log("\nWeekly buckets:");
const weekKeys = [...new Set(payload.map(p => `${p.period_start} → ${p.period_end}`))].sort();
for (const wk of weekKeys) {
  const total = payload.filter(p => `${p.period_start} → ${p.period_end}` === wk).reduce((s, p) => s + p.amount, 0);
  console.log(`  ${wk}  RM ${total.toLocaleString("en-MY", { minimumFractionDigits: 2 }).padStart(14)}`);
}

console.log("\n✓ Done. Refresh the Weekly Sales card to see the new numbers.");
