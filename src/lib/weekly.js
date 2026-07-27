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

// Rebuild weekly_sales from every invoice file currently visible. Idempotent:
// re-running with the same files overwrites the same (period, rep) rows via the
// unique-key upsert, so it is always safe to run again. Purely additive — weeks
// with no invoice file (e.g. a manual entry) are left untouched, never deleted.
// Returns a small summary for the UI to report.
export async function syncWeeklyFromFiles(files) {
  const invoiceFiles = invoiceFilesFrom(files);
  const rows = invoiceFiles.flatMap((f) => f.rows || []);
  const payload = invoiceRowsToWeekly(rows);
  if (!payload.length) {
    return { files: invoiceFiles.length, weeks: 0, rows: 0, periodStart: null, periodEnd: null };
  }
  const { error } = await supabase
    .from("weekly_sales")
    .upsert(payload, { onConflict: "period_start,period_end,sp" });
  if (error) throw error;
  const starts = payload.map((p) => p.period_start).sort();
  const ends = payload.map((p) => p.period_end).sort();
  return {
    files: invoiceFiles.length,
    weeks: new Set(payload.map((p) => p.period_start)).size,
    rows: payload.length,
    periodStart: starts[0],
    periodEnd: ends[ends.length - 1],
  };
}
