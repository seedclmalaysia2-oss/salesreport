import { useState, useMemo } from "react";
import { supabase } from "./lib/supabase.js";
import { parseFile } from "./lib/parseXlsx.js";
import {
  aggregateProductMonthly, REPORT_PRODUCTS, AMOUNT_ONLY_ROWS,
} from "./lib/reportProducts.js";
import templateUrl from "./assets/hq-sales-summary-template.xlsx?url";

// HQ "SEED(M) Sales Summary" generator (admin-only). Prefills the monthly
// per-product quantity + amount grid from the Stock Sales Analysis - Detail
// files, every cell editable before export. The Detail files are re-parsed
// fresh from storage on demand (they carry brand + quantity + UOM), so nothing
// needs reprocessing and no bulky per-line data is stored.

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const YEARS = [2026, 2025, 2024, 2023, 2022];
const AMOUNT_ROWS = [...REPORT_PRODUCTS, ...AMOUNT_ONLY_ROWS];

// --- HQ template layout (sheet "monthly sales", SEED(M) Sales Summary) ---
// The quantity section (rows 5–35) lists the 31 products in REPORT_PRODUCTS order,
// so QTY row = 5 + index. The amount section (rows 39–70) uses a slightly different
// order (Ultra Vision sits below Wohlk) and adds OTHER INCOME, so it needs an
// explicit list. Only the 12 monthly cells (cols B–M = 2–13) are written; every
// TOTAL / BALANCE / ACC% / target-block cell is a formula and recalculates on open.
const TEMPLATE_SHEET = "monthly sales";
// Template was extended with a "DISOP ACUAISS DUAL GEL EYEDROP" row in both the
// quantity section (after DISOP ULTRA EYEDROP) and the amount section, so the
// amount section and the target block sit one/two rows lower than the original.
const QTY_FIRST_ROW = 5;              // REPORT_PRODUCTS[i] -> row 5 + i (32 products, rows 5-36)
const AMOUNT_FIRST_ROW = 40;          // AMOUNT_ROW_ORDER[i] -> row 40 + i (33 rows, 40-72)
const TARGET_ROWS = [76, 85];         // "Jpn Sales Target" and "Revised Sales Target"
const AMOUNT_ROW_ORDER = [
  "1 DAY PURE", "1 DAY PURE SILFA", "1 DAY PURE ASTIGMATISM", "1 DAY MULSTISTAGE",
  "1 DAYPURE EDOF", "1 DAY VIEW SUPPORT", "2 WEEK PURE MULTISTAGE", "2 WEEK PURE UP TORIC",
  "2 WEEK PURE UP", "EYE COFFRET-M", "EYE COFFRET-M 10 TORIC", "EYE COFFRET-M 30 TORIC",
  "MONTHLY FINE PLUS", "MONTHLY PURE3", "MONTHLY PURE6",
  "MONTHLY COLOR UV - PEGAVISION", "MONTHLY COLOR UV - BLUE", "MONTHLY COLOR UV - ORANGE", "MONTHLY COLOR UV  II",
  "MINASOFT 1DAY COLOR UV", "MINASOFT CARE UV", "RGP UV-1 / UV-1 KC", "RGP AS-LUNA/O2 NOAH",
  "IRIS LENS", "BREATH O CORRECT", "BREATH O CORRECT (OVERSEAS)", "Wohlk KE RGP", "ULTRA VISION",
  "DISOP H2O2 SOLUTION", "DISOP ULTRA EYEDROP", "DISOP ACUAISS DUAL GEL EYEDROP", "ACCESSORIES/OTHERS", "OTHER INCOME",
];

const fmtInt = (v) => Math.round(Number(v) || 0).toLocaleString("en-MY");
const fmtAmt = (v) => (Number(v) || 0).toLocaleString("en-MY", { maximumFractionDigits: 0 });
const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);

function emptyGrid() {
  const g = {};
  for (const p of AMOUNT_ROWS) g[p] = { qty: Array(12).fill(0), amount: Array(12).fill(0) };
  return g;
}

// Pull the year's Stock-Detail files from storage and parse them (brand+qty+uom).
async function loadStockDetailRows(year) {
  const { data: files, error } = await supabase
    .from("data_files")
    .select("id,name,storage_path")
    .eq("kind", "invoice")
    .eq("year", year)
    .is("deleted_at", null);
  if (error) throw error;
  const all = [];
  for (const f of files || []) {
    const { data: signed, error: se } = await supabase.storage
      .from("data-files").createSignedUrl(f.storage_path, 300);
    if (se) throw new Error(`${f.name}: ${se.message}`);
    const resp = await fetch(signed.signedUrl);
    if (!resp.ok) throw new Error(`${f.name}: download HTTP ${resp.status}`);
    const parsed = await parseFile(new File([await resp.blob()], f.name));
    if (parsed.ok) all.push(...parsed.rows);
  }
  return { rows: all, fileNames: (files || []).map((f) => f.name) };
}

export default function ReportTab({ user, data }) {
  const [year, setYear] = useState(2026);
  const [grid, setGrid] = useState(emptyGrid);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [unmapped, setUnmapped] = useState({});
  const [sourceFiles, setSourceFiles] = useState([]);
  const [section, setSection] = useState("qty"); // 'qty' | 'amount'
  const [exporting, setExporting] = useState(false);

  // Monthly team target (Msia target) for the Jan–Dec target row, from sales_targets.
  const monthlyTarget = useMemo(() => {
    const t = Array(12).fill(0);
    for (const r of data?.targets || []) {
      if (r.year === year && r.sp === "_TEAM" && r.month >= 1 && r.month <= 12) t[r.month - 1] = Number(r.target) || 0;
    }
    return t;
  }, [data, year]);

  const generate = async () => {
    setLoading(true);
    setStatus("Loading Stock Sales Analysis - Detail file(s)…");
    try {
      const { rows, fileNames } = await loadStockDetailRows(year);
      if (!rows.length) {
        setStatus(`No “Stock Sales Analysis - Detail” file found for ${year}. Upload one on the Data tab first.`);
        setGrid(emptyGrid()); setUnmapped({}); setSourceFiles([]);
        return;
      }
      setStatus("Aggregating by product and month…");
      const { products, unmapped } = aggregateProductMonthly(rows, year);
      const g = emptyGrid();
      for (const [p, d] of Object.entries(products)) {
        if (!g[p]) g[p] = { qty: Array(12).fill(0), amount: Array(12).fill(0) };
        g[p].qty = d.qty.map((v) => Math.round(v));
        g[p].amount = d.amount.map((v) => Math.round(v));
      }
      setGrid(g); setUnmapped(unmapped); setSourceFiles(fileNames);
      setStatus(`Prefilled from ${fileNames.length} file(s) · ${rows.length.toLocaleString()} lines — edit any cell, then export.`);
    } catch (e) {
      setStatus(`Failed: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const setCell = (product, m, val) => {
    setGrid((prev) => {
      const row = prev[product] || { qty: Array(12).fill(0), amount: Array(12).fill(0) };
      const next = { qty: [...row.qty], amount: [...row.amount] };
      next[section][m] = Number(val) || 0;
      return { ...prev, [product]: next };
    });
  };

  const hasData = useMemo(
    () => AMOUNT_ROWS.some((p) => grid[p] && (grid[p].qty.some(Boolean) || grid[p].amount.some(Boolean))),
    [grid],
  );

  // Fill the HQ template (preserving its styling/merges/formulas) and download it.
  // Only the 12 monthly cells per product are written — a value of 0 clears the
  // cell so the template's own reference figures don't bleed through; TOTAL /
  // BALANCE / ACC% and the Msia/target blocks are formulas and recalc on open.
  const exportExcel = async () => {
    setExporting(true);
    setStatus("Building the HQ Excel file…");
    try {
      const ExcelJSMod = await import("exceljs");
      const ExcelJS = ExcelJSMod.default || ExcelJSMod;
      const templateBuf = await (await fetch(templateUrl)).arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(templateBuf);
      const ws = wb.getWorksheet(TEMPLATE_SHEET);
      if (!ws) throw new Error(`template sheet "${TEMPLATE_SHEET}" missing`);

      const writeMonths = (rowNum, arr, { round = true, clearZero = true } = {}) => {
        const row = ws.getRow(rowNum);
        for (let m = 0; m < 12; m++) {
          let v = Number(arr[m]) || 0;
          if (round) v = Math.round(v);
          row.getCell(2 + m).value = v === 0 && clearZero ? null : v;
        }
        row.commit();
      };

      // Quantity section (rows 5–35) and amount section (rows 39–70).
      REPORT_PRODUCTS.forEach((p, i) => writeMonths(QTY_FIRST_ROW + i, grid[p]?.qty || []));
      AMOUNT_ROW_ORDER.forEach((p, i) => writeMonths(AMOUNT_FIRST_ROW + i, grid[p]?.amount || []));

      // Targets from the Dashboard Targets tab — only overwrite a month that has a
      // value, so an incomplete Targets tab falls back to the template's figures.
      for (const tr of TARGET_ROWS) {
        const row = ws.getRow(tr);
        monthlyTarget.forEach((t, m) => { if ((Number(t) || 0) > 0) row.getCell(2 + m).value = Math.round(t); });
        row.commit();
      }

      // Force Excel to recalculate every formula on open (so totals aren't stale).
      wb.calcProperties.fullCalcOnLoad = true;

      const out = await wb.xlsx.writeBuffer();
      const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SEED(M) Sales Summary ${year}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Exported “SEED(M) Sales Summary ${year}.xlsx”. Totals recalculate when you open it in Excel.`);
    } catch (e) {
      setStatus(`Export failed: ${e.message || e}`);
    } finally {
      setExporting(false);
    }
  };

  const rows = section === "qty" ? REPORT_PRODUCTS : AMOUNT_ROWS;
  const colTotal = (m) => sum(rows.map((p) => grid[p]?.[section][m] || 0));
  const rowTotal = (p) => sum(grid[p]?.[section] || []);
  const grandTotal = sum(rows.map((p) => rowTotal(p)));

  if (!user?.isAdmin) {
    return <div style={{ fontSize: 13, color: "rgba(var(--tint),0.67)" }}>Admins only.</div>;
  }

  const th = { padding: "6px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "rgba(var(--tint),0.7)", fontWeight: 700, borderBottom: "1px solid rgba(var(--tint),0.12)", whiteSpace: "nowrap", textAlign: "right" };
  const cellInput = { width: 62, background: "transparent", border: "1px solid transparent", borderRadius: 4, padding: "2px 4px", fontSize: 12, fontFamily: "'Space Mono',monospace", color: "var(--text)", textAlign: "right" };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14, padding: "14px 18px", borderRadius: 12, background: "linear-gradient(135deg, rgba(232,99,59,0.08), rgba(59,130,246,0.06))", border: "1px solid rgba(232,99,59,0.28)" }}>
        <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">📄</div>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>HQ Sales Summary report</div>
          <div style={{ fontSize: 12, color: "rgba(var(--tint),0.7)", lineHeight: 1.5 }}>
            Prefills monthly quantity + amount per product from the Stock-Detail file(s), editable before export.
          </div>
        </div>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          style={{ background: "rgba(var(--tint),0.05)", border: "1px solid rgba(var(--tint),0.15)", color: "var(--text)", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", cursor: "pointer", colorScheme: "dark light" }}>
          {YEARS.map((y) => <option key={y} value={y} style={{ background: "#0A0A0F", color: "#fff" }}>{y}</option>)}
        </select>
        <button onClick={generate} disabled={loading}
          style={{ background: loading ? "rgba(232,99,59,0.4)" : "#E8633B", color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: loading ? "wait" : "pointer", fontFamily: "'DM Sans',sans-serif" }}>
          {loading ? "Working…" : "Prefill from files"}
        </button>
        <button onClick={exportExcel} disabled={exporting || !hasData} title={hasData ? "Download the HQ Excel file" : "Prefill or edit the grid first"}
          style={{ background: "transparent", color: hasData ? "var(--st-info)" : "rgba(var(--tint),0.4)", border: `1px solid ${hasData ? "var(--st-info)" : "rgba(var(--tint),0.2)"}`, borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: exporting ? "wait" : (hasData ? "pointer" : "not-allowed"), fontFamily: "'DM Sans',sans-serif" }}>
          {exporting ? "Exporting…" : "⬇ Export Excel"}
        </button>
      </div>

      {status && (
        <div style={{ fontSize: 12.5, color: "rgba(var(--tint),0.8)", marginBottom: 12, lineHeight: 1.5 }}>{status}</div>
      )}

      {/* Section toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[{ k: "qty", label: "Sales Quantity" }, { k: "amount", label: "Sales Amount" }].map((o) => {
          const on = section === o.k;
          return (
            <button key={o.k} onClick={() => setSection(o.k)}
              style={{ background: on ? "rgba(232,99,59,0.16)" : "rgba(var(--tint),0.05)", color: on ? "var(--st-accent)" : "rgba(var(--tint),0.75)", border: `1px solid ${on ? "rgba(232,99,59,0.55)" : "rgba(var(--tint),0.12)"}`, borderRadius: 8, padding: "7px 15px", fontSize: 12.5, fontWeight: on ? 700 : 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
              {o.label}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div style={{ overflowX: "auto", border: "1px solid rgba(var(--tint),0.1)", borderRadius: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: "var(--bg)", zIndex: 1, minWidth: 210 }}>Product / Month</th>
              {MONTHS.map((m) => <th key={m} style={th}>{m}</th>)}
              <th style={{ ...th, color: "var(--st-accent)" }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p} style={{ borderBottom: "1px solid rgba(var(--tint),0.05)" }}>
                <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text)", position: "sticky", left: 0, background: "var(--bg)", whiteSpace: "nowrap" }}>{p}</td>
                {MONTHS.map((_, m) => (
                  <td key={m} style={{ padding: "1px 2px", textAlign: "right" }}>
                    <input type="number" value={grid[p]?.[section][m] ?? 0}
                      onChange={(e) => setCell(p, m, e.target.value)}
                      onFocus={(e) => { e.target.style.border = "1px solid rgba(232,99,59,0.5)"; e.target.style.background = "rgba(232,99,59,0.06)"; }}
                      onBlur={(e) => { e.target.style.border = "1px solid transparent"; e.target.style.background = "transparent"; }}
                      style={cellInput} />
                  </td>
                ))}
                <td style={{ padding: "3px 10px", textAlign: "right", fontFamily: "'Space Mono',monospace", fontSize: 12, fontWeight: 700, color: "var(--st-accent)", whiteSpace: "nowrap" }}>
                  {section === "qty" ? fmtInt(rowTotal(p)) : fmtAmt(rowTotal(p))}
                </td>
              </tr>
            ))}
            {/* Total row */}
            <tr style={{ background: "rgba(var(--tint),0.04)", borderTop: "1px solid rgba(var(--tint),0.15)" }}>
              <td style={{ padding: "6px 8px", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, color: "rgba(var(--tint),0.85)", position: "sticky", left: 0, background: "var(--bg)" }}>Total</td>
              {MONTHS.map((_, m) => (
                <td key={m} style={{ padding: "6px 6px", textAlign: "right", fontFamily: "'Space Mono',monospace", fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                  {section === "qty" ? fmtInt(colTotal(m)) : fmtAmt(colTotal(m))}
                </td>
              ))}
              <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'Space Mono',monospace", fontSize: 12.5, fontWeight: 700, color: "var(--st-accent)" }}>
                {section === "qty" ? fmtInt(grandTotal) : fmtAmt(grandTotal)}
              </td>
            </tr>
            {/* Msia sales target (amount section only), from the Targets tab */}
            {section === "amount" && (
              <tr style={{ borderTop: "1px solid rgba(var(--tint),0.15)" }}>
                <td style={{ padding: "6px 8px", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, color: "var(--st-info)", position: "sticky", left: 0, background: "var(--bg)" }}>Msia target</td>
                {monthlyTarget.map((t, m) => (
                  <td key={m} style={{ padding: "6px 6px", textAlign: "right", fontFamily: "'Space Mono',monospace", fontSize: 11.5, color: "rgba(var(--tint),0.75)" }}>{fmtAmt(t)}</td>
                ))}
                <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'Space Mono',monospace", fontSize: 12, fontWeight: 700, color: "var(--st-info)" }}>{fmtAmt(sum(monthlyTarget))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Unmapped notice */}
      {Object.keys(unmapped).length > 0 && (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, fontSize: 11.5, lineHeight: 1.6, background: "color-mix(in srgb, var(--st-watch) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--st-watch) 35%, transparent)", color: "var(--st-watch)" }}>
          <strong>{Object.keys(unmapped).length} unmatched brand(s)</strong> — not counted in any row (check these if a total looks low):{" "}
          {Object.entries(unmapped).slice(0, 14).map(([k]) => k).join(" · ")}
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11.5, color: "rgba(var(--tint),0.65)", lineHeight: 1.6 }}>
        Amounts prefill exactly from the Detail files; a few product quantities (DISOP units, overseas BOC) may need a manual tweak above.
        <strong> Export Excel</strong> fills HQ's template — same layout, merges and formulas — and totals recalculate when you open it. {sourceFiles.length > 0 && <>Source: {sourceFiles.join(", ")}.</>}
      </div>
    </div>
  );
}
