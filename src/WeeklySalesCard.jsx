import { useMemo, useState, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./lib/supabase.js";

// Retail Sales Team = the three reps who count toward the "Sales Team" column.
// Everyone else only contributes to the "Seed Malaysia" total.
const RETAIL_TEAM = ["Alan", "Dino", "Khen"];

const SP_COLORS = {
  "Alan": "#E8633B", "Dino": "#3B82F6", "Khen": "#10B981",
  "Sakinah": "#A855F7", "Simon": "#F59E0B", "Wani": "#14B8A6",
  "Seed Malaysia": "#EC4899",
};

const fmtRM = (v) => `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtRM2 = (v) => `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${(v * 100).toFixed(2)}%`;
const fmtDate = (d) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  const day = String(dt.getDate()).padStart(2, "0");
  const mon = String(dt.getMonth() + 1).padStart(2, "0");
  return `${day}/${mon}`;
};

function ProgressBar({ pct, color }) {
  const clamped = Math.min(Math.max(pct, 0), 1.5);
  return (
    <div style={{ width: "100%", height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${clamped * 100}%`, height: "100%", background: color, transition: "width 0.4s" }} />
    </div>
  );
}

function ScopeColumn({ title, subtitle, accentColor, total, target, rows, period }) {
  const pct = target > 0 ? total / target : 0;
  const min65 = target * 0.65;
  const min80 = target * 0.8;
  const bal65 = Math.max(min65 - total, 0);
  const bal80 = Math.max(min80 - total, 0);
  const bal100 = Math.max(target - total, 0);
  const aboveTarget = total >= target;
  const color = aboveTarget ? "#34D399" : pct >= 0.8 ? "#F59E0B" : pct >= 0.65 ? "#EAB308" : "#F87171";

  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: `1px solid ${accentColor}33`,
      borderRadius: 14,
      padding: 24,
      display: "flex",
      flexDirection: "column",
      gap: 18,
    }}>
      {/* Header */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ width: 4, height: 18, background: accentColor, borderRadius: 2 }} />
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: accentColor, fontWeight: 700 }}>{title}</div>
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginLeft: 12 }}>{subtitle}</div>
      </div>

      {/* Big number + progress */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "'Space Mono',monospace", color: "#fff" }}>
            {fmtRM(total)}
          </div>
          <div style={{
            fontSize: 14, fontWeight: 700, fontFamily: "'Space Mono',monospace", color,
            padding: "3px 10px", borderRadius: 14, background: `${color}22`, border: `1px solid ${color}55`,
          }}>
            {fmtPct(pct)}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
          of <span style={{ fontFamily: "'Space Mono',monospace", color: "rgba(255,255,255,0.7)" }}>{fmtRM(target)}</span> monthly target
        </div>
        <div style={{ marginTop: 10 }}>
          <ProgressBar pct={pct} color={color} />
        </div>
      </div>

      {/* Per-rep table */}
      <div>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: "rgba(255,255,255,0.4)", marginBottom: 8, fontWeight: 600 }}>
          By Salesperson · {period}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, padding: "12px 0", textAlign: "center" }}>No data</div>
          ) : rows.map((r) => {
            const repPct = total > 0 ? r.amount / total : 0;
            return (
              <div key={r.sp} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: SP_COLORS[r.sp] || "#888" }} />
                <div style={{ flex: 1, color: "rgba(255,255,255,0.85)" }}>{r.sp}</div>
                <div style={{ flex: 2 }}>
                  <ProgressBar pct={repPct} color={SP_COLORS[r.sp] || "#888"} />
                </div>
                <div style={{ width: 90, textAlign: "right", fontFamily: "'Space Mono',monospace", color: "#fff", fontWeight: 600 }}>
                  {fmtRM(r.amount)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Threshold balances */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
        paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.05)",
      }}>
        {[
          { label: "65% Min", target: min65, balance: bal65, color: "#EAB308" },
          { label: "80% Min", target: min80, balance: bal80, color: "#F59E0B" },
          { label: "100%", target: target, balance: bal100, color: "#34D399" },
        ].map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 1.2, color: t.color, fontWeight: 700 }}>{t.label}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "'Space Mono',monospace" }}>
              {fmtRM(t.target)}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Space Mono',monospace", color: t.balance > 0 ? "#F87171" : "#34D399" }}>
              {t.balance > 0 ? `−${fmtRM(t.balance)}` : "✓ hit"}
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>
              {t.balance > 0 ? "to go" : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WeeklySalesCard({ weeklySales, targets, isAdmin, onUploaded }) {
  const [uploadOpen, setUploadOpen] = useState(false);

  // Latest period
  const { latestPeriod, periodRows } = useMemo(() => {
    if (!weeklySales || weeklySales.length === 0) return { latestPeriod: null, periodRows: [] };
    const latestEnd = weeklySales.reduce(
      (max, w) => (!max || w.periodEnd > max ? w.periodEnd : max), null
    );
    const rows = weeklySales.filter(w => w.periodEnd === latestEnd);
    const periodStart = rows[0]?.periodStart;
    return {
      latestPeriod: { start: periodStart, end: latestEnd, uploadedAt: rows[0]?.uploadedAt },
      periodRows: rows,
    };
  }, [weeklySales]);

  // Pull May 2026 (or latest) target from sales_targets
  const monthlyTarget = useMemo(() => {
    if (!latestPeriod || !targets) return 0;
    const d = new Date(latestPeriod.end);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const t = targets.find(t => t.year === year && t.month === month && t.sp === "_TEAM");
    return t ? t.target : 0;
  }, [latestPeriod, targets]);

  if (!latestPeriod) {
    return (
      <div style={{
        background: "linear-gradient(135deg, rgba(232,99,59,0.06), rgba(59,130,246,0.04))",
        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, marginBottom: 24,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#E8633B", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>
              📊 Weekly Sales Update
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
              No weekly data yet.{isAdmin ? " Use the upload button to add this week's numbers." : " Waiting for admin to upload."}
            </div>
          </div>
          {isAdmin && (
            <button onClick={() => setUploadOpen(true)} style={{
              background: "#E8633B", color: "#fff", border: "none", borderRadius: 8,
              padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "'DM Sans',sans-serif",
            }}>
              ⬆ Upload Weekly Update
            </button>
          )}
        </div>
        {uploadOpen && (
          <UploadPanel onClose={() => setUploadOpen(false)} onUploaded={onUploaded} />
        )}
      </div>
    );
  }

  // Split into Sales Team (retail trio) and full Seed Malaysia
  const teamRows = periodRows
    .filter(r => RETAIL_TEAM.includes(r.sp) && r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const allRows = periodRows
    .filter(r => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const teamTotal = teamRows.reduce((a, b) => a + b.amount, 0);
  const allTotal = allRows.reduce((a, b) => a + b.amount, 0);
  const periodLabel = `${fmtDate(latestPeriod.start)} – ${fmtDate(latestPeriod.end)}`;
  const monthName = new Date(latestPeriod.end).toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div style={{
      background: "linear-gradient(135deg, rgba(232,99,59,0.06), rgba(59,130,246,0.04))",
      border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 24, marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E8633B", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>
            📊 Weekly Sales Update
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: -0.3 }}>
            {periodLabel} <span style={{ fontSize: 14, fontWeight: 400, color: "rgba(255,255,255,0.5)" }}>· {monthName}</span>
          </div>
          {latestPeriod.uploadedAt && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
              Last updated {new Date(latestPeriod.uploadedAt).toLocaleString()}
            </div>
          )}
        </div>
        {isAdmin && (
          <button onClick={() => setUploadOpen(!uploadOpen)} style={{
            background: uploadOpen ? "rgba(232,99,59,0.2)" : "#E8633B",
            color: uploadOpen ? "#E8633B" : "#fff",
            border: uploadOpen ? "1px solid rgba(232,99,59,0.5)" : "none",
            borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600,
            cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
          }}>
            {uploadOpen ? "Cancel" : "⬆ Update"}
          </button>
        )}
      </div>

      {uploadOpen && (
        <UploadPanel
          defaultStart={latestPeriod.start}
          defaultEnd={latestPeriod.end}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => { setUploadOpen(false); onUploaded?.(); }}
        />
      )}

      {/* Two columns side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <ScopeColumn
          title="Retail Sales Team"
          subtitle="Alan + Dino + Khen"
          accentColor="#3B82F6"
          total={teamTotal}
          target={monthlyTarget}
          rows={teamRows}
          period={periodLabel}
        />
        <ScopeColumn
          title="Seed Malaysia (Total)"
          subtitle="All teams including overseas"
          accentColor="#EC4899"
          total={allTotal}
          target={monthlyTarget}
          rows={allRows}
          period={periodLabel}
        />
      </div>
    </div>
  );
}

// ============================================================
// Upload panel — drag-drop xlsx OR manual entry
// ============================================================

function UploadPanel({ defaultStart, defaultEnd, onClose, onUploaded }) {
  const [mode, setMode] = useState("xlsx"); // 'xlsx' | 'manual'
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const toISO = (d) => d.toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(defaultStart || toISO(monday));
  const [periodEnd, setPeriodEnd] = useState(defaultEnd || toISO(sunday));
  const [rows, setRows] = useState([
    { sp: "Alan", amount: 0 },
    { sp: "Dino", amount: 0 },
    { sp: "Khen", amount: 0 },
    { sp: "Sakinah", amount: 0 },
    { sp: "Wani", amount: 0 },
    { sp: "Simon", amount: 0 },
    { sp: "Seed Malaysia", amount: 0 },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const fileRef = useRef(null);

  const onFile = async (file) => {
    setError(null); setInfo(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

      // Find period from any cell containing "DD/MM" range like "01/05 -08/05"
      let detectedStart = periodStart, detectedEnd = periodEnd;
      const periodRe = /(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})/;
      for (const row of grid) {
        for (const c of row || []) {
          if (typeof c === "string") {
            const m = c.match(periodRe);
            if (m) {
              const yr = (() => {
                // try to find year from any title cell
                for (const r2 of grid) for (const c2 of r2 || []) {
                  if (typeof c2 === "string") {
                    const ym = c2.match(/\b(20\d{2})\b/);
                    if (ym) return parseInt(ym[1]);
                  }
                }
                return new Date().getFullYear();
              })();
              const pad = (n) => String(n).padStart(2, "0");
              detectedStart = `${yr}-${pad(parseInt(m[2]))}-${pad(parseInt(m[1]))}`;
              detectedEnd = `${yr}-${pad(parseInt(m[4]))}-${pad(parseInt(m[3]))}`;
              break;
            }
          }
        }
      }

      // Normalize names. The xlsx uses 'Alan Loh', 'Dino Lim', etc.
      const NAMES = {
        "alan loh": "Alan", "alan": "Alan",
        "dino lim": "Dino", "dino": "Dino",
        "khen tan": "Khen", "khen": "Khen",
        "sakinah": "Sakinah",
        "wani": "Wani",
        "simon low": "Simon", "simon": "Simon",
        "seed malaysia": "Seed Malaysia",
      };

      // Find rows where col[0] is a known rep name; read the LAST numeric value in that row
      // (which is the "Seed Malaysia" / comprehensive total).
      const found = {};
      for (const row of grid) {
        if (!row || !row.length) continue;
        const label = row[0];
        if (typeof label !== "string") continue;
        const key = label.trim().toLowerCase();
        const sp = NAMES[key];
        if (!sp) continue;
        // Walk right-to-left for the first numeric cell.
        let amount = 0;
        for (let i = row.length - 1; i >= 1; i--) {
          if (typeof row[i] === "number") { amount = row[i]; break; }
        }
        found[sp] = amount;
      }

      if (Object.keys(found).length === 0) {
        setError("Couldn't find any rep rows in the file. Switch to Manual entry, or check the file format.");
        return;
      }

      const newRows = ["Alan", "Dino", "Khen", "Sakinah", "Wani", "Simon", "Seed Malaysia"]
        .map(sp => ({ sp, amount: Math.round((found[sp] || 0) * 100) / 100 }));

      setRows(newRows);
      setPeriodStart(detectedStart);
      setPeriodEnd(detectedEnd);
      setInfo(`Parsed ${Object.keys(found).length} rep rows · period ${detectedStart} → ${detectedEnd}`);
      setMode("manual"); // show preview/edit before commit
    } catch (e) {
      setError(`Failed to parse: ${e.message}`);
    }
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const payload = rows
        .filter(r => r.sp && Number.isFinite(Number(r.amount)))
        .map(r => ({
          period_start: periodStart,
          period_end: periodEnd,
          sp: r.sp,
          amount: Number(r.amount),
        }));
      if (!payload.length) throw new Error("No rows to save");

      const { error } = await supabase
        .from("weekly_sales")
        .upsert(payload, { onConflict: "period_start,period_end,sp" });
      if (error) throw error;

      setInfo(`Saved ${payload.length} rows for ${periodStart} → ${periodEnd}`);
      setTimeout(() => onUploaded?.(), 600);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12, padding: 20, marginBottom: 16, marginTop: 4,
    }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setMode("xlsx")} style={{
          background: mode === "xlsx" ? "rgba(232,99,59,0.2)" : "transparent",
          color: mode === "xlsx" ? "#E8633B" : "rgba(255,255,255,0.5)",
          border: mode === "xlsx" ? "1px solid rgba(232,99,59,0.5)" : "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>📄 Upload xlsx</button>
        <button onClick={() => setMode("manual")} style={{
          background: mode === "manual" ? "rgba(232,99,59,0.2)" : "transparent",
          color: mode === "manual" ? "#E8633B" : "rgba(255,255,255,0.5)",
          border: mode === "manual" ? "1px solid rgba(232,99,59,0.5)" : "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>✏️ Manual entry</button>
      </div>

      {mode === "xlsx" && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          style={{
            border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 10,
            padding: "30px 20px", textAlign: "center", cursor: "pointer", background: "rgba(255,255,255,0.01)",
          }}>
          <div style={{ fontSize: 22, marginBottom: 6, opacity: 0.4 }}>⤴</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Drop weekly xlsx here</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
            or click to browse · file should match the standard Sales Update layout
          </div>
          <input ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </div>
      )}

      {mode === "manual" && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              Period start
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              Period end
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} />
            </label>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: 1 }}>Salesperson</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: 1 }}>Amount (RM)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.sp} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: SP_COLORS[r.sp] || "#888" }} />
                      {r.sp}
                    </div>
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right" }}>
                    <input
                      type="number"
                      value={r.amount}
                      onChange={(e) => {
                        const newRows = [...rows];
                        newRows[i] = { ...newRows[i], amount: e.target.value };
                        setRows(newRows);
                      }}
                      style={{
                        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                        color: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 13,
                        fontFamily: "'Space Mono',monospace", textAlign: "right", width: 140,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={submit} disabled={busy} style={{
          background: busy ? "rgba(232,99,59,0.4)" : "#E8633B", color: "#fff", border: "none",
          borderRadius: 8, padding: "10px 22px", fontSize: 13, fontWeight: 600,
          cursor: busy ? "not-allowed" : "pointer", fontFamily: "'DM Sans',sans-serif",
        }}>{busy ? "Saving…" : "Save weekly update"}</button>
        <button onClick={onClose} style={{
          background: "transparent", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8, padding: "10px 22px", fontSize: 13, cursor: "pointer",
        }}>Cancel</button>
        {info && <div style={{ fontSize: 12, color: "#34D399" }}>✓ {info}</div>}
        {error && <div style={{ fontSize: 12, color: "#F87171" }}>⚠ {error}</div>}
      </div>
    </div>
  );
}
