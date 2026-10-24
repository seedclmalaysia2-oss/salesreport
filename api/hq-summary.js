// Vercel serverless function — returns the HQ "SEED(M) Sales Summary" grid
// (per-product × 12-month qty + MYR) for one calendar year as JSON, computed
// on the fly from every Stock-Detail invoice file in the Data tab for that
// year. This is the same aggregation the Report tab runs in the browser —
// extracted so a sibling app (GM Report Dashboard) can pull the authoritative
// per-colour / per-brand monthly figures without the operator having to
// re-upload the exported Excel workbook.
//
// GET /api/hq-summary?year=2026
//   Headers:
//     X-API-Key: <HQ_SUMMARY_API_KEY env>   // shared secret with the caller
//   Response:
//     {
//       year: 2026,
//       generatedAt: "2026-10-24T...",
//       sources: [ { name, uploadedAt } ],  // files this grid was built from
//       products: {
//         "MONTHLY COLOR UV - PEGAVISION": { qty: [12 numbers], amount: [12 numbers] },
//         "MONTHLY COLOR UV - BLUE":       { qty: [...], amount: [...] },
//         ...
//       },
//       unmapped: { "<brand>": { qty, amount } }
//     }
//
// Env:
//   HQ_SUMMARY_API_KEY           — shared secret the caller presents (SECRET)
//   SUPABASE_URL                 — project URL  (falls back to VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY    — service role key (SECRET; bypasses RLS)

import { parseFilename, parseInvoiceRows, parseStockDetailRows, sheetToRows } from "../src/lib/parseXlsx.js";
import { aggregateProductMonthly } from "../src/lib/reportProducts.js";
import { mergeDatedRowsByMonth } from "../src/lib/periods.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_KEY = process.env.HQ_SUMMARY_API_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return res;
}

async function storageDownload(path) {
  // Service-role direct download — bypasses RLS and the signed-URL round-trip.
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/data-files/${encodeURI(path)}`,
    { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY } },
  );
  if (!res.ok) throw new Error(`storage ${res.status} on ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function readWorkbookFromBytes(bytes) {
  // Serverless-safe: `xlsx` runs identically in Node, we just feed it a
  // Uint8Array instead of going through the browser File → arrayBuffer path.
  const XLSX = (await import("xlsx")).default || (await import("xlsx"));
  return { XLSX, wb: XLSX.read(bytes, { type: "array", cellDates: false }) };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }
  if (!API_KEY) {
    res.status(500).json({ error: "HQ_SUMMARY_API_KEY not configured on server" });
    return;
  }
  const presented = req.headers["x-api-key"] || req.headers["X-API-Key"];
  if (presented !== API_KEY) {
    res.status(401).json({ error: "invalid or missing X-API-Key" });
    return;
  }

  const year = Number(req.query.year);
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    res.status(400).json({ error: "year query param required (2020..2100)" });
    return;
  }

  try {
    // 1. List every live invoice-kind file for this year.
    const filesResp = await sb(
      `data_files?select=id,name,storage_path,uploaded_at&kind=eq.invoice&year=eq.${year}&deleted_at=is.null&order=uploaded_at.desc`,
    );
    if (!filesResp.ok) throw new Error(`data_files query ${filesResp.status}`);
    const files = await filesResp.json();

    // 2. Download + parse each. Reuse the same parser the Report tab uses so
    //    the grid matches the Excel export byte-for-byte.
    const parsedFiles = [];
    const sources = [];
    for (const f of files) {
      const bytes = await storageDownload(f.storage_path);
      const { XLSX, wb } = await readWorkbookFromBytes(bytes);
      const sheet = wb.Sheets["Page 1"] || wb.Sheets[wb.SheetNames[0]];
      if (!sheet) continue;
      const rows = sheetToRows(XLSX, sheet);
      const info = parseFilename(f.name);
      if (!info) continue;
      let parsedRows;
      if (info.kind === "Customer Invoice Listing") parsedRows = parseInvoiceRows(rows);
      else if (info.kind === "Stock Sales Analysis - Detail") parsedRows = parseStockDetailRows(rows);
      else continue;
      parsedFiles.push({
        rows: parsedRows,
        uploadedAt: f.uploaded_at ? new Date(f.uploaded_at).getTime() : 0,
      });
      sources.push({
        name: f.name,
        uploadedAt: f.uploaded_at ? new Date(f.uploaded_at).toISOString() : null,
      });
    }

    // 3. Period-merge (YTD re-exports win per month over period-only files).
    const mergedRows = mergeDatedRowsByMonth(parsedFiles);

    // 4. Aggregate to the HQ Summary grid.
    const { products, unmapped } = aggregateProductMonthly(mergedRows, year);

    res.setHeader("cache-control", "no-store");
    res.status(200).json({
      year,
      generatedAt: new Date().toISOString(),
      sources,
      products,
      unmapped,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
