// Browser-side port of scripts/build_data.py.
// Given an array of File objects (uploaded xlsx), returns the aggregated
// dashboard payload in the same shape as src/data.json.

import * as XLSX from "xlsx";

const MONTH_COLS_0 = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]; // 0-indexed

const FNAME_RE = /^(.+?) (\d{4}) (Sales Analysis by customer|Stock Sales Analysis - Summary by [Bb]rand)\.xlsx$/i;

// Brand IDs ending in FC (Free of Charge / boxes), T or TR (Trial Lens / pieces)
// have no revenue and must not be counted as paid sales. Filter at parse time.
export function isSalesBrand(brand) {
  if (!brand || typeof brand !== "string") return false;
  const bid = brand.trim().toUpperCase();
  if (!bid || bid === "TOTAL") return false;
  if (bid.endsWith("FC")) return false;
  if (bid.endsWith("TR")) return false;
  if (bid.endsWith("T")) return false;
  return true;
}

export function parseFilename(name) {
  const m = name.match(FNAME_RE);
  if (!m) return null;
  return { sp: m[1].trim(), year: parseInt(m[2], 10), kind: m[3] };
}

function sheetToRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
}

function parseCustomerRows(rows) {
  const out = [];
  for (let i = 5; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const no = r[1];
    if (no == null || no === "") continue;
    if (typeof no === "string" && /total/i.test(no)) break;
    const noNum = Number(no);
    if (!Number.isFinite(noNum)) continue;
    const name = r[4];
    if (!name) continue;
    const months = MONTH_COLS_0.map(c => {
      const v = r[c];
      return typeof v === "number" ? v : 0;
    });
    const total = months.reduce((a, b) => a + b, 0);
    out.push({
      customer: String(name).trim(),
      months,
      total: Math.round(total * 100) / 100,
    });
  }
  return out;
}

function parseBrandRows(rows) {
  // Find first brand col: row 7 (1-indexed) = rows[6] (0-indexed) contains 'AcStockBrandID'
  let firstBrandCol = -1;
  if (rows[6]) {
    for (let c = 0; c < rows[6].length; c++) {
      if (rows[6][c] === "AcStockBrandID") { firstBrandCol = c; break; }
    }
  }
  if (firstBrandCol < 0) {
    // fallback: scan row 7 for first brand-id-looking string
    if (rows[7]) {
      for (let c = 0; c < rows[7].length; c++) {
        const v = rows[7][c];
        if (typeof v === "string" && v.trim() &&
            v !== "GroupingOption_ID" && v !== "MasterData") {
          firstBrandCol = c;
          break;
        }
      }
    }
  }
  if (firstBrandCol < 0) return [];

  const brandCols = {};
  if (rows[7]) {
    for (let c = firstBrandCol; c < rows[7].length; c++) {
      const v = rows[7][c];
      if (typeof v === "string" && v.trim()) brandCols[c] = v.trim();
    }
  }

  // Find Amt label column
  let amtCol = -1;
  for (let r = 8; r < Math.min(rows.length, 50); r++) {
    if (!rows[r]) continue;
    for (let c = 0; c < firstBrandCol; c++) {
      if (rows[r][c] === "Amt") { amtCol = c; break; }
    }
    if (amtCol >= 0) break;
  }
  if (amtCol < 0) return [];

  const out = [];
  for (let r = 8; r < rows.length; r++) {
    if (!rows[r]) continue;
    if (rows[r][amtCol] !== "Amt") continue;
    const cust = rows[r][1];
    if (!cust) continue;
    const custStr = String(cust).trim();
    if (custStr.toLowerCase() === "total") break;
    for (const cKey of Object.keys(brandCols)) {
      const c = Number(cKey);
      const brand = brandCols[c];
      if (!isSalesBrand(brand)) continue;
      const v = rows[r][c];
      if (typeof v === "number" && v !== 0) {
        out.push({ customer: custStr, brand, amt: v });
      }
    }
  }
  return out;
}

async function readWorkbook(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array", cellDates: false });
}

export async function parseFile(file) {
  const fnameInfo = parseFilename(file.name);
  if (!fnameInfo) {
    return { ok: false, file: file.name, error: "Filename does not match expected pattern" };
  }
  let wb;
  try {
    wb = await readWorkbook(file);
  } catch (e) {
    return { ok: false, file: file.name, error: `Failed to read xlsx: ${e.message}` };
  }
  const sheet = wb.Sheets["Page 1"] || wb.Sheets[wb.SheetNames[0]];
  if (!sheet) {
    return { ok: false, file: file.name, error: "No 'Page 1' sheet found" };
  }
  const rows = sheetToRows(sheet);

  if (fnameInfo.kind === "Sales Analysis by customer") {
    const parsed = parseCustomerRows(rows);
    return {
      ok: true,
      file: file.name,
      kind: "customer",
      sp: fnameInfo.sp,
      year: fnameInfo.year,
      rowCount: parsed.length,
      rows: parsed.map(p => ({ sp: fnameInfo.sp, year: fnameInfo.year, ...p })),
    };
  } else {
    const parsed = parseBrandRows(rows);
    return {
      ok: true,
      file: file.name,
      kind: "brand",
      sp: fnameInfo.sp,
      year: fnameInfo.year,
      rowCount: parsed.length,
      rows: parsed.map(p => ({ sp: fnameInfo.sp, year: fnameInfo.year, ...p })),
    };
  }
}

export function aggregate(customerRows, brandRows) {
  const sumMap = new Map();
  for (const r of customerRows) {
    const key = `${r.sp}|${r.year}`;
    let s = sumMap.get(key);
    if (!s) {
      s = { sp: r.sp, year: r.year, total: 0, customers: 0, months: new Array(12).fill(0) };
      sumMap.set(key, s);
    }
    s.total += r.total;
    if (r.total > 0) s.customers += 1;
    for (let i = 0; i < 12; i++) s.months[i] += r.months[i];
  }
  const summary = [...sumMap.values()].map(s => ({
    ...s,
    total: Math.round(s.total * 100) / 100,
    months: s.months.map(m => Math.round(m * 100) / 100),
  }));
  summary.sort((a, b) => (a.sp < b.sp ? -1 : a.sp > b.sp ? 1 : a.year - b.year));

  const custTotals = new Map();
  for (const r of customerRows) {
    custTotals.set(r.customer, (custTotals.get(r.customer) || 0) + r.total);
  }
  const topCustomers = [...custTotals.entries()]
    .map(([customer, total]) => ({ customer, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  const salespeople = [...new Set(customerRows.map(r => r.sp))].sort();
  const years = [...new Set(customerRows.map(r => r.year))].sort();
  const brands = [...new Set(brandRows.map(r => r.brand))].sort();

  return {
    salespeople,
    years,
    brands,
    summary,
    topCustomers,
    customers: customerRows,
    brandSales: brandRows,
  };
}

// High-level: given an array of File objects, parse each and aggregate.
export async function buildDataFromFiles(files, onProgress) {
  const fileResults = [];
  let i = 0;
  for (const f of files) {
    onProgress && onProgress({ index: i, total: files.length, file: f.name });
    const res = await parseFile(f);
    fileResults.push(res);
    i++;
  }
  const customerRows = [];
  const brandRows = [];
  for (const res of fileResults) {
    if (!res.ok) continue;
    if (res.kind === "customer") customerRows.push(...res.rows);
    else brandRows.push(...res.rows);
  }
  const data = aggregate(customerRows, brandRows);
  return { data, fileResults };
}
