import { useEffect, useMemo, useState, useRef } from "react";
// xlsx loaded on demand (see src/lib/parseXlsx.js) — only the admin's weekly
// upload needs it, so it must not sit in the initial bundle.
import { supabase } from "./lib/supabase.js";

// Retail Sales Team = the three reps who count toward the "Sales Team" column.
// Everyone else only contributes to the "Seed Malaysia" total.
const RETAIL_TEAM = ["Alan", "Dino", "Khen"];

// Fallback only. The live palette arrives via the seriesColors prop so this
// card follows the active theme like every other chart surface.
const SP_COLORS_FALLBACK = {
  "Alan": "#E28B59", "Dino": "#6890CD", "Khen": "#4DEDE0",
  "Sakinah": "#9A3DF0", "Simon": "#E0D046", "Seed Malaysia": "#D42F71",
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

// Weeks are Monday-Sunday (Malaysian ops convention). Given any ISO date
// string, return {start, end} for the containing week.
function weekBounds(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7; // Sun=0 -> 7
  const monday = new Date(dt); monday.setUTCDate(dt.getUTCDate() - dow + 1);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { start: iso(monday), end: iso(sunday) };
}

// A week belongs to the month that contains its Monday. Keeps a week from
// showing under two different month buckets in the UI navigator.
function monthKeyFromWeekStart(startIso) {
  return startIso.slice(0, 7); // "YYYY-MM"
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function ProgressBar({ pct, color }) {
  const clamped = Math.min(Math.max(pct, 0), 1.5);
  return (
    <div style={{ width: "100%", height: 6, background: "rgba(var(--tint),0.06)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${clamped * 100}%`, height: "100%", background: color, transition: "width 0.4s" }} />
    </div>
  );
}

function ScopeColumn({ title, subtitle, accentColor, total, target, rows, period, seriesColors }) {
  const SP_COLORS = seriesColors || SP_COLORS_FALLBACK;
  const pct = target > 0 ? total / target : 0;
  const min65 = target * 0.65;
  const min80 = target * 0.8;
  const bal65 = Math.max(min65 - total, 0);
  const bal80 = Math.max(min80 - total, 0);
  const bal100 = Math.max(target - total, 0);
  const aboveTarget = total >= target;
  const color = aboveTarget ? "var(--st-ok)" : pct >= 0.8 ? "var(--st-watch)" : pct >= 0.65 ? "#EAB308" : "var(--st-bad)";

  return (
    <div style={{
      background: "rgba(var(--tint),0.02)",
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
        <div style={{ fontSize: 11, color: "rgba(var(--tint),0.4)", marginLeft: 12 }}>{subtitle}</div>
      </div>

      {/* Big number + progress */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "'Space Mono',monospace", color: "var(--text)" }}>
            {fmtRM(total)}
          </div>
          <div style={{
            fontSize: 14, fontWeight: 700, fontFamily: "'Space Mono',monospace", color,
            padding: "3px 10px", borderRadius: 14, background: `${color}22`, border: `1px solid ${color}55`,
          }}>
            {fmtPct(pct)}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "rgba(var(--tint),0.5)", marginTop: 4 }}>
          of <span style={{ fontFamily: "'Space Mono',monospace", color: "rgba(var(--tint),0.7)" }}>{fmtRM(target)}</span> monthly target
        </div>
        <div style={{ marginTop: 10 }}>
          <ProgressBar pct={pct} color={color} />
        </div>
      </div>

      {/* Per-rep table */}
      <div>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: "rgba(var(--tint),0.4)", marginBottom: 8, fontWeight: 600 }}>
          By Salesperson · {period}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.length === 0 ? (
            <div style={{ color: "rgba(var(--tint),0.4)", fontSize: 12, padding: "12px 0", textAlign: "center" }}>No data</div>
          ) : rows.map((r) => {
            const repPct = total > 0 ? r.amount / total : 0;
            return (
              <div key={r.sp} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: SP_COLORS[r.sp] || "#888" }} />
                <div style={{ flex: 1, color: "rgba(var(--tint),0.85)" }}>{r.sp}</div>
                <div style={{ flex: 2 }}>
                  <ProgressBar pct={repPct} color={SP_COLORS[r.sp] || "#888"} />
                </div>
                <div style={{ width: 90, textAlign: "right", fontFamily: "'Space Mono',monospace", color: "var(--text)", fontWeight: 600 }}>
                  {fmtRM(r.amount)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Threshold balances */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(90px,100%), 1fr))", gap: 8,
        paddingTop: 12, borderTop: "1px solid rgba(var(--tint),0.05)",
      }}>
        {[
          { label: "65% Min", target: min65, balance: bal65, color: "#EAB308" },
          { label: "80% Min", target: min80, balance: bal80, color: "var(--st-watch)" },
          { label: "100%", target: target, balance: bal100, color: "var(--st-ok)" },
        ].map((t, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 1.2, color: t.color, fontWeight: 700 }}>{t.label}</div>
            <div style={{ fontSize: 11, color: "rgba(var(--tint),0.5)", fontFamily: "'Space Mono',monospace" }}>
              {fmtRM(t.target)}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Space Mono',monospace", color: t.balance > 0 ? "var(--st-bad)" : "var(--st-ok)" }}>
              {t.balance > 0 ? `−${fmtRM(t.balance)}` : "✓ hit"}
            </div>
            <div style={{ fontSize: 9, color: "rgba(var(--tint),0.35)" }}>
              {t.balance > 0 ? "to go" : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WeeklySalesCard({ weeklySales, targets, isAdmin, onUploaded, seriesColors }) {
  const SP_COLORS = seriesColors || SP_COLORS_FALLBACK;
  const [uploadOpen, setUploadOpen] = useState(false);

  // Build the month + week navigation index. periodsByMonth is an ordered map
  // of "YYYY-MM" -> [{ start, end, rows, uploadedAt }, ...] with weeks sorted
  // oldest-first. Empty weeklySales collapses everything to null downstream.
  const { periodsByMonth, monthKeys } = useMemo(() => {
    const map = new Map();
    if (!weeklySales) return { periodsByMonth: map, monthKeys: [] };
    // Group all rows into unique (start,end) periods first.
    const periodMap = new Map(); // "start|end" -> { start, end, rows, uploadedAt }
    for (const w of weeklySales) {
      if (!w.periodStart || !w.periodEnd) continue;
      const key = `${w.periodStart}|${w.periodEnd}`;
      if (!periodMap.has(key)) periodMap.set(key, { start: w.periodStart, end: w.periodEnd, rows: [], uploadedAt: w.uploadedAt });
      periodMap.get(key).rows.push(w);
      const cur = periodMap.get(key).uploadedAt;
      if (w.uploadedAt && (!cur || w.uploadedAt > cur)) periodMap.get(key).uploadedAt = w.uploadedAt;
    }
    for (const p of periodMap.values()) {
      const mk = monthKeyFromWeekStart(p.start);
      if (!map.has(mk)) map.set(mk, []);
      map.get(mk).push(p);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.start.localeCompare(b.start));
    const keys = [...map.keys()].sort();
    return { periodsByMonth: map, monthKeys: keys };
  }, [weeklySales]);

  const latestMonthKey = monthKeys[monthKeys.length - 1] || null;
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0);
  const activeMonth = selectedMonth && periodsByMonth.has(selectedMonth) ? selectedMonth : latestMonthKey;
  const weeksInMonth = activeMonth ? periodsByMonth.get(activeMonth) : [];
  // Reset the week index when the visible month changes, so switching months
  // never leaves us pointing past the end of the new month's weeks.
  const boundedWeekIndex = weeksInMonth.length
    ? Math.min(selectedWeekIndex, weeksInMonth.length - 1)
    : 0;
  const selectedPeriod = weeksInMonth[boundedWeekIndex] || null;
  const periodRows = selectedPeriod ? selectedPeriod.rows : [];
  const latestPeriod = selectedPeriod
    ? { start: selectedPeriod.start, end: selectedPeriod.end, uploadedAt: selectedPeriod.uploadedAt }
    : null;

  const goMonth = (delta) => {
    if (!monthKeys.length) return;
    const currentIdx = Math.max(0, monthKeys.indexOf(activeMonth));
    const next = monthKeys[Math.max(0, Math.min(monthKeys.length - 1, currentIdx + delta))];
    setSelectedMonth(next);
    // Land on the last week of the new month, mirroring "latest first" default.
    setSelectedWeekIndex(periodsByMonth.get(next).length - 1);
  };
  const canGoPrev = monthKeys.indexOf(activeMonth) > 0;
  const canGoNext = monthKeys.indexOf(activeMonth) < monthKeys.length - 1;

  // Default the view to the latest week of the latest month, and re-anchor
  // when new data arrives (e.g. the user just uploaded a fresh month).
  useEffect(() => {
    if (!latestMonthKey) return;
    if (selectedMonth == null) {
      setSelectedMonth(latestMonthKey);
      const arr = periodsByMonth.get(latestMonthKey) || [];
      setSelectedWeekIndex(Math.max(0, arr.length - 1));
    }
  }, [latestMonthKey, selectedMonth, periodsByMonth]);

  // Pull the monthly team target for the currently selected month.
  const monthlyTarget = useMemo(() => {
    if (!activeMonth || !targets) return 0;
    const [year, month] = activeMonth.split("-").map(Number);
    const t = targets.find(t => t.year === year && t.month === month && t.sp === "_TEAM");
    return t ? t.target : 0;
  }, [activeMonth, targets]);

  if (!latestPeriod) {
    return (
      <div style={{
        background: "linear-gradient(135deg, rgba(232,99,59,0.06), rgba(59,130,246,0.04))",
        border: "1px solid rgba(var(--tint),0.08)", borderRadius: 14, padding: 24, marginBottom: 24,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--st-accent)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>
              📊 Weekly Sales Update
            </div>
            <div style={{ fontSize: 13, color: "rgba(var(--tint),0.5)" }}>
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
          <UploadPanel onClose={() => setUploadOpen(false)} onUploaded={onUploaded} seriesColors={SP_COLORS} />
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
      border: "1px solid rgba(var(--tint),0.08)", borderRadius: 14, padding: 24, marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--st-accent)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>
            📊 Weekly Sales Update
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: -0.3 }}>
            {periodLabel} <span style={{ fontSize: 14, fontWeight: 400, color: "rgba(var(--tint),0.5)" }}>· {monthName}</span>
          </div>
          {latestPeriod.uploadedAt && (
            <div style={{ fontSize: 11, color: "rgba(var(--tint),0.35)", marginTop: 4 }}>
              Last updated {new Date(latestPeriod.uploadedAt).toLocaleString()}
            </div>
          )}
        </div>
        {isAdmin && (
          <button onClick={() => setUploadOpen(!uploadOpen)} style={{
            background: uploadOpen ? "rgba(232,99,59,0.2)" : "var(--st-accent)",
            color: uploadOpen ? "var(--st-accent)" : "var(--text)",
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
          seriesColors={SP_COLORS}
          defaultStart={latestPeriod.start}
          defaultEnd={latestPeriod.end}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => { setUploadOpen(false); onUploaded?.(); }}
        />
      )}

      {/* Month + week navigator. Prev/next hop between months that actually
          have data; the pill row lists every week of the active month, latest
          on the right, so 4-5 pills per month is the normal shape. */}
      {monthKeys.length > 0 && (
        <div style={{marginBottom:18,padding:"12px 14px",background:"rgba(var(--tint),0.02)",border:"1px solid rgba(var(--tint),0.06)",borderRadius:10}}>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:10}}>
            <button
              onClick={() => goMonth(-1)}
              disabled={!canGoPrev}
              style={{
                background:"transparent",border:"1px solid rgba(var(--tint),0.15)",
                color: canGoPrev ? "var(--text)" : "rgba(var(--tint),0.25)",
                borderRadius:6,padding:"5px 12px",fontSize:12,
                cursor: canGoPrev ? "pointer" : "not-allowed",fontFamily:"'DM Sans',sans-serif",
              }}>◀ Prev month</button>
            <div style={{fontSize:12,color:"rgba(var(--tint),0.5)",textTransform:"uppercase",letterSpacing:1.5,fontWeight:600}}>Viewing</div>
            <select
              value={activeMonth || ""}
              onChange={(e) => { setSelectedMonth(e.target.value); setSelectedWeekIndex((periodsByMonth.get(e.target.value) || []).length - 1); }}
              style={{
                background:"rgba(var(--tint),0.05)",border:"1px solid rgba(var(--tint),0.12)",
                color:"var(--text)",borderRadius:6,padding:"5px 10px",fontSize:13,fontWeight:600,
                fontFamily:"'DM Sans',sans-serif",cursor:"pointer",
              }}>
              {monthKeys.map(k => (
                <option key={k} value={k}>{monthLabel(k)} ({periodsByMonth.get(k).length} wk)</option>
              ))}
            </select>
            <button
              onClick={() => goMonth(1)}
              disabled={!canGoNext}
              style={{
                background:"transparent",border:"1px solid rgba(var(--tint),0.15)",
                color: canGoNext ? "var(--text)" : "rgba(var(--tint),0.25)",
                borderRadius:6,padding:"5px 12px",fontSize:12,
                cursor: canGoNext ? "pointer" : "not-allowed",fontFamily:"'DM Sans',sans-serif",
              }}>Next month ▶</button>
            <div style={{marginLeft:"auto",fontSize:11,color:"rgba(var(--tint),0.4)",fontFamily:"'Space Mono',monospace"}}>
              {monthKeys.length} month{monthKeys.length===1?"":"s"} on record
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {weeksInMonth.map((w, i) => {
              const total = w.rows.reduce((a, r) => a + (r.amount || 0), 0);
              const active = i === boundedWeekIndex;
              return (
                <button
                  key={w.start}
                  onClick={() => setSelectedWeekIndex(i)}
                  title={`${w.start} → ${w.end} · RM ${Math.round(total).toLocaleString("en-MY")}`}
                  style={{
                    background: active ? "rgba(232,99,59,0.15)" : "rgba(var(--tint),0.04)",
                    color: active ? "var(--st-accent)" : "rgba(var(--tint),0.75)",
                    border: `1px solid ${active ? "rgba(232,99,59,0.5)" : "rgba(var(--tint),0.08)"}`,
                    borderRadius: 20, padding: "5px 14px", fontSize: 11,
                    fontWeight: active ? 700 : 500, cursor: "pointer",
                    fontFamily: "'Space Mono',monospace",
                    display:"flex",alignItems:"center",gap:8,
                  }}>
                  W{i+1}: {fmtDate(w.start)}–{fmtDate(w.end)}
                  <span style={{fontSize:10,opacity:0.7,fontWeight:500}}>
                    RM {Math.round(total).toLocaleString("en-MY")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Two columns side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px,100%), 1fr))", gap: 16 }}>
        <ScopeColumn
          seriesColors={SP_COLORS}
          title="Retail Sales Team"
          subtitle="Alan + Dino + Khen"
          accentColor="var(--st-info)"
          total={teamTotal}
          target={monthlyTarget}
          rows={teamRows}
          period={periodLabel}
        />
        <ScopeColumn
          seriesColors={SP_COLORS}
          title="Seed Malaysia (Total)"
          subtitle="All teams including overseas"
          accentColor="var(--st-region)"
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

function UploadPanel({ defaultStart, defaultEnd, onClose, onUploaded, seriesColors }) {
  const SP_COLORS = seriesColors || SP_COLORS_FALLBACK;
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
  // When a Customer Invoice Listing spans more than one Mon-Sun week we split
  // it into per-week buckets and upload each independently. buckets is null
  // for the single-week (manual or short-file) path.
  const [buckets, setBuckets] = useState(null);

  const onFile = async (file) => {
    setError(null); setInfo(null);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

      // Rep-name normaliser. Accepts short first names, full names, and the
      // ALL-CAPS forms Autocount exports on the Customer Invoice Listing
      // (e.g. "NOR SAKINAH ARDANI"). Anything unrecognised is ignored so a
      // stray "Cash sales" row can't leak into a rep total.
      const NAMES = {
        "alan loh": "Alan", "alan": "Alan",
        "dino lim": "Dino", "dino": "Dino",
        "khen tan": "Khen", "khen": "Khen",
        "sakinah": "Sakinah", "nor sakinah ardani": "Sakinah", "nor sakinah": "Sakinah",
        "wani": "Wani", "nurzawani": "Wani",
        "simon low": "Simon", "simon": "Simon",
        "seed malaysia": "Seed Malaysia", "seed": "Seed Malaysia",
      };
      const canon = (raw) => NAMES[String(raw || "").trim().toLowerCase()] || null;

      // Look for the Autocount "Customer Invoice Listing" export first — that
      // format is per-invoice detail rather than a per-rep summary, so needs
      // its own aggregator. We detect it by the report title anywhere in the
      // first ~20 rows plus a "Date : DD-Mon-YY To DD-Mon-YY" header.
      const isInvoiceListing = grid.slice(0, 20).some(r =>
        (r || []).some(c => typeof c === "string" && /customer invoice listing/i.test(c))
      );

      let detectedStart = periodStart, detectedEnd = periodEnd;
      let found = {};

      if (isInvoiceListing) {
        // Header row uses fixed column offsets from the Autocount template:
        //   col 2  = invoice date (e.g. "01-Jul-26")
        //   col 23 = line amount (numeric)
        //   col 30 = salesman name (uppercase full name)
        // The template stays the same for May/June exports too.
        const parseDMY = (s) => {
          const m = String(s).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
          if (!m) return null;
          const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
          const mm = MON[m[2].toLowerCase()]; if (!mm) return null;
          const dd = parseInt(m[1], 10);
          let yy = parseInt(m[3], 10); if (yy < 100) yy += 2000;
          return `${yy}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
        };
        // Pull the header "Date : 01-Jul-26 To 26-Jul-26" for the period.
        for (const row of grid.slice(0, 15)) {
          const joined = (row || []).filter(c => c != null).join(" ");
          const m = joined.match(/(\d{1,2}-[A-Za-z]{3}-\d{2,4}).*?(?:to|→|-)\s*(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i);
          if (m) {
            const a = parseDMY(m[1]), b = parseDMY(m[2]);
            if (a && b) { detectedStart = a; detectedEnd = b; break; }
          }
        }
        // Bucket every invoice line by the Mon-Sun week that contains its date.
        // Each bucket becomes its own weekly_sales row per rep on submit — so a
        // full-month Customer Invoice Listing turns into 4-5 weekly entries.
        const weekBuckets = new Map(); // "YYYY-MM-DD" (Monday) -> { end, byRep }
        let lineCount = 0;
        let minDate = detectedStart, maxDate = detectedEnd;
        for (const row of grid) {
          if (!row) continue;
          const amount = row[23];
          const sp = canon(row[30]);
          if (typeof amount !== "number" || !sp) continue;
          const iso = typeof row[2] === "string" ? parseDMY(row[2]) : null;
          if (!iso) continue;
          const { start, end } = weekBounds(iso);
          if (!weekBuckets.has(start)) weekBuckets.set(start, { end, byRep: {} });
          const b = weekBuckets.get(start);
          b.byRep[sp] = (b.byRep[sp] || 0) + amount;
          if (!minDate || iso < minDate) minDate = iso;
          if (!maxDate || iso > maxDate) maxDate = iso;
          // Also feed the flat 'found' totals so the single-week preview still
          // shows sensible numbers if the file only spans one week.
          found[sp] = (found[sp] || 0) + amount;
          lineCount += 1;
        }
        if (lineCount === 0) {
          setError("Recognised Customer Invoice Listing but couldn't find invoice rows (expected columns C=Date, X=Amount, AE=Salesman).");
          return;
        }
        detectedStart = minDate; detectedEnd = maxDate;

        // Materialise the buckets in chronological order for the preview + submit.
        const sortedKeys = [...weekBuckets.keys()].sort();
        if (sortedKeys.length > 1) {
          const materialised = sortedKeys.map(start => {
            const { end, byRep } = weekBuckets.get(start);
            const rows = ["Alan","Dino","Khen","Sakinah","Wani","Simon","Seed Malaysia"]
              .map(sp => ({ sp, amount: Math.round((byRep[sp] || 0) * 100) / 100 }));
            return { start, end, rows };
          });
          setBuckets(materialised);
          setPeriodStart(detectedStart);
          setPeriodEnd(detectedEnd);
          setInfo(`Invoice Listing: ${lineCount} lines across ${sortedKeys.length} week${sortedKeys.length===1?"":"s"} · ${detectedStart} → ${detectedEnd}`);
          setMode("multi");
          return;
        }
        // Single-week file: fall through to the normal preview path.
        setBuckets(null);
      } else {
        // Legacy per-rep summary format (e.g. "01/05 -08/05" period header,
        // one row per rep in column A with the total in the last numeric cell).
        const periodRe = /(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})/;
        for (const row of grid) {
          for (const c of row || []) {
            if (typeof c === "string") {
              const m = c.match(periodRe);
              if (m) {
                const yr = (() => {
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
        for (const row of grid) {
          if (!row || !row.length) continue;
          const sp = canon(row[0]);
          if (!sp) continue;
          let amount = 0;
          for (let i = row.length - 1; i >= 1; i--) {
            if (typeof row[i] === "number") { amount = row[i]; break; }
          }
          found[sp] = amount;
        }
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
      setInfo(
        isInvoiceListing
          ? `Invoice Listing: ${Object.keys(found).length} reps · period ${detectedStart} → ${detectedEnd}`
          : `Parsed ${Object.keys(found).length} rep rows · period ${detectedStart} → ${detectedEnd}`
      );
      setMode("manual"); // show preview/edit before commit
    } catch (e) {
      setError(`Failed to parse: ${e.message}`);
    }
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      // Multi-week upload from a Customer Invoice Listing: flatten every
      // bucket's rows into one upsert. Same conflict key handles reruns.
      let payload;
      let label;
      if (buckets && buckets.length > 0) {
        payload = buckets.flatMap(b =>
          b.rows
            .filter(r => r.sp && Number.isFinite(Number(r.amount)) && Number(r.amount) !== 0)
            .map(r => ({
              period_start: b.start,
              period_end: b.end,
              sp: r.sp,
              amount: Number(r.amount),
            }))
        );
        label = `${payload.length} rows across ${buckets.length} weeks`;
      } else {
        payload = rows
          .filter(r => r.sp && Number.isFinite(Number(r.amount)))
          .map(r => ({
            period_start: periodStart,
            period_end: periodEnd,
            sp: r.sp,
            amount: Number(r.amount),
          }));
        label = `${payload.length} rows for ${periodStart} → ${periodEnd}`;
      }
      if (!payload.length) throw new Error("No rows to save");

      const { error } = await supabase
        .from("weekly_sales")
        .upsert(payload, { onConflict: "period_start,period_end,sp" });
      if (error) throw error;

      setInfo(`Saved ${label}`);
      setTimeout(() => onUploaded?.(), 600);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      background: "rgba(0,0,0,0.3)", border: "1px solid rgba(var(--tint),0.08)",
      borderRadius: 12, padding: 20, marginBottom: 16, marginTop: 4,
    }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap:"wrap" }}>
        <button onClick={() => { setMode("xlsx"); setBuckets(null); }} style={{
          background: mode === "xlsx" ? "rgba(232,99,59,0.2)" : "transparent",
          color: mode === "xlsx" ? "var(--st-accent)" : "rgba(var(--tint),0.5)",
          border: mode === "xlsx" ? "1px solid rgba(232,99,59,0.5)" : "1px solid rgba(var(--tint),0.1)",
          borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>📄 Upload xlsx</button>
        <button onClick={() => { setMode("manual"); setBuckets(null); }} style={{
          background: mode === "manual" ? "rgba(232,99,59,0.2)" : "transparent",
          color: mode === "manual" ? "var(--st-accent)" : "rgba(var(--tint),0.5)",
          border: mode === "manual" ? "1px solid rgba(232,99,59,0.5)" : "1px solid rgba(var(--tint),0.1)",
          borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>✏️ Manual entry</button>
        {buckets && buckets.length > 1 && (
          <div style={{
            marginLeft:"auto",fontSize:11,color:"var(--st-accent)",fontWeight:600,
            padding:"6px 12px",borderRadius:6,background:"rgba(232,99,59,0.08)",
            border:"1px solid rgba(232,99,59,0.25)",fontFamily:"'Space Mono',monospace",
          }}>{buckets.length} weeks detected</div>
        )}
      </div>

      {mode === "xlsx" && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          style={{
            border: "2px dashed rgba(var(--tint),0.15)", borderRadius: 10,
            padding: "30px 20px", textAlign: "center", cursor: "pointer", background: "rgba(var(--tint),0.01)",
          }}>
          <div style={{ fontSize: 22, marginBottom: 6, opacity: 0.4 }}>⤴</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Drop weekly xlsx here</div>
          <div style={{ fontSize: 11, color: "rgba(var(--tint),0.4)", marginTop: 4 }}>
            or click to browse · file should match the standard Sales Update layout
          </div>
          <input ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </div>
      )}

      {mode === "multi" && buckets && (
        <div style={{border:"1px solid rgba(232,99,59,0.2)",borderRadius:10,overflow:"hidden"}}>
          <div style={{padding:"10px 14px",background:"rgba(232,99,59,0.06)",fontSize:12,color:"rgba(var(--tint),0.75)",borderBottom:"1px solid rgba(232,99,59,0.15)"}}>
            File spans <strong>{buckets.length} weeks</strong>. Each week below will upload as its own <code style={{fontFamily:"'Space Mono',monospace",fontSize:11}}>weekly_sales</code> entry. Re-uploading is safe — same (start, end, rep) rows are overwritten.
          </div>
          <div style={{maxHeight:340,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,fontFamily:"'Space Mono',monospace"}}>
              <thead style={{position:"sticky",top:0,background:"rgba(15,15,20,0.95)",backdropFilter:"blur(8px)"}}>
                <tr>
                  <th style={{textAlign:"left",padding:"8px 12px",fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"rgba(var(--tint),0.5)",borderBottom:"1px solid rgba(var(--tint),0.08)"}}>Week</th>
                  {["Alan","Dino","Khen","Sakinah","Wani","Simon","Seed Malaysia"].map(sp => (
                    <th key={sp} style={{textAlign:"right",padding:"8px 10px",fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"rgba(var(--tint),0.5)",borderBottom:"1px solid rgba(var(--tint),0.08)"}}>{sp.split(" ")[0]}</th>
                  ))}
                  <th style={{textAlign:"right",padding:"8px 12px",fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"var(--st-accent)",borderBottom:"1px solid rgba(var(--tint),0.08)"}}>Total</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map(b => {
                  const total = b.rows.reduce((a, r) => a + Number(r.amount || 0), 0);
                  return (
                    <tr key={b.start} style={{borderBottom:"1px solid rgba(var(--tint),0.04)"}}>
                      <td style={{padding:"8px 12px",whiteSpace:"nowrap"}}>{fmtDate(b.start)} – {fmtDate(b.end)}</td>
                      {["Alan","Dino","Khen","Sakinah","Wani","Simon","Seed Malaysia"].map(sp => {
                        const v = b.rows.find(r => r.sp === sp)?.amount || 0;
                        return (
                          <td key={sp} style={{padding:"8px 10px",textAlign:"right",color: v > 0 ? "var(--text)" : "rgba(var(--tint),0.3)"}}>
                            {v > 0 ? Number(v).toLocaleString("en-MY",{maximumFractionDigits:0}) : "—"}
                          </td>
                        );
                      })}
                      <td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"var(--st-accent)"}}>
                        {Number(total).toLocaleString("en-MY",{maximumFractionDigits:0})}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{background:"rgba(var(--tint),0.03)"}}>
                  <td style={{padding:"10px 12px",fontSize:11,textTransform:"uppercase",letterSpacing:1,color:"rgba(var(--tint),0.6)",fontWeight:700}}>Grand total</td>
                  {["Alan","Dino","Khen","Sakinah","Wani","Simon","Seed Malaysia"].map(sp => {
                    const v = buckets.reduce((s, b) => s + (b.rows.find(r => r.sp === sp)?.amount || 0), 0);
                    return (
                      <td key={sp} style={{padding:"10px 10px",textAlign:"right",fontWeight:700,color: v > 0 ? "var(--text)" : "rgba(var(--tint),0.3)"}}>
                        {v > 0 ? Number(v).toLocaleString("en-MY",{maximumFractionDigits:0}) : "—"}
                      </td>
                    );
                  })}
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700,color:"var(--st-accent)"}}>
                    {buckets.reduce((s, b) => s + b.rows.reduce((a, r) => a + Number(r.amount || 0), 0), 0).toLocaleString("en-MY",{maximumFractionDigits:0})}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {mode === "manual" && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "rgba(var(--tint),0.5)" }}>
              Period start
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                style={{ background: "rgba(var(--tint),0.04)", border: "1px solid rgba(var(--tint),0.08)", color: "var(--text)", borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "rgba(var(--tint),0.5)" }}>
              Period end
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                style={{ background: "rgba(var(--tint),0.04)", border: "1px solid rgba(var(--tint),0.08)", color: "var(--text)", borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: "'DM Sans',sans-serif" }} />
            </label>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(var(--tint),0.08)" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: "rgba(var(--tint),0.4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: 1 }}>Salesperson</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 11, color: "rgba(var(--tint),0.4)", fontWeight: 500, textTransform: "uppercase", letterSpacing: 1 }}>Amount (RM)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.sp} style={{ borderBottom: "1px solid rgba(var(--tint),0.04)" }}>
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
                        background: "rgba(var(--tint),0.04)", border: "1px solid rgba(var(--tint),0.08)",
                        color: "var(--text)", borderRadius: 6, padding: "6px 10px", fontSize: 13,
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
          background: "transparent", color: "rgba(var(--tint),0.5)", border: "1px solid rgba(var(--tint),0.1)",
          borderRadius: 8, padding: "10px 22px", fontSize: 13, cursor: "pointer",
        }}>Cancel</button>
        {info && <div style={{ fontSize: 12, color: "var(--st-ok)" }}>✓ {info}</div>}
        {error && <div style={{ fontSize: 12, color: "var(--st-bad)" }}>⚠ {error}</div>}
      </div>
    </div>
  );
}
