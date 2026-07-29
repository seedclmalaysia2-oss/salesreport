// Download each uploaded Stock Sales Analysis - Detail file from storage,
// run the same parser the browser used, and report row counts + the first
// header rows so we can see why they came back empty.

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
function parseDMY(s) {
  const m = String(s).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  const mm = MON[m[2].toLowerCase()]; if (!mm) return null;
  let yy = parseInt(m[3],10); if (yy<100) yy+=2000;
  return `${yy}-${String(mm).padStart(2,"0")}-${String(parseInt(m[1],10)).padStart(2,"0")}`;
}

const { data: files } = await supabase
  .from("data_files")
  .select("id,name,storage_path,row_count,rows_json")
  .eq("kind","invoice")
  .is("deleted_at",null);

console.log(`Found ${files.length} live invoice file(s).\n`);

for (const f of files) {
  console.log(`=== ${f.name} ===`);
  console.log(`  DB row_count: ${f.row_count}, rows_json length: ${Array.isArray(f.rows_json) ? f.rows_json.length : "not-array"}`);

  const { data: signed, error: sErr } = await supabase.storage.from("data-files")
    .createSignedUrl(f.storage_path, 120);
  if (sErr) { console.log(`  ✗ signed URL: ${sErr.message}`); continue; }
  const resp = await fetch(signed.signedUrl);
  const buf = await resp.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  console.log(`  Sheets: ${wb.SheetNames.join(", ")}`);
  const sheet = wb.Sheets["Page 1"] || wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header:1, defval:null, raw:true });
  console.log(`  grid.length: ${grid.length}`);

  console.log(`  First 6 non-empty rows (col samples):`);
  let shown = 0;
  for (let i = 0; i < grid.length && shown < 6; i++) {
    const r = grid[i]; if (!r || r.every(c => c==null || c==="")) continue;
    const nn = r.map((c,j)=>c==null||c===""?null:`[${j}]=${JSON.stringify(c).slice(0,40)}`).filter(Boolean);
    console.log(`    row ${i}: ${nn.slice(0,6).join(" ")}${nn.length>6?" ...":""}`);
    shown += 1;
  }

  // Try the parser the app uses.
  let parsedCount = 0;
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
    parsedCount += 1;
  }
  console.log(`  Parser (row[1]=date, row[3]=sp, row[15]=amt, parseDMY) yields: ${parsedCount} rows`);
  console.log();
}
