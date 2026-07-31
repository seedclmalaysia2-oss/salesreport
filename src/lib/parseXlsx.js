// Browser-side port of scripts/build_data.py.
// Given an array of File objects (uploaded xlsx), returns the aggregated
// dashboard payload in the same shape as src/data.json.

// xlsx is by far the heaviest dependency here, and it is only needed when
// someone actually parses an uploaded workbook — which only admins ever do.
// Loading it on demand keeps it out of the initial bundle, so a normal user
// never downloads it. parseFilename()/isSalesBrand() below stay synchronous
// because they are pure string work and the upload UI calls them per keystroke.
let _xlsxPromise = null;
function loadXlsx() {
  if (!_xlsxPromise) _xlsxPromise = import("xlsx");
  return _xlsxPromise;
}

const MONTH_COLS_0 = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]; // 0-indexed

const FNAME_RE = /^(.+?) (\d{4}) (Sales Analysis by customer|Stock Sales Analysis - Summary by [Bb]rand)\.xlsx$/i;

// Year-only customer file: '2026 Sales Analysis by customer.xlsx' — no SP
// prefix. Introduced when ops switched to a single team-wide export per year.
const YEAR_ONLY_CUSTOMER_FNAME_RE = /^(\d{4}) Sales Analysis by customer\.xlsx$/i;

// Same year-only customer export with the year moved to the END:
// 'Sales Analysis 2026.xlsx' (optionally 'Sales Analysis by customer 2026.xlsx').
// The naming the ops team now uses — treated identically to the year-first form.
const SALES_ANALYSIS_YEAR_FNAME_RE = /^Sales Analysis(?: by customer)?\s+(\d{4})\.xlsx$/i;

// The Customer Invoice Listing exports don't carry an SP or a fixed year in
// their filename. The convention is 'Customer Invoice Listing <suffix>.xlsx'
// where the suffix is a period stamp like '26jul2026', 'jul2026', 'July',
// 'jun2026', etc. Any 4-digit 20xx in the suffix gives us the year.
const INVOICE_FNAME_RE = /^Customer Invoice Listing\s+(.+?)\.xlsx$/i;

// 'Stock Sales Analysis - Detail <suffix>.xlsx' — the wider Autocount export
// the ops team switched to on 2026-07-29. Unlike the invoice listing, it
// includes credit notes and debit notes alongside invoices, so the weekly
// totals net returns automatically. Suffix is a date stamp like '290726'
// (ddmmyy) or 'jul2026' etc.
const STOCK_DETAIL_FNAME_RE = /^Stock Sales Analysis - Detail\s+(.+?)\.xlsx$/i;

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

// Grab a 4-digit year from a Stock-Detail-style suffix. Handles both
// 'ddmmyy' shorthand (e.g. '290726' -> 2026) and 'jul2026' / '2026' forms.
function yearFromSuffix(suffix) {
  const m4 = suffix.match(/(20\d{2})/);
  if (m4) return parseInt(m4[1], 10);
  // ddmmyy at the tail — the last two digits are the two-digit year.
  const m6 = suffix.match(/(\d{2})(\d{2})(\d{2})\b/);
  if (m6) return 2000 + parseInt(m6[3], 10);
  return null;
}

export function parseFilename(name) {
  const m = name.match(FNAME_RE);
  if (m) return { sp: m[1].trim(), year: parseInt(m[2], 10), kind: m[3] };
  const ym = name.match(YEAR_ONLY_CUSTOMER_FNAME_RE);
  if (ym) {
    // No SP in the filename — mark as 'All' so the ingest path stays uniform
    // with the year-only exports the ops team now ships.
    return { sp: "All", year: parseInt(ym[1], 10), kind: "Sales Analysis by customer" };
  }
  const say = name.match(SALES_ANALYSIS_YEAR_FNAME_RE);
  if (say) {
    return { sp: "All", year: parseInt(say[1], 10), kind: "Sales Analysis by customer" };
  }
  const im = name.match(INVOICE_FNAME_RE);
  if (im) {
    const suffix = im[1];
    return {
      sp: null,
      year: yearFromSuffix(suffix),
      kind: "Customer Invoice Listing",
      periodLabel: suffix.trim(),
    };
  }
  const sm = name.match(STOCK_DETAIL_FNAME_RE);
  if (sm) {
    const suffix = sm[1];
    return {
      sp: null,
      year: yearFromSuffix(suffix),
      kind: "Stock Sales Analysis - Detail",
      periodLabel: suffix.trim(),
    };
  }
  return null;
}

function sheetToRows(XLSX, sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
}

// The Autocount "Sales Analysis by Customer" export shipped in TWO layouts:
//   * 2022–2025 (tight): header at row 5, customer at col 4, months at
//     fixed cols 6/8/10/…/28.
//   * 2026+ (wide):      header ~row 7, "Customer Name" at col 3, months
//     on irregular offsets (col 15/21/28/34/40/46/53/58/63/68/73/78 for
//     the header labels; the amount cell is one column LEFT of each label).
// Rather than gate on filename year, scan for the header row and derive
// the customer column + per-month amount columns from the "MMM YY" labels.
// Falls back to the legacy fixed offsets if the auto-detect finds no
// header (i.e. plain older files with no visible month row).
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function detectCustomerLayout(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r]; if (!row) continue;
    let customerCol = -1;
    let salesmanCol = -1;
    const monthCols = new Array(12).fill(-1);
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v !== "string") continue;
      const s = v.trim();
      if (s === "Customer Name" || s === "Customer") customerCol = c;
      // The year-only Sales Analysis exports carry a per-row Salesman column
      // at the far right (col 32 in the observed files). Auto-detect it so
      // the parser attributes each customer's revenue to their rep instead
      // of dumping every row into 'All'.
      if (s === "Salesman" || s === "Sales Person" || s === "SalesmanID" || s === "AcSalesmanID") {
        salesmanCol = c;
      }
      const m = s.match(/^([A-Za-z]{3})\b/);
      if (m) {
        const canon = m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase();
        const idx = MONTH_ABBR.indexOf(canon);
        if (idx >= 0 && monthCols[idx] < 0) monthCols[idx] = c;
      }
    }
    const monthsFound = monthCols.filter(c => c >= 0).length;
    // 6+ months is enough to be confident this is the header row.
    if (customerCol >= 0 && monthsFound >= 6) {
      // Amount cell sits at the same column as its month header (the header
      // is a merged pair — label on the left cell, blank on the right).
      return { headerRow: r, customerCol, amountCols: monthCols, salesmanCol };
    }
  }
  return null;
}

function parseCustomerRows(rows) {
  const layout = detectCustomerLayout(rows);
  if (layout) {
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
      // Skip padding/spacer rows the export inserts between customers.
      if (total === 0 && months.every(m => m === 0)) continue;
      // Per-row salesman when the file provides it (year-only exports since
      // 2026). Null when the file's a per-SP export — caller supplies the sp
      // from the filename in that case.
      const smRaw = salesmanCol >= 0 ? r[salesmanCol] : null;
      const sp = smRaw ? canonInvoiceSp(smRaw) : null;
      out.push({
        customer: String(name).trim(),
        months,
        total: Math.round(total * 100) / 100,
        ...(sp ? { sp } : {}),
      });
    }
    return out;
  }

  // Fallback: legacy fixed-offset layout (2022-2025 exports without an
  // explicit MMM YY header row.)
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

  // Scan rows building blocks of (customer, amtRow, qtyRow).
  const blocks = [];
  let pending = null;
  for (let r = 8; r < rows.length; r++) {
    if (!rows[r]) continue;
    const label = rows[r][amtCol];
    const cust = rows[r][1];
    if (label === "Amt") {
      if (cust) {
        const cs = String(cust).trim();
        if (cs.toLowerCase() === "total") break;
        pending = { customer: cs, amtRow: r };
      }
    } else if (label === "Qty" && pending) {
      blocks.push({ ...pending, qtyRow: r });
      pending = null;
    }
  }
  if (pending) blocks.push({ ...pending, qtyRow: null });

  const out = [];
  for (const blk of blocks) {
    for (const cKey of Object.keys(brandCols)) {
      const c = Number(cKey);
      const brand = brandCols[c];
      if (!isSalesBrand(brand)) continue;
      const amtV = rows[blk.amtRow]?.[c];
      const qtyV = blk.qtyRow != null ? rows[blk.qtyRow]?.[c] : null;
      const amt = typeof amtV === "number" && amtV !== 0 ? amtV : 0;
      const qty = typeof qtyV === "number" && qtyV !== 0 ? qtyV : 0;
      if (amt !== 0 || qty !== 0) {
        out.push({ customer: blk.customer, brand, amt, qty });
      }
    }
  }
  return out;
}

async function readWorkbook(file) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  return { XLSX, wb: XLSX.read(buf, { type: "array", cellDates: false }) };
}

// Autocount 'Customer Invoice Listing' export: one row per invoice line, with
// date, invoice number, customer and salesman on fixed column offsets. We only
// keep the sales-line rows (numeric amount + known salesman) so the archived
// row set is small enough to store as rows_json without blowing up the row.
const INVOICE_SP_NAMES = {
  "alan loh": "Alan", "alan": "Alan",
  "dino lim": "Dino", "dino": "Dino",
  "khen tan": "Khen", "khen": "Khen",
  "sakinah": "Sakinah", "nor sakinah ardani": "Sakinah", "nor sakinah": "Sakinah",
  "wani": "Wani", "nurzawani": "Wani",
  "simon low": "Simon", "simon": "Simon",
  "seed malaysia": "Seed Malaysia", "seed": "Seed Malaysia",
  // Reps that appear on the year-only Sales Analysis exports (2021-2025 legacy).
  "jerry wong": "Jerry", "jerry": "Jerry",
  "salim": "Salim",
};
function canonInvoiceSp(raw) {
  return INVOICE_SP_NAMES[String(raw || "").trim().toLowerCase()] || null;
}
function parseAutocountDate(s) {
  const str = String(s).trim();
  // '02-Jul-26' or '02-Jul-2026' — the format the Customer Invoice Listing
  // and older Stock Detail exports use.
  const dashMon = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (dashMon) {
    const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const mm = MON[dashMon[2].toLowerCase()]; if (!mm) return null;
    let yy = parseInt(dashMon[3], 10); if (yy < 100) yy += 2000;
    return `${yy}-${String(mm).padStart(2,"0")}-${String(parseInt(dashMon[1], 10)).padStart(2,"0")}`;
  }
  // '03/06/2026' or '03/06/26' (DD/MM/YYYY) — the format newer Stock Detail
  // exports use. Also accept dash-numeric '03-06-2026'.
  const numeric = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (numeric) {
    const dd = parseInt(numeric[1], 10);
    const mm = parseInt(numeric[2], 10);
    if (mm < 1 || mm > 12) return null;
    let yy = parseInt(numeric[3], 10); if (yy < 100) yy += 2000;
    return `${yy}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
  }
  return null;
}
function parseInvoiceRows(rows) {
  const out = [];
  for (const row of rows) {
    if (!row) continue;
    const amount = row[23];
    const sp = canonInvoiceSp(row[30]);
    if (typeof amount !== "number" || !sp) continue;
    const date = typeof row[2] === "string" ? parseAutocountDate(row[2]) : null;
    const inv = row[11] ?? null;
    const customer = row[18] ?? null;
    out.push({
      date, invoice: inv ? String(inv) : null,
      customer: customer ? String(customer) : null,
      amount: Math.round(amount * 100) / 100,
      sp,
    });
  }
  return out;
}

// Autocount 'Stock Sales Analysis - Detail (Group by Brand)' export.
//
// Two column layouts observed in the wild:
//   Layout A (Date at col 0): common in newer exports
//     [0]=Date  [1]=Document No  [2]=Salesman  [6]=Quantity  [12]=Price  [14]=Net Sales
//   Layout B (Date at col 1): older / dashed-date exports
//     [1]=Date  [2]=Document No  [3]=Salesman  [6]=Quantity  [13]=Price  [15]=Net Sales
//
// The offset is a global left/right shift by 1 column. Rather than hard-
// coding either, we scan the first 20 rows for the header row (cells with
// "Date", "Document No", "Salesman", "Net Sales"), then derive the exact
// column indexes. Dates may be dash-Mon-year ('02-Jul-26') or DD/MM/YYYY
// ('02/07/2026') — parseAutocountDate handles both.
//
// CN/DN documents carry NEGATIVE net_sales, so summing this column already
// nets returns without extra work — which is why this file replaced the
// Customer Invoice Listing as the source of truth for the Weekly board.
function findStockDetailLayout(rows) {
  const scan = Math.min(rows.length, 30);
  for (let r = 0; r < scan; r++) {
    const row = rows[r]; if (!row) continue;
    const dateCol = row.findIndex(c => typeof c === "string" && c.trim() === "Date");
    if (dateCol < 0) continue;
    const docCol = row.findIndex(c => typeof c === "string" && /^Document\s*No/i.test(c.trim()));
    const spCol  = row.findIndex(c => typeof c === "string" && /^Sales(man|_?person|_?ID)?$/i.test(c.trim()));
    const amtCol = row.findIndex(c => typeof c === "string" && /^Net\s*Sales$/i.test(c.trim()));
    const qtyCol = row.findIndex(c => typeof c === "string" && /^Quantity$/i.test(c.trim()));
    if (docCol >= 0 && amtCol >= 0) {
      return {
        headerRow: r,
        dateCol,
        docCol,
        // Salesman column isn't always in the header row (sometimes it sits
        // in the metadata band); fall back to docCol+1 which holds it on
        // both known layouts.
        spCol: spCol >= 0 ? spCol : docCol + 1,
        amtCol,
        // Quantity header when present. In some exports the numeric value lands
        // one column RIGHT of the header (merged header cell), so the reader
        // below checks qtyCol and qtyCol+1.
        qtyCol: qtyCol >= 0 ? qtyCol : -1,
      };
    }
  }
  return null;
}

function parseStockDetailRows(rows) {
  const layout = findStockDetailLayout(rows);
  if (!layout) return [];
  const { headerRow, dateCol, docCol, spCol, amtCol, qtyCol } = layout;

  const out = [];
  let currentBrand = null;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]; if (!row) continue;
    // 'Brand' rows separate one brand's block from the next. They carry the
    // brand name — captured here so every following line inherits it, which is
    // what the HQ product report needs. The name is the rightmost non-empty
    // string on the row (a short brand code, if present, sits to its left).
    if (row[dateCol] === "Brand") {
      let name = null;
      for (let c = row.length - 1; c > dateCol; c--) {
        const v = row[c];
        if (typeof v === "string" && v.trim()) { name = v.trim(); break; }
      }
      currentBrand = name;
      continue;
    }
    const dateStr = row[dateCol];
    if (typeof dateStr !== "string") continue;
    const sp = canonInvoiceSp(row[spCol]);
    if (!sp) continue;
    const amount = row[amtCol];
    if (typeof amount !== "number") continue;
    const date = parseAutocountDate(dateStr);
    if (!date) continue;
    const doc = row[docCol] ?? null;
    // Quantity: prefer the header column; fall back one column right when the
    // export merged the header cell (the value then sits at qtyCol+1).
    let qty = 0;
    if (qtyCol >= 0) {
      qty = typeof row[qtyCol] === "number" ? row[qtyCol]
          : typeof row[qtyCol + 1] === "number" ? row[qtyCol + 1] : 0;
    }
    out.push({
      date,
      // Reuse the invoice-row shape so downstream (weekly sync, dedupe)
      // treats these identically. 'invoice' holds the doc number so CNs
      // and DNs get keyed distinctly from their originating invoice.
      invoice: doc ? String(doc) : null,
      customer: null,
      amount: Math.round(amount * 100) / 100,
      sp,
      // Extra fields for the HQ product report; the weekly path ignores them.
      brand: currentBrand,
      qty,
    });
  }
  return out;
}

export async function parseFile(file) {
  const fnameInfo = parseFilename(file.name);
  if (!fnameInfo) {
    return { ok: false, file: file.name, error: "Filename does not match expected pattern" };
  }
  let wb, XLSX;
  try {
    ({ wb, XLSX } = await readWorkbook(file));
  } catch (e) {
    return { ok: false, file: file.name, error: `Failed to read xlsx: ${e.message}` };
  }
  const sheet = wb.Sheets["Page 1"] || wb.Sheets[wb.SheetNames[0]];
  if (!sheet) {
    return { ok: false, file: file.name, error: "No 'Page 1' sheet found" };
  }
  const rows = sheetToRows(XLSX, sheet);

  if (fnameInfo.kind === "Sales Analysis by customer") {
    const parsed = parseCustomerRows(rows);
    // Prefer the per-row sp when the file's Salesman column supplied one
    // (year-only exports carry per-customer sp). Fall back to fnameInfo.sp
    // (per-SP legacy files where the sp comes from the filename prefix).
    return {
      ok: true,
      file: file.name,
      kind: "customer",
      sp: fnameInfo.sp,
      year: fnameInfo.year,
      rowCount: parsed.length,
      rows: parsed.map(p => ({
        sp: p.sp || fnameInfo.sp || "All",
        year: fnameInfo.year,
        customer: p.customer,
        months: p.months,
        total: p.total,
      })),
    };
  } else if (fnameInfo.kind === "Customer Invoice Listing") {
    const parsed = parseInvoiceRows(rows);
    // Derive a year from the invoice dates when the filename didn't carry one,
    // so the entry still sorts and filters correctly in the file manager.
    const yearFromRows = parsed
      .map(r => r.date && parseInt(r.date.slice(0, 4), 10))
      .find(y => Number.isFinite(y)) ?? null;
    return {
      ok: true,
      file: file.name,
      kind: "invoice",
      sp: null,
      year: fnameInfo.year ?? yearFromRows,
      rowCount: parsed.length,
      rows: parsed,
    };
  } else if (fnameInfo.kind === "Stock Sales Analysis - Detail") {
    const parsed = parseStockDetailRows(rows);
    const yearFromRows = parsed
      .map(r => r.date && parseInt(r.date.slice(0, 4), 10))
      .find(y => Number.isFinite(y)) ?? null;
    return {
      ok: true,
      file: file.name,
      // Reuse the 'invoice' kind so the existing weekly-sync path (which
      // reads kind='invoice' from data_files) picks these up automatically.
      // The parsed rows have the same shape as invoice-listing rows
      // {date, invoice, customer, amount, sp}, so no downstream changes.
      kind: "invoice",
      sp: null,
      year: fnameInfo.year ?? yearFromRows,
      rowCount: parsed.length,
      rows: parsed,
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
