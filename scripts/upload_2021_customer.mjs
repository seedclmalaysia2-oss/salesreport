// Upload the missing 2021 Sales Analysis by customer file to storage + data_files.
import { createClient } from "@supabase/supabase-js";
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

const filename = "2021 Sales Analysis by customer.xlsx";
const path = `Sales & Forecast/${filename}`;
const bytes = readFileSync(path);
const size = statSync(path).size;
const unique = globalThis.crypto.randomUUID();
const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
const storagePath = `uploads/${unique}-${safe}`;

const { error: upErr } = await supabase.storage.from("data-files").upload(storagePath, bytes, {
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  upsert: false,
});
if (upErr) { console.error(upErr.message); process.exit(1); }
console.log(`storage: ${storagePath}`);

const { error: iErr } = await supabase.from("data_files").insert({
  name: filename,
  kind: "customer",
  sp: "All",
  year: 2021,
  row_count: 0, // will be set by re-ingest
  size_bytes: size,
  storage_path: storagePath,
  visibility: "private",
  allowed_sps: [],
  rows_json: [],
  uploaded_by: null,
});
if (iErr) { console.error(iErr.message); process.exit(1); }
console.log("data_files row inserted for 2021");
