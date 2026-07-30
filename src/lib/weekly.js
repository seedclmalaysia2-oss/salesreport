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
// string ("YYYY-MM-DD"), return {start, end} for the calendar week that
// contains it, clamped to the date's own month. Weeks are:
//   1st-7th, 8th-14th, 15th-21st, 22nd-28th, 29th-end
// The last week is short in months <31 days (e.g. Feb week 4 = 22-28; Feb
// has no week 5). This is the "ops" convention the finance team asked for
// on 2026-07-29 — Mon-Sun weeks were crossing month boundaries (the "29 Jun
// -> 5 Jul" week showing up under July) which broke month-to-date roll-ups.
export function weekBounds(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const wIdx = Math.floor((d - 1) / 7); // 0..4
  const startDay = wIdx * 7 + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this
  const endDay = Math.min(startDay + 6, lastDay);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    start: `${y}-${pad(m)}-${pad(startDay)}`,
    end:   `${y}-${pad(m)}-${pad(endDay)}`,
  };
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

// One press that rebuilds every fact table the dashboard reads, from the newest
// uploaded/updated files currently in Supabase — customers_data, brand_sales_data
// and weekly_sales — then leaves it to the caller to re-fetch and re-render.
// This is exactly what the Data-tab "Recalculate now" runs, minus the checklist
// UI, so the Weekly card's Refresh can offer the same guarantee: press it and
// whatever file you just Updated shows immediately.
//
// Admin-only in practice: RLS returns non-admins an empty file list, so every
// sync below is a harmless no-op for them (and they lack write permission
// regardless). Each helper is idempotent, so running this repeatedly converges.
export async function recalcAllFacts(files) {
  const customers = await syncCustomersFromFiles(files);
  const brands = await syncBrandsFromFiles(files);
  let weekly = { files: 0, invoices: 0, weeks: 0, rows: 0, periodStart: null, periodEnd: null };
  if (invoiceFilesFrom(files).length > 0) {
    weekly = await syncWeeklyFromFiles(files);
  }
  return { customers, brands, weekly };
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

// Replay every "latest per (sp, year)" customer file into customers_data via
// the replace_customers_data RPC. The RPC does DELETE-then-INSERT atomically
// as SECURITY DEFINER, matches sp case- and whitespace-insensitively (so
// legacy 'SEED Malaysia' rows get cleared alongside the canonical 'Seed
// Malaysia'), and refuses to overwrite a scope with an empty payload — which
// stops a stray zero-row file from wiping the charts.
//
// The client mirrors that guard: files that parsed to zero rows are skipped
// so we never even call the RPC for them, and the checklist reports how many
// files were skipped so the admin sees the coverage gap.
export async function syncCustomersFromFiles(files) {
  const winners = latestFilePerScope(files, "customer");
  if (!winners.length) {
    return { files: 0, scopes: 0, rows: 0, scopeLabels: [], skipped: [] };
  }
  let totalInserted = 0;
  const scopeLabels = [];
  const skipped = [];
  for (const f of winners) {
    const rows = (f.rows || [])
      .filter((r) => r && r.customer)
      .map((r) => ({
        customer: r.customer,
        months:
          Array.isArray(r.months) && r.months.length === 12
            ? r.months.map((m) => Number(m) || 0)
            : new Array(12).fill(0),
        total: Number(r.total) || 0,
      }));
    if (rows.length === 0) {
      skipped.push(`${f.sp} ${f.year} (0 rows)`);
      continue;
    }
    const { data, error } = await supabase.rpc("replace_customers_data", {
      p_sp: f.sp,
      p_year: f.year,
      p_rows: rows,
    });
    if (error) {
      throw new Error(`Replacing ${f.sp} ${f.year} failed: ${error.message}`);
    }
    const inserted = data?.[0]?.inserted ?? rows.length;
    totalInserted += inserted;
    scopeLabels.push(`${f.sp} ${f.year}`);
  }
  return {
    files: winners.length,
    scopes: scopeLabels.length,
    rows: totalInserted,
    scopeLabels,
    skipped,
  };
}

// Restore fact-table rows from a baseline snapshot (typically the bundled
// src/data.json). For every (sp, year) present in the snapshot's customers
// and brandSales arrays, groups the rows and calls the same replace RPCs.
// This is the manual recovery path when an earlier sync wiped scopes and no
// current file can re-populate them (e.g. the 2026 scopes lost after the
// initial RLS-blocked sync). Progress reports per scope so the checklist
// can render each write.
export async function restoreFromBaseline(baseline, onProgress) {
  const report = (patch) => { try { onProgress?.(patch); } catch {} };

  // Group customer rows by (sp, year). Each group becomes one RPC call.
  const custByScope = new Map();
  for (const r of baseline?.customers || []) {
    if (!r?.sp || !Number.isFinite(r.year)) continue;
    const key = `${r.sp}|${r.year}`;
    if (!custByScope.has(key)) custByScope.set(key, []);
    custByScope.get(key).push({
      customer: r.customer,
      months: Array.isArray(r.months) && r.months.length === 12
        ? r.months.map((m) => Number(m) || 0)
        : new Array(12).fill(0),
      total: Number(r.total) || 0,
    });
  }
  const brandByScope = new Map();
  for (const r of baseline?.brandSales || []) {
    if (!r?.sp || !Number.isFinite(r.year)) continue;
    const key = `${r.sp}|${r.year}`;
    if (!brandByScope.has(key)) brandByScope.set(key, []);
    brandByScope.get(key).push({
      customer: r.customer,
      brand: r.brand,
      amt: Number(r.amt) || 0,
      qty: Number(r.qty) || 0,
    });
  }

  const totalScopes = custByScope.size + brandByScope.size;
  let index = 0;
  let custRows = 0, brandRows = 0;
  const scopeLabels = [];
  const errors = [];

  for (const [key, rows] of custByScope) {
    const [sp, yearStr] = key.split("|");
    const year = Number(yearStr);
    report({ index, total: totalScopes, table: "customers_data", scope: `${sp} ${year}` });
    if (rows.length === 0) { index += 1; continue; }
    const { data, error } = await supabase.rpc("replace_customers_data", {
      p_sp: sp, p_year: year, p_rows: rows,
    });
    if (error) {
      errors.push(`customers ${sp} ${year}: ${error.message}`);
    } else {
      custRows += data?.[0]?.inserted ?? rows.length;
      scopeLabels.push(`${sp} ${year} (cust)`);
    }
    index += 1;
  }
  for (const [key, rows] of brandByScope) {
    const [sp, yearStr] = key.split("|");
    const year = Number(yearStr);
    report({ index, total: totalScopes, table: "brand_sales_data", scope: `${sp} ${year}` });
    if (rows.length === 0) { index += 1; continue; }
    const { data, error } = await supabase.rpc("replace_brand_sales_data", {
      p_sp: sp, p_year: year, p_rows: rows,
    });
    if (error) {
      errors.push(`brands ${sp} ${year}: ${error.message}`);
    } else {
      brandRows += data?.[0]?.inserted ?? rows.length;
      scopeLabels.push(`${sp} ${year} (brand)`);
    }
    index += 1;
  }

  return {
    scopes: scopeLabels.length,
    customerRows: custRows,
    brandRows: brandRows,
    errors,
    scopeLabels,
  };
}

// Same shape for brand_sales_data, delegated to replace_brand_sales_data. Same
// empty-row skip so a stray zero-row file can't erase a scope.
export async function syncBrandsFromFiles(files) {
  const winners = latestFilePerScope(files, "brand");
  if (!winners.length) {
    return { files: 0, scopes: 0, rows: 0, scopeLabels: [], skipped: [] };
  }
  let totalInserted = 0;
  const scopeLabels = [];
  const skipped = [];
  for (const f of winners) {
    const rows = (f.rows || [])
      .filter((r) => r && r.customer && r.brand)
      .map((r) => ({
        customer: r.customer,
        brand: r.brand,
        amt: Number(r.amt) || 0,
        qty: Number(r.qty) || 0,
      }));
    if (rows.length === 0) {
      skipped.push(`${f.sp} ${f.year} (0 rows)`);
      continue;
    }
    const { data, error } = await supabase.rpc("replace_brand_sales_data", {
      p_sp: f.sp,
      p_year: f.year,
      p_rows: rows,
    });
    if (error) {
      throw new Error(`Replacing ${f.sp} ${f.year} failed: ${error.message}`);
    }
    const inserted = data?.[0]?.inserted ?? rows.length;
    totalInserted += inserted;
    scopeLabels.push(`${f.sp} ${f.year}`);
  }
  return {
    files: winners.length,
    scopes: scopeLabels.length,
    rows: totalInserted,
    scopeLabels,
    skipped,
  };
}
