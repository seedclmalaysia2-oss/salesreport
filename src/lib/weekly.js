// Bridge between the Data-tab file library and the Weekly Sales view.
//
// The weekly board reads only from public.weekly_sales. Customer Invoice
// Listing workbooks uploaded on the Data tab are parsed to per-invoice detail
// and stored in data_files.rows_json — but nothing used to carry those numbers
// into weekly_sales, so the weekly board stayed empty no matter how many files
// were uploaded. This module is that missing link: it buckets invoice detail
// into Mon–Sun weeks per rep and upserts the totals, so one upload feeds both
// the file library and the weekly board.

import { supabase } from "./supabase.js";

// The rep rows the weekly board understands. "Seed Malaysia" is the house /
// unattributed bucket, kept distinct from the retail trio (Alan/Dino/Khen).
export const REP_ORDER = ["Alan", "Dino", "Khen", "Sakinah", "Wani", "Simon", "Seed Malaysia"];

// Weeks are Monday–Sunday (Malaysian ops convention). Given any ISO date
// string ("YYYY-MM-DD"), return {start, end} for the containing week. UTC math
// keeps the boundary stable regardless of the viewer's timezone.
export function weekBounds(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7; // Sun=0 -> 7
  const monday = new Date(dt); monday.setUTCDate(dt.getUTCDate() - dow + 1);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { start: iso(monday), end: iso(sunday) };
}

// Aggregate invoice-detail rows [{ date:"YYYY-MM-DD", sp, amount }, ...] into
// weekly_sales upsert payload rows, summed per (Mon–Sun week, rep). Rows with
// no date, no recognised rep, or a zero net are dropped. Amounts net credit
// notes (negative lines) the same way the source ledger does.
export function invoiceRowsToWeekly(rows) {
  const byKey = new Map(); // "start|end|sp" -> running amount
  for (const r of rows || []) {
    if (!r) continue;
    const date = r.date;
    const sp = r.sp;
    const amount = Number(r.amount);
    if (!date || !sp || !Number.isFinite(amount)) continue;
    const { start, end } = weekBounds(date);
    const key = `${start}|${end}|${sp}`;
    byKey.set(key, (byKey.get(key) || 0) + amount);
  }
  const payload = [];
  for (const [key, amt] of byKey) {
    const [period_start, period_end, sp] = key.split("|");
    const rounded = Math.round(amt * 100) / 100;
    if (rounded === 0) continue;
    payload.push({ period_start, period_end, sp, amount: rounded });
  }
  payload.sort((a, b) =>
    a.period_start.localeCompare(b.period_start) || a.sp.localeCompare(b.sp));
  return payload;
}

// The invoice files that can feed the weekly board: live (not trashed) entries
// whose parsed rows are present in memory.
export function invoiceFilesFrom(files) {
  return (files || []).filter(
    (f) => f.kind === "invoice" && !f.deletedAt && Array.isArray(f.rows)
  );
}

// Collapse the invoice lines from every file down to one entry per real
// invoice, so overlapping uploads never double-count.
//
// This is what makes a daily workflow safe: exporting a fresh "1st → today"
// Customer Invoice Listing every day means each day's file re-contains all the
// earlier days' invoices. Naively summing the files would count 1–15 Jul again
// in the "1–16 Jul" upload. Instead we key every line by its invoice number,
// sum the lines within each invoice, and let the newest-uploaded file win for
// any invoice that appears in more than one — so an invoice counts exactly once
// at its latest figure, on its own date. Lines with no invoice number (rare on
// this report) fall back to a content key so identical duplicates still merge.
export function dedupeInvoiceUnits(files) {
  const invoiceFiles = [...invoiceFilesFrom(files)].sort(
    (a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0) // oldest first; newest overwrites
  );
  const units = new Map(); // key -> { date, sp, amount }
  for (const f of invoiceFiles) {
    // Fold this one file first, so an invoice's multiple lines sum together
    // before it competes with the same invoice in another file.
    const perFile = new Map();
    for (const r of f.rows || []) {
      if (!r || !r.date || !r.sp) continue;
      const amount = Number(r.amount);
      if (!Number.isFinite(amount)) continue;
      if (r.invoice) {
        const key = `inv|${r.invoice}`;
        const cur = perFile.get(key);
        if (cur) cur.amount += amount;
        else perFile.set(key, { date: r.date, sp: r.sp, amount });
      } else {
        const key = `raw|${r.date}|${r.sp}|${r.customer || ""}|${amount}`;
        perFile.set(key, { date: r.date, sp: r.sp, amount });
      }
    }
    for (const [key, unit] of perFile) units.set(key, unit); // newer file wins
  }
  return [...units.values()];
}

// Rebuild weekly_sales from every invoice file currently visible. Idempotent
// and duplicate-proof: invoices are de-duplicated across files first (see
// dedupeInvoiceUnits), then bucketed into Mon–Sun weeks and upserted on the
// unique (period, rep) key — so running it daily, or re-uploading the same
// month repeatedly, always converges on the correct totals. Purely additive:
// weeks with no invoice file (e.g. a manual entry) are left untouched.
export async function syncWeeklyFromFiles(files) {
  const invoiceFiles = invoiceFilesFrom(files);
  const units = dedupeInvoiceUnits(files);
  const payload = invoiceRowsToWeekly(units);
  if (!payload.length) {
    return { files: invoiceFiles.length, invoices: units.length, weeks: 0, rows: 0, periodStart: null, periodEnd: null };
  }
  const { error } = await supabase
    .from("weekly_sales")
    .upsert(payload, { onConflict: "period_start,period_end,sp" });
  if (error) throw error;
  const starts = payload.map((p) => p.period_start).sort();
  const ends = payload.map((p) => p.period_end).sort();
  return {
    files: invoiceFiles.length,
    invoices: units.length,
    weeks: new Set(payload.map((p) => p.period_start)).size,
    rows: payload.length,
    periodStart: starts[0],
    periodEnd: ends[ends.length - 1],
  };
}

// ============================================================
// Customer + brand fact-table sync
// ============================================================
//
// The dashboard charts read from public.customers_data and public.brand_sales_data,
// not from data_files.rows_json. Uploading a workbook to the Data tab used to
// only archive it — the fact tables were never touched, so the charts stayed
// frozen on whatever the seed script had loaded.
//
// The rule the user asked for: "for each (sp, year), the newest uploaded file
// wins — replace all fact rows for that scope with that file's rows". These
// helpers implement it. Re-uploading a file with the same name just makes
// itself the newest and takes over.
//
// The replace is DELETE-then-INSERT per (sp, year) rather than upsert because
// there's no natural (sp,year,customer[,brand]) unique key on the fact tables
// — new customers appear each year and old ones drop, so any leftover row from
// the previous upload would linger. Deleting first is the only shape that
// guarantees "the chart shows exactly what's in the file."

function eligibleFactFiles(files, kind) {
  return (files || []).filter(
    (f) =>
      f.kind === kind &&
      !f.deletedAt &&
      Array.isArray(f.rows) &&
      f.sp &&
      Number.isFinite(f.year)
  );
}

// For each (sp, year), pick the newest non-deleted file with parsed rows.
// Ties on uploadedAt fall back to the id order Supabase returned them in.
function latestFilePerScope(files, kind) {
  const winners = new Map(); // "sp|year" -> file entry
  for (const f of eligibleFactFiles(files, kind)) {
    const key = `${f.sp}|${f.year}`;
    const cur = winners.get(key);
    if (!cur || (f.uploadedAt || 0) > (cur.uploadedAt || 0)) {
      winners.set(key, f);
    }
  }
  return [...winners.values()];
}

// Replay every "latest per (sp, year)" customer file into customers_data.
// Each scope is a DELETE-by-(sp,year) followed by a chunked INSERT. Returns
// a summary the checklist can render.
export async function syncCustomersFromFiles(files) {
  const winners = latestFilePerScope(files, "customer");
  if (!winners.length) {
    return { files: 0, scopes: 0, rows: 0, scopeLabels: [] };
  }
  let totalRows = 0;
  const scopeLabels = [];
  for (const f of winners) {
    // 1) Clear the previous rows for this scope.
    const { error: delErr } = await supabase
      .from("customers_data")
      .delete()
      .eq("sp", f.sp)
      .eq("year", f.year);
    if (delErr) throw new Error(`Clearing ${f.sp} ${f.year} failed: ${delErr.message}`);

    // 2) Insert the file's rows, in chunks so a large file doesn't stall on
    //    a single 5 MB payload.
    const rows = (f.rows || [])
      .filter((r) => r && r.customer)
      .map((r) => ({
        sp: f.sp,
        year: f.year,
        customer: r.customer,
        months: Array.isArray(r.months) && r.months.length === 12
          ? r.months.map((m) => Number(m) || 0)
          : new Array(12).fill(0),
        total: Number(r.total) || 0,
      }));
    if (rows.length) {
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: insErr } = await supabase
          .from("customers_data")
          .insert(rows.slice(i, i + CHUNK));
        if (insErr) throw new Error(`Inserting ${f.sp} ${f.year} failed: ${insErr.message}`);
      }
    }
    totalRows += rows.length;
    scopeLabels.push(`${f.sp} ${f.year}`);
  }
  return { files: winners.length, scopes: winners.length, rows: totalRows, scopeLabels };
}

// Same shape for brand_sales_data. Brand rows carry (customer, brand, amt, qty)
// rather than the monthly customer breakdown, but the sync strategy is
// identical: newest file per (sp, year) wins, DELETE-then-INSERT for that scope.
export async function syncBrandsFromFiles(files) {
  const winners = latestFilePerScope(files, "brand");
  if (!winners.length) {
    return { files: 0, scopes: 0, rows: 0, scopeLabels: [] };
  }
  let totalRows = 0;
  const scopeLabels = [];
  for (const f of winners) {
    const { error: delErr } = await supabase
      .from("brand_sales_data")
      .delete()
      .eq("sp", f.sp)
      .eq("year", f.year);
    if (delErr) throw new Error(`Clearing ${f.sp} ${f.year} failed: ${delErr.message}`);

    const rows = (f.rows || [])
      .filter((r) => r && r.customer && r.brand)
      .map((r) => ({
        sp: f.sp,
        year: f.year,
        customer: r.customer,
        brand: r.brand,
        amt: Number(r.amt) || 0,
        qty: Number(r.qty) || 0,
      }));
    if (rows.length) {
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: insErr } = await supabase
          .from("brand_sales_data")
          .insert(rows.slice(i, i + CHUNK));
        if (insErr) throw new Error(`Inserting ${f.sp} ${f.year} failed: ${insErr.message}`);
      }
    }
    totalRows += rows.length;
    scopeLabels.push(`${f.sp} ${f.year}`);
  }
  return { files: winners.length, scopes: winners.length, rows: totalRows, scopeLabels };
}
