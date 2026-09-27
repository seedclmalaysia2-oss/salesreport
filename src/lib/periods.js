// Split-period uploads: combine several files for the same year, month by month.
//
// Ops export the same report more than once a year under date-stamped names
// ("… 31082026.xlsx", then "… 27092026.xlsx"). A later file may be a full
// year-to-date re-export, or it may only cover the new period (e.g. September).
// Keeping just the newest file loses Jan–Aug in the second case, and summing
// every file double-counts in the first.
//
// The rule used everywhere instead: for each calendar month, the NEWEST file
// that has any data in that month owns the month. A cumulative re-export owns
// every month (so older copies drop out, including invoices it has since
// voided), while a September-only file owns just September and Jan–Aug still
// come from the earlier file.

const byNewest = (a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0);

// Month index 0–11 of an ISO "YYYY-MM-DD" date, or -1.
export function monthOfDate(date) {
  if (typeof date !== "string" || date.length < 7) return -1;
  const m = parseInt(date.slice(5, 7), 10);
  return m >= 1 && m <= 12 ? m - 1 : -1;
}

// Invoice-style rows (one row per line, each with a `date`). Returns the rows
// to use, taking each "YYYY-MM" from the newest file that has rows in it.
// Rows with no parseable date are kept only from the newest file.
export function mergeDatedRowsByMonth(files) {
  const sorted = [...(files || [])].filter((f) => Array.isArray(f?.rows)).sort(byNewest);
  const owner = new Map(); // "YYYY-MM" -> file index
  sorted.forEach((f, i) => {
    for (const r of f.rows) {
      const ym = typeof r?.date === "string" ? r.date.slice(0, 7) : "";
      if (monthOfDate(r?.date) >= 0 && !owner.has(ym)) owner.set(ym, i);
    }
  });
  const out = [];
  sorted.forEach((f, i) => {
    for (const r of f.rows) {
      if (!r) continue;
      if (monthOfDate(r.date) < 0) {
        if (i === 0) out.push(r);
        continue;
      }
      if (owner.get(r.date.slice(0, 7)) === i) out.push(r);
    }
  });
  return out;
}

// Customer-style rows ({ sp, customer, months[12], total }) from files of one
// year. Each month comes from the newest file with any non-zero value in it.
// Returns merged rows keyed by (sp, customer), with total = sum of months.
export function mergeMonthlyRowsByMonth(files, fallbackSp = "All") {
  const sorted = [...(files || [])].filter((f) => Array.isArray(f?.rows)).sort(byNewest);
  const owner = new Array(12).fill(-1);
  sorted.forEach((f, i) => {
    for (const r of f.rows) {
      if (!Array.isArray(r?.months)) continue;
      for (let m = 0; m < 12; m++) {
        if (owner[m] < 0 && Number(r.months[m]) !== 0 && Number.isFinite(Number(r.months[m]))) {
          owner[m] = i;
        }
      }
    }
  });
  const merged = new Map(); // "sp|customer" -> row
  sorted.forEach((f, i) => {
    for (const r of f.rows) {
      if (!r || !r.customer) continue;
      const sp = r.sp || f.sp || fallbackSp;
      const key = `${sp}|${r.customer}`;
      let row = merged.get(key);
      for (let m = 0; m < 12; m++) {
        if (owner[m] !== i) continue;
        const v = Number(r.months?.[m]) || 0;
        if (!row) {
          row = { ...r, sp, months: new Array(12).fill(0) };
          merged.set(key, row);
        }
        row.months[m] += v;
      }
    }
  });
  const rows = [...merged.values()];
  for (const r of rows) r.total = r.months.reduce((s, v) => s + v, 0);
  return rows;
}
