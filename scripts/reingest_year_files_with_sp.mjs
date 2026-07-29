// Re-parse the six 2021-2026 year-only customer files with the fixed
// Salesman-column-aware parser and rewrite customers_data with true per-SP
// attribution (no more brand_sales_data cross-reference or 'All' bucket).

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
  "alan loh": "Alan", "dino lim": "Dino", "khen tan": "Khen",
  "sakinah": "Sakinah", "nor sakinah ardani": "Sakinah",
  "wani": "Wani", "nurzawani": "Wani",
  "simon low": "Simon", "seed malaysia": "Seed Malaysia",
  "jerry wong": "Jerry", "salim": "Salim",
};
const canonSp = (raw) => NAMES[String(raw || "").trim().toLowerCase()] || null;

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function detectLayout(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r]; if (!row) continue;
    let customerCol = -1, salesmanCol = -1;
    const monthCols = new Array(12).fill(-1);
    for (let c = 0; c < row.length; c++) {
      const v = row[c]; if (typeof v !== "string") continue;
      const s = v.trim();
      if (s === "Customer Name" || s === "Customer") customerCol = c;
      if (s === "Salesman" || s === "Sales Person" || s === "AcSalesmanID") salesmanCol = c;
      const m = s.match(/^([A-Za-z]{3})\b/);
      if (m) {
        const canon = m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase();
        const idx = MONTH_ABBR.indexOf(canon);
        if (idx >= 0 && monthCols[idx] < 0) monthCols[idx] = c;
      }
    }
    if (customerCol >= 0 && monthCols.filter(c => c >= 0).length >= 6) {
      // Amount lives at the same col as the label (merged header, blank on right).
      return { headerRow: r, customerCol, amountCols: monthCols, salesmanCol };
    }
  }
  return null;
}

function parseCustomerRows(rows) {
  const layout = detectLayout(rows); if (!layout) return [];
  const { headerRow, customerCol, amountCols, salesmanCol } = layout;
  const out = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const name = r[customerCol];
    if (name == null || name === "") continue;
    if (typeof name === "string" && /^\s*total/i.test(name)) break;
    if (typeof name !== "string") continue;
    const months = amountCols.map(c => (c >= 0 && typeof r[c] === "number" ? r[c] : 0));
    const total = months.reduce((a, b) => a + b, 0);
    if (total === 0 && months.every(m => m === 0)) continue;
    const sp = salesmanCol >= 0 ? canonSp(r[salesmanCol]) : null;
    out.push({
      customer: String(name).trim(),
      months,
      total: Math.round(total * 100) / 100,
      sp,
    });
  }
  return out;
}

// ------------------------------------------------------------
console.log("Loading live customer files from data_files …");
const { data: files } = await supabase
  .from("data_files")
  .select("id,name,year,storage_path")
  .eq("kind", "customer")
  .is("deleted_at", null)
  .order("year");
console.log(`  ${files.length} live file(s).`);

console.log("\nWiping customers_data …");
const { error: delErr } = await supabase.from("customers_data").delete().gt("year", 0);
if (delErr) { console.error(delErr.message); process.exit(1); }

console.log("\nRe-parsing each file and inserting rows …");
const yearMostRecent = new Map(); // year -> file (only reuse newest per year)
for (const f of files) {
  const prev = yearMostRecent.get(f.year);
  if (!prev || f.id > prev.id) yearMostRecent.set(f.year, f);
}

let grandRows = 0;
const yearTotals = {};
const globalUnattributed = [];
for (const [year, f] of [...yearMostRecent.entries()].sort()) {
  const { data: signed } = await supabase.storage.from("data-files").createSignedUrl(f.storage_path, 300);
  const buf = await (await fetch(signed.signedUrl)).arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets["Page 1"] || wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
  const parsed = parseCustomerRows(grid);
  const unattr = parsed.filter(p => !p.sp).length;
  console.log(`  ${year}: ${parsed.length} rows parsed (${unattr} unattributed → 'All')`);
  if (unattr) globalUnattributed.push({ year, count: unattr });

  // Rewrite this year's data_files.rows_json so future Recalculate/Reprocess
  // sees the per-sp attribution instead of the old blanket-'All' rows.
  const rowsJson = parsed.map(p => ({
    sp: p.sp || "All",
    year,
    customer: p.customer,
    months: p.months,
    total: p.total,
  }));
  await supabase.from("data_files").update({ rows_json: rowsJson, row_count: parsed.length }).eq("id", f.id);

  // Insert straight into customers_data.
  const CHUNK = 500;
  const inserts = rowsJson.map(({ sp, year, customer, months, total }) => ({
    sp, year, customer, months, total,
  }));
  for (let k = 0; k < inserts.length; k += CHUNK) {
    const { error } = await supabase.from("customers_data").insert(inserts.slice(k, k + CHUNK));
    if (error) { console.error(`  ✗ ${year}: ${error.message}`); process.exit(1); }
  }
  grandRows += inserts.length;
  const bySp = {};
  for (const r of inserts) bySp[r.sp] = (bySp[r.sp] || 0) + r.total;
  yearTotals[year] = bySp;
}

console.log(`\n✓ inserted ${grandRows} rows.\n`);

// Per-year, per-SP report.
const allSps = [...new Set(Object.values(yearTotals).flatMap(v => Object.keys(v)))].sort();
console.log("Per-year totals by SP:");
console.log("  " + "Year".padEnd(6) + allSps.map(s => s.padEnd(14)).join(""));
for (const y of [...Object.keys(yearTotals)].sort()) {
  console.log("  " + String(y).padEnd(6) + allSps.map(sp => {
    const v = yearTotals[y][sp] || 0;
    return (v ? Math.round(v).toLocaleString("en-MY") : "—").padEnd(14);
  }).join(""));
}
