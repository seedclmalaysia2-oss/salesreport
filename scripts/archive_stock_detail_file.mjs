// Archive the Stock Sales Analysis - Detail file into data_files + storage
// so it appears in the Data-tab library and the Weekly Sales card's
// "Source:" line, then re-run the weekly sync as a safety net. The earlier
// replace_invoices_with_stock_detail script wrote weekly_sales directly but
// skipped the archive step — this closes that gap.

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
const FILE_PATH = "Sales & Forecast/Stock Sales Analysis - Detail 290726.xlsx";
const FILENAME = "Stock Sales Analysis - Detail 290726.xlsx";

// Rep-name normaliser (same as the app's).
const NAMES = {
  "alan loh": "Alan", "dino lim": "Dino", "khen tan": "Khen",
  "sakinah": "Sakinah", "nor sakinah ardani": "Sakinah",
  "wani": "Wani", "nurzawani": "Wani",
  "simon low": "Simon", "seed malaysia": "Seed Malaysia",
};
const canonSp = (raw) => NAMES[String(raw || "").trim().toLowerCase()] || null;

function parseDMY(s) {
  const m = String(s).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const mm = MON[m[2].toLowerCase()]; if (!mm) return null;
  let yy = parseInt(m[3], 10); if (yy < 100) yy += 2000;
  return `${yy}-${String(mm).padStart(2,"0")}-${String(parseInt(m[1], 10)).padStart(2,"0")}`;
}

console.log(`=== Archiving ${FILENAME} ===`);

// Parse rows to store in rows_json (so the Weekly Sales card can show source,
// and the Data-tab View modal can render the detail).
const bytes = readFileSync(FILE_PATH);
const wb = XLSX.read(bytes, { type: "buffer" });
const sheet = wb.Sheets["Page 1"] || wb.Sheets[wb.SheetNames[0]];
const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

const parsedRows = [];
for (const row of grid) {
  if (!row) continue;
  if (row[1] === "Brand") continue;
  const dateStr = row[1];
  if (typeof dateStr !== "string") continue;
  const sp = canonSp(row[3]);
  if (!sp) continue;
  const amount = row[15];
  if (typeof amount !== "number") continue;
  const date = parseDMY(dateStr);
  if (!date) continue;
  const doc = row[2] ?? null;
  parsedRows.push({
    date,
    invoice: doc ? String(doc) : null,
    customer: null,
    amount: Math.round(amount * 100) / 100,
    sp,
  });
}
const yearFromRows = parsedRows.map(r => r.date && parseInt(r.date.slice(0, 4), 10)).find(y => Number.isFinite(y)) ?? 2026;
console.log(`  Parsed ${parsedRows.length} rows, derived year ${yearFromRows}.`);

// Storage upload (unique path so we never overwrite an existing blob).
const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const safe = FILENAME.replace(/[^A-Za-z0-9._-]/g, "_");
const storagePath = `uploads/${unique}-${safe}`;
const upResp = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  upsert: false,
});
if (upResp.error) { console.error("storage upload failed:", upResp.error.message); process.exit(1); }
console.log(`  ✓ uploaded to storage: ${storagePath}`);

// Insert data_files row.
const insResp = await supabase.from("data_files").insert({
  name: FILENAME,
  kind: "invoice",
  sp: null,
  year: yearFromRows,
  row_count: parsedRows.length,
  size_bytes: statSync(FILE_PATH).size,
  storage_path: storagePath,
  visibility: "private",
  allowed_sps: [],
  rows_json: parsedRows,
  uploaded_by: null,
}).select().single();
if (insResp.error) { console.error("insert failed:", insResp.error.message); process.exit(1); }
console.log(`  ✓ data_files row: id=${insResp.data.id}`);

console.log("\n✓ Done. The file now shows up in the Data-tab library and as the source on the Weekly Sales card.");
