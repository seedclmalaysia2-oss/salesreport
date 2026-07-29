// Purge every existing customer-kind archive + wipe customers_data, then
// upload the six new year-only files (2021-2026) and repopulate the
// customers_data table with sp='All' since the new files have no SP breakdown.

import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { readFileSync, statSync } from "fs";

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
const FOLDER = "Sales & Forecast";
const YEARS  = [2021, 2022, 2023, 2024, 2025, 2026];
const SP_LABEL = "All";           // placeholder rep for aggregated year files
const MONTH_COLS_0 = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28];

// Same tight-layout parser as parseCustomerRows in src/lib/parseXlsx.js.
function parseCustomerRows(rows) {
  const out = [];
  for (let i = 5; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const no = r[1];
    if (no == null || no === "") continue;
    if (typeof no === "string" && /total/i.test(no)) break;
    if (!Number.isFinite(Number(no))) continue;
    const name = r[4]; if (!name) continue;
    const months = MONTH_COLS_0.map(c => (typeof r[c] === "number" ? r[c] : 0));
    const total = months.reduce((a, b) => a + b, 0);
    out.push({
      customer: String(name).trim(),
      months,
      total: Math.round(total * 100) / 100,
    });
  }
  return out;
}

// ------------------------------------------------------------
// Step 1: purge every customer-kind data_files row + storage blob.
// ------------------------------------------------------------
console.log("=== Step 1: Purge existing customer-kind files ===");
const { data: oldFiles, error: fErr } = await supabase
  .from("data_files")
  .select("id,name,storage_path")
  .eq("kind", "customer");
if (fErr) { console.error(fErr.message); process.exit(1); }
console.log(`  Found ${oldFiles.length} customer file(s).`);
if (oldFiles.length) {
  const paths = oldFiles.map(f => f.storage_path).filter(Boolean);
  if (paths.length) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (rmErr) console.warn(`  storage warning: ${rmErr.message}`);
    else console.log(`  ✓ removed ${paths.length} storage object(s)`);
  }
  const { error: dErr } = await supabase.from("data_files").delete().in("id", oldFiles.map(f => f.id));
  if (dErr) { console.error(dErr.message); process.exit(1); }
  console.log(`  ✓ deleted ${oldFiles.length} data_files row(s)`);
}

// ------------------------------------------------------------
// Step 2: wipe customers_data table entirely.
// ------------------------------------------------------------
console.log("\n=== Step 2: Wipe customers_data ===");
const { error: cErr } = await supabase.from("customers_data").delete().gt("year", 0);
if (cErr) { console.error(cErr.message); process.exit(1); }
console.log("  ✓ customers_data cleared.");

// ------------------------------------------------------------
// Step 3: parse + archive each year file, insert into customers_data.
// ------------------------------------------------------------
console.log("\n=== Step 3: Ingest 6 year-only customer files ===");
let totalRows = 0;
for (const year of YEARS) {
  const filename = `${year} Sales Analysis by customer.xlsx`;
  const path = `${FOLDER}/${filename}`;
  console.log(`\n  ${filename}`);
  const bytes = readFileSync(path);
  const wb = XLSX.read(bytes, { type: "buffer" });
  const sheet = wb.Sheets["Page 1"] || wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const parsed = parseCustomerRows(grid);
  console.log(`    parsed ${parsed.length} customer rows`);
  if (!parsed.length) { console.log("    ✗ zero rows — skipping"); continue; }

  // Upload to storage.
  const unique = globalThis.crypto?.randomUUID?.();
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const storagePath = `uploads/${unique}-${safe}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: false,
  });
  if (upErr) { console.log(`    ✗ storage: ${upErr.message}`); continue; }
  console.log(`    ✓ storage: ${storagePath}`);

  // Archive as data_files row.
  const rowsJson = parsed.map(p => ({ sp: SP_LABEL, year, ...p }));
  const { error: iErr } = await supabase.from("data_files").insert({
    name: filename,
    kind: "customer",
    sp: SP_LABEL, // marker so the file appears grouped in the library
    year,
    row_count: parsed.length,
    size_bytes: statSync(path).size,
    storage_path: storagePath,
    visibility: "private",
    allowed_sps: [],
    rows_json: rowsJson,
    uploaded_by: null,
  });
  if (iErr) { console.log(`    ✗ data_files: ${iErr.message}`); continue; }
  console.log(`    ✓ data_files row inserted`);

  // Insert into customers_data.
  const inserts = parsed.map(p => ({
    sp: SP_LABEL,
    year,
    customer: p.customer,
    months: p.months,
    total: p.total,
  }));
  const CHUNK = 500;
  let inserted = 0;
  for (let k = 0; k < inserts.length; k += CHUNK) {
    const slice = inserts.slice(k, k + CHUNK);
    const { error: insErr } = await supabase.from("customers_data").insert(slice);
    if (insErr) { console.log(`    ✗ customers_data insert: ${insErr.message}`); break; }
    inserted += slice.length;
  }
  console.log(`    ✓ customers_data +${inserted} rows`);
  totalRows += inserted;
}

console.log(`\n=== Summary ===`);
console.log(`  ${totalRows.toLocaleString()} customer_year rows now in customers_data (sp='${SP_LABEL}')`);
