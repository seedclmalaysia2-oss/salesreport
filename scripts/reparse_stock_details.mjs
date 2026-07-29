// For every live Stock Sales Analysis - Detail file in data_files:
//  1. Download the xlsx from storage
//  2. Re-parse with the fixed layout-aware parser (matches parseXlsx.js exactly)
//  3. Update data_files.rows_json + row_count
// Then rebuild weekly_sales from the freshly-parsed rows using the calendar
// week bucketing.

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

const NAMES = {
  "alan loh":"Alan","dino lim":"Dino","khen tan":"Khen",
  "sakinah":"Sakinah","nor sakinah ardani":"Sakinah",
  "wani":"Wani","nurzawani":"Wani",
  "simon low":"Simon","seed malaysia":"Seed Malaysia",
};
const canonSp = (raw) => NAMES[String(raw||"").trim().toLowerCase()] || null;

function parseAutocountDate(s) {
  const str = String(s).trim();
  const dashMon = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (dashMon) {
    const MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const mm = MON[dashMon[2].toLowerCase()]; if (!mm) return null;
    let yy = parseInt(dashMon[3],10); if (yy<100) yy+=2000;
    return `${yy}-${String(mm).padStart(2,"0")}-${String(parseInt(dashMon[1],10)).padStart(2,"0")}`;
  }
  const numeric = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (numeric) {
    const dd = parseInt(numeric[1],10);
    const mm = parseInt(numeric[2],10);
    if (mm<1 || mm>12) return null;
    let yy = parseInt(numeric[3],10); if (yy<100) yy+=2000;
    return `${yy}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
  }
  return null;
}

function findLayout(rows) {
  const scan = Math.min(rows.length, 30);
  for (let r = 0; r < scan; r++) {
    const row = rows[r]; if (!row) continue;
    const dateCol = row.findIndex(c => typeof c === "string" && c.trim() === "Date");
    if (dateCol < 0) continue;
    const docCol = row.findIndex(c => typeof c === "string" && /^Document\s*No/i.test(c.trim()));
    const spCol  = row.findIndex(c => typeof c === "string" && /^Sales(man|_?person|_?ID)?$/i.test(c.trim()));
    const amtCol = row.findIndex(c => typeof c === "string" && /^Net\s*Sales$/i.test(c.trim()));
    if (docCol >= 0 && amtCol >= 0) {
      return { headerRow: r, dateCol, docCol, spCol: spCol >= 0 ? spCol : docCol + 1, amtCol };
    }
  }
  return null;
}

function parseStockDetail(rows) {
  const layout = findLayout(rows); if (!layout) return { rows: [], layout: null };
  const { headerRow, dateCol, docCol, spCol, amtCol } = layout;
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]; if (!row) continue;
    if (row[dateCol] === "Brand") continue;
    const dateStr = row[dateCol]; if (typeof dateStr !== "string") continue;
    const sp = canonSp(row[spCol]); if (!sp) continue;
    const amount = row[amtCol]; if (typeof amount !== "number") continue;
    const date = parseAutocountDate(dateStr); if (!date) continue;
    const doc = row[docCol] ?? null;
    out.push({ date, invoice: doc ? String(doc) : null, customer: null, amount: Math.round(amount*100)/100, sp });
  }
  return { rows: out, layout };
}

function weekBounds(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wIdx = Math.floor((d - 1) / 7);
  const startDay = wIdx * 7 + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const endDay = Math.min(startDay + 6, lastDay);
  const pad = (n) => String(n).padStart(2, "0");
  return { start: `${y}-${pad(m)}-${pad(startDay)}`, end: `${y}-${pad(m)}-${pad(endDay)}` };
}

// -----------------------------------------------------------
console.log("Loading live invoice-kind files…");
const { data: files } = await supabase
  .from("data_files")
  .select("id,name,storage_path")
  .eq("kind","invoice")
  .is("deleted_at",null);
console.log(`  ${files.length} file(s).\n`);

const perFileRows = [];
for (const f of files) {
  const { data: signed } = await supabase.storage.from("data-files").createSignedUrl(f.storage_path, 300);
  const buf = await (await fetch(signed.signedUrl)).arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const sheet = wb.Sheets["Page 1"] || wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header:1, defval:null, raw:true });
  const { rows, layout } = parseStockDetail(grid);
  const yearFromRows = rows.map(r => parseInt(r.date.slice(0,4),10)).find(y => Number.isFinite(y)) ?? null;
  const lo = layout ? `date=${layout.dateCol} doc=${layout.docCol} sp=${layout.spCol} amt=${layout.amtCol}` : "no header found";
  console.log(`  ${f.name}  ->  ${rows.length} rows  (${lo})`);
  await supabase.from("data_files").update({
    rows_json: rows,
    row_count: rows.length,
    year: yearFromRows,
  }).eq("id", f.id);
  perFileRows.push({ file: f, rows });
}

// Build weekly_sales from dedup'd invoices (newest file wins per invoice number).
console.log("\nBuilding weekly buckets…");
const sortedFiles = [...perFileRows].sort((a, b) => a.file.name.localeCompare(b.file.name));
const invoiceUnits = new Map();
for (const { rows } of sortedFiles) {
  const inFile = new Map();
  for (const r of rows) {
    const key = r.invoice ? `inv|${r.invoice}` : `raw|${r.date}|${r.sp}|${r.amount}`;
    const cur = inFile.get(key);
    if (cur) cur.amount += r.amount;
    else inFile.set(key, { date: r.date, sp: r.sp, amount: r.amount });
  }
  for (const [k, u] of inFile) invoiceUnits.set(k, u);
}
console.log(`  ${invoiceUnits.size} deduped invoice units.`);

const buckets = new Map();
for (const [, u] of invoiceUnits) {
  const { start, end } = weekBounds(u.date);
  const key = `${start}|${end}|${u.sp}`;
  buckets.set(key, (buckets.get(key) || 0) + u.amount);
}
const payload = [];
for (const [key, amt] of buckets) {
  const [ps, pe, sp] = key.split("|");
  const rounded = Math.round(amt*100)/100;
  if (rounded === 0) continue;
  payload.push({ period_start: ps, period_end: pe, sp, amount: rounded });
}
console.log(`  ${payload.length} weekly_sales rows to upsert.`);

// Wipe existing rows in the span, then upsert.
if (payload.length) {
  const starts = payload.map(p => p.period_start).sort();
  const ends = payload.map(p => p.period_end).sort();
  console.log(`  Clearing weekly_sales in ${starts[0]} .. ${ends[ends.length-1]}…`);
  const { error: delErr } = await supabase.from("weekly_sales").delete()
    .gte("period_end", starts[0]).lte("period_start", ends[ends.length-1]);
  if (delErr) { console.error(delErr.message); process.exit(1); }
  const { error: upErr } = await supabase.from("weekly_sales")
    .upsert(payload, { onConflict: "period_start,period_end,sp" });
  if (upErr) { console.error(upErr.message); process.exit(1); }
  console.log(`  ✓ upserted ${payload.length} rows.`);
}

// Report per-month totals.
console.log("\nMonthly totals:");
const monthTotals = new Map();
for (const p of payload) {
  const mk = p.period_start.slice(0, 7);
  monthTotals.set(mk, (monthTotals.get(mk) || 0) + p.amount);
}
for (const [mk, t] of [...monthTotals.entries()].sort()) {
  console.log(`  ${mk}  RM ${t.toLocaleString("en-MY", { minimumFractionDigits: 2 }).padStart(14)}`);
}
console.log(`\n  Grand total  RM ${payload.reduce((s,p)=>s+p.amount,0).toLocaleString("en-MY", { minimumFractionDigits: 2 }).padStart(14)}`);
